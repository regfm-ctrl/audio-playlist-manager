import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { verifyToken } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { getValidAccessToken } from '@/lib/google-tokens';
import { fetchPlaylistState, removePathFromPlaylist, addPathToPlaylist } from '@/lib/playlist-ops';
import { reshuffleDueCampaigns } from '@/lib/campaign-reshuffle';
import { melbourneWallTimeToUTC, calculateNextRun } from '@/lib/break-time';

// Fluid Compute is enabled on this project, which raises Hobby plan's
// execution ceiling to 300s (from the standard 60s) — extra headroom on
// top of the per-run capping below, at effectively no cost given how far
// under the monthly usage limits this project sits.
export const maxDuration = 300;

const NOTIFY_EMAIL = 'rorie.g.ryan@gmail.com';
const FROM_EMAIL = 'rorie.ryan@broadcastnow.com.au';
const CRON_SECRET = process.env.CRON_SECRET;
const GMAIL_MCP_URL = 'https://gmailmcp.googleapis.com/mcp/v1';

async function sendEmailViaMCP(subject: string, body: string) {
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{
          role: 'user',
          content: `Send an email using Gmail MCP. 
To: ${NOTIFY_EMAIL}
From: ${FROM_EMAIL}
Subject: ${subject}
Body: ${body}

Use the Gmail send tool to send this email now.`
        }],
        mcp_servers: [{ type: 'url', url: GMAIL_MCP_URL, name: 'gmail' }],
      }),
    });
    const data = await response.json();
    console.log('[scheduler] Email send result:', JSON.stringify(data).slice(0, 200));
    return true;
  } catch (err) {
    console.error('[scheduler] Email failed:', err);
    return false;
  }
}

async function processSchedules(accessToken: string, forceRun = false) {
  const now = new Date();

  // Find expired schedules before deactivating them (capped and ordered
  // most-overdue-first, same reasoning as the "due" cap below)
  const expired = await sql`
    SELECT * FROM schedules
    WHERE is_active = true
    AND expires_at IS NOT NULL
    AND expires_at <= ${now.toISOString()}
    ORDER BY expires_at ASC
    LIMIT 60
  `;

  // For each expired schedule, remove the file directly from its own known
  // playlist. Previously this re-listed and searched every playlist in the
  // folder for every single expired schedule — with hundreds of playlists,
  // that's hundreds of wasted lookups per expiry and was the cause of the
  // scheduler timing out once the folder grew large.
  const BATCH_SIZE = 15;
  for (let i = 0; i < expired.length; i += BATCH_SIZE) {
    const batch = expired.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (schedule: any) => {
      try {
        const removed = await removePathFromPlaylist(schedule.playlist_id, schedule.audio_local_path, accessToken);
        if (removed) {
          await sql`
            INSERT INTO schedule_runs (schedule_id, audio_file_name, playlist_name, status, message)
            VALUES (${schedule.id}, ${schedule.audio_file_name}, ${schedule.playlist_name}, 'expired', ${'Removed from: ' + schedule.playlist_name})
          `;
          await logActivity(0, 'scheduler', `EXPIRED: ${schedule.audio_file_name} removed from ${schedule.playlist_name}`, '/api/schedules/run');
        } else {
          await sql`
            INSERT INTO schedule_runs (schedule_id, audio_file_name, playlist_name, status, message)
            VALUES (${schedule.id}, ${schedule.audio_file_name}, ${schedule.playlist_name}, 'expired', 'File not found in playlist')
          `;
        }
        // Deactivate this specific row now that it's actually been handled
        // — only what was genuinely processed this run, not the full
        // (possibly larger, capped-off) set of expired rows.
        await sql`UPDATE schedules SET is_active = false WHERE id = ${schedule.id}`;
      } catch (err: any) {
        console.error('[scheduler] Error removing expired file:', schedule.id, err);
        await sql`
          INSERT INTO schedule_runs (schedule_id, audio_file_name, playlist_name, status, message)
          VALUES (${schedule.id}, ${schedule.audio_file_name}, ${schedule.playlist_name}, 'expire_error', ${err.message})
        `;
        // Left active on error so the next run retries it, rather than
        // silently abandoning a removal that never actually happened.
      }
    }));
  }

  // Get active schedules due to run (not expired), capped per invocation and
  // processing the most overdue first. If a run failed for a while (as
  // happened during the earlier outage), everything that was due during
  // that window is still sitting there — without this cap, one run would
  // try to process the entire backlog at once and keep timing out with zero
  // progress. Capping guarantees every run makes real forward progress;
  // the backlog just drains gradually across the next several runs instead.
  // forceRun=true still ignores next_run_at (runs whatever's due) but gets
  // the same cap and ordering for the same reason.
  const due = forceRun
    ? await sql`
        SELECT * FROM schedules
        WHERE is_active = true
        AND (expires_at IS NULL OR expires_at > ${now.toISOString()})
        AND schedule_type != 'expiry_only'
        ORDER BY next_run_at ASC NULLS FIRST
        LIMIT 100
      `
    : await sql`
        SELECT * FROM schedules
        WHERE is_active = true
        AND next_run_at <= ${now.toISOString()}
        AND (expires_at IS NULL OR expires_at > ${now.toISOString()})
        AND schedule_type != 'expiry_only'
        ORDER BY next_run_at ASC
        LIMIT 100
      `;

  if (due.length === 0 && !forceRun) return { processed: 0, results: [] };
  if (due.length === 0) return { processed: 0, results: [], message: 'No active schedules found' };

  const results: any[] = [];

  // Batched in parallel, same pattern as everywhere else — sequential
  // processing here was the other half of what made this time out once
  // the schedule count grew into the hundreds (this matters even more once
  // Force Run All is used, since that processes every active schedule
  // regardless of due status).
  for (let i = 0; i < due.length; i += BATCH_SIZE) {
    const batch = due.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(async (schedule: any) => {
      try {
        // 1. Fetch current playlist content from Google Drive
        const state = await fetchPlaylistState(schedule.playlist_id, accessToken);
        if (!state) throw new Error(`Failed to fetch playlist: ${schedule.playlist_id}`);
        const { existingPaths } = state;

        // 2. Build the new file path
        const newPath = schedule.audio_local_path;
        let result: any;

        // Skip if already in playlist
        if (existingPaths.includes(newPath)) {
          await sql`
            INSERT INTO schedule_runs (schedule_id, audio_file_name, playlist_name, status, message)
            VALUES (${schedule.id}, ${schedule.audio_file_name}, ${schedule.playlist_name}, 'skipped', 'Already in playlist')
          `;
          result = { schedule: schedule.audio_file_name, status: 'skipped', reason: 'Already in playlist' };
        } else {
          // 3. Add it (handles intro/outro wrapping automatically; throws
          // on a genuine failure, caught by the outer try/catch below)
          await addPathToPlaylist(schedule.playlist_id, newPath, schedule.position, accessToken);

          await sql`
            INSERT INTO schedule_runs (schedule_id, audio_file_name, playlist_name, status, message)
            VALUES (${schedule.id}, ${schedule.audio_file_name}, ${schedule.playlist_name}, 'success', 'Added to playlist')
          `;

          await logActivity(0, 'scheduler', `SCHEDULED_ADD: ${schedule.audio_file_name} → ${schedule.playlist_name}`, '/api/schedules/run');

          result = { schedule: schedule.audio_file_name, playlist: schedule.playlist_name, status: 'success' };
        }

        // 7. Update next_run_at or deactivate if one-time
        if (schedule.schedule_type === 'once') {
          await sql`UPDATE schedules SET is_active = false, last_run_at = ${now.toISOString()} WHERE id = ${schedule.id}`;
        } else {
          const next = calculateNextRun(schedule.schedule_type, schedule.days_of_week, schedule.specific_dates, schedule.time_of_day, now);
          await sql`UPDATE schedules SET last_run_at = ${now.toISOString()}, next_run_at = ${next} WHERE id = ${schedule.id}`;
        }

        return result;
      } catch (err: any) {
        console.error('[scheduler] Error processing schedule:', schedule.id, err);
        await sql`
          INSERT INTO schedule_runs (schedule_id, audio_file_name, playlist_name, status, message)
          VALUES (${schedule.id}, ${schedule.audio_file_name}, ${schedule.playlist_name}, 'error', ${err.message})
        `;
        return { schedule: schedule.audio_file_name, status: 'error', error: err.message };
      }
    }));
    results.push(...batchResults);
  }

  // Send email notification
  const expiredNames = expired.map((s: any) => `${s.audio_file_name} from ${s.playlist_name}`);
  if (results.length > 0 || expired.length > 0) {
    const successful = results.filter(r => r.status === 'success');
    const failed = results.filter(r => r.status === 'error');
    const skipped = results.filter(r => r.status === 'skipped');

    const subject = `Audio Playlist Scheduler — ${successful.length} added, ${expired.length} expired, ${failed.length} failed`;
    const body = [
      `Scheduled playlist updates ran at ${now.toLocaleString('en-AU', { timeZone: 'Australia/Melbourne' })}`,
      '',
      successful.length > 0 ? `✅ Successfully added (${successful.length}):` : '',
      ...successful.map(r => `  • ${r.schedule} → ${r.playlist}`),
      '',
      expired.length > 0 ? `🗑 Expired & removed from playlist (${expired.length}):` : '',
      ...expiredNames.map((n: string) => `  • ${n}`),
      '',
      skipped.length > 0 ? `⏭ Skipped (${skipped.length}):` : '',
      ...skipped.map(r => `  • ${r.schedule} (${r.reason})`),
      '',
      failed.length > 0 ? `❌ Failed (${failed.length}):` : '',
      ...failed.map(r => `  • ${r.schedule}: ${r.error}`),
    ].filter(l => l !== undefined).join('\n');

    await sendEmailViaMCP(subject, body);
  }

  return { processed: due.length, results };
}

// POST — manual "Run Now" trigger (requires login)
export async function POST(req: NextRequest) {
  const token = req.cookies.get('token')?.value;
  const user = token ? await verifyToken(token) : null;

  // Also allow cron secret
  const authHeader = req.headers.get('authorization');
  const isCron = authHeader === `Bearer ${CRON_SECRET}`;

  if (!user && !isCron) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { forceRun = false } = body;
  let { accessToken } = body;

  // If no token provided by browser, try to get stored server-side token
  if (!accessToken) {
    console.log('[schedules/run] No browser token provided, trying stored token...');
    accessToken = await getValidAccessToken();
  }

  if (!accessToken) {
    return NextResponse.json({
      error: 'Google Drive not connected. Please connect Google Drive by clicking the Connect button in the main app.',
      needsGoogleAuth: true,
    }, { status: 400 });
  }

  const result = await processSchedules(accessToken, forceRun);

  // Weekly random-reshuffle check — cheap no-op unless it's a new
  // Melbourne week and a campaign is actually due
  try {
    const reshuffle = await reshuffleDueCampaigns();
    if (reshuffle.processed > 0) (result as any).weeklyReshuffle = reshuffle;
  } catch (err) {
    console.error('[schedules/run] Weekly reshuffle check failed:', err);
  }

  return NextResponse.json(result);
}

// GET — cron endpoint (Vercel calls this)
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return NextResponse.json({
      error: 'Google Drive not connected. Please connect Google Drive by clicking the Connect button in the main app.',
      needsGoogleAuth: true,
    }, { status: 400 });
  }

  const result = await processSchedules(accessToken, false);

  try {
    const reshuffle = await reshuffleDueCampaigns();
    if (reshuffle.processed > 0) (result as any).weeklyReshuffle = reshuffle;
  } catch (err) {
    console.error('[schedules/run] Weekly reshuffle check failed:', err);
  }

  return NextResponse.json(result);
}
