import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { verifyToken } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { getValidAccessToken } from '@/lib/google-tokens';
import { fetchPlaylistState } from '@/lib/playlist-ops';
import { addPathToPlaylistOrdered, removePathFromPlaylistLocked } from '@/lib/playlist-ordering';
import { reshuffleDueCampaigns } from '@/lib/campaign-reshuffle';
import { expireIndividualAudioFiles } from '@/lib/campaign-file-expiry';
import { expireCampaignsPastEndDate } from '@/lib/campaign-expiry-status';
import { melbourneWallTimeToUTC, calculateNextRun } from '@/lib/break-time';
import { PLAYLIST_FOLDER_ID } from '@/lib/folder-config';

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

  // Removes a schedule's file. Most schedules know exactly which one
  // playlist they belong to, so this is a single direct lookup — fast,
  // and what fixed the scheduler timing out on a large folder. But the
  // "Expiry" button on the Sponsorship Breaks page sets playlist_id to
  // the literal string 'all', since it doesn't know in advance which
  // break(s) contain the file — for that specific case, every playlist
  // genuinely needs to be checked.
  async function removeExpiredFile(schedule: any): Promise<string[]> {
    if (schedule.playlist_id !== 'all') {
      const removed = await removePathFromPlaylistLocked(schedule.playlist_id, schedule.audio_local_path, accessToken);
      return removed ? [schedule.playlist_name] : [];
    }

    const listRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?q='${PLAYLIST_FOLDER_ID}'+in+parents+and+trashed=false&fields=files(id,name)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!listRes.ok) throw new Error('Failed to list playlists for all-playlists expiry');
    const listData = await listRes.json();
    const playlists = (listData.files || []).filter((f: any) => f.name.endsWith('.m3u8'));

    const removedFrom: string[] = [];
    const SCAN_BATCH = 15;
    for (let i = 0; i < playlists.length; i += SCAN_BATCH) {
      const batch = playlists.slice(i, i + SCAN_BATCH);
      const results = await Promise.all(batch.map(async (pl: any) => {
        try {
          const removed = await removePathFromPlaylistLocked(pl.id, schedule.audio_local_path, accessToken);
          return removed ? pl.name : null;
        } catch (err) {
          // One unreadable playlist shouldn't abort the whole scan —
          // log and keep checking the rest
          console.error(`[scheduler] Failed reading ${pl.name} during all-playlists expiry:`, err);
          return null;
        }
      }));
      removedFrom.push(...results.filter((n): n is string => n !== null));
    }
    return removedFrom;
  }

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
        const removedFrom = await removeExpiredFile(schedule);
        if (removedFrom.length > 0) {
          await sql`
            INSERT INTO schedule_runs (schedule_id, audio_file_name, playlist_name, status, message)
            VALUES (${schedule.id}, ${schedule.audio_file_name}, ${removedFrom.join(', ')}, 'expired', ${'Removed from: ' + removedFrom.join(', ')})
          `;
          await logActivity(0, 'scheduler', `EXPIRED: ${schedule.audio_file_name} removed from ${removedFrom.join(', ')}`, '/api/schedules/run');
        } else {
          await sql`
            INSERT INTO schedule_runs (schedule_id, audio_file_name, playlist_name, status, message)
            VALUES (${schedule.id}, ${schedule.audio_file_name}, ${schedule.playlist_name}, 'expired', 'File not found in any playlist')
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
          // 3. Add it (handles intro/outro wrapping and position pinning
          // automatically; throws on a genuine failure, caught by the
          // outer try/catch below)
          await addPathToPlaylistOrdered(schedule.playlist_id, newPath, schedule.position_type, accessToken);

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

  // Per-file round-robin expiry check — cheap no-op unless a campaign has
  // an individual file expiry set and it's actually passed
  try {
    const fileExpiry = await expireIndividualAudioFiles(accessToken);
    if (fileExpiry.processed > 0) (result as any).fileExpiry = fileExpiry;
  } catch (err) {
    console.error('[schedules/run] File expiry check failed:', err);
  }

  // Marks campaigns whose end date has passed as 'expired' — cheap no-op
  // unless one genuinely has. Doesn't touch Drive; that's handled by the
  // regular expiry check above.
  try {
    const campaignExpiry = await expireCampaignsPastEndDate();
    if (campaignExpiry.expired.length > 0) (result as any).campaignsExpired = campaignExpiry.expired;
  } catch (err) {
    console.error('[schedules/run] Campaign end-date expiry check failed:', err);
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

  try {
    const fileExpiry = await expireIndividualAudioFiles(accessToken);
    if (fileExpiry.processed > 0) (result as any).fileExpiry = fileExpiry;
  } catch (err) {
    console.error('[schedules/run] File expiry check failed:', err);
  }

  try {
    const campaignExpiry = await expireCampaignsPastEndDate();
    if (campaignExpiry.expired.length > 0) (result as any).campaignsExpired = campaignExpiry.expired;
  } catch (err) {
    console.error('[schedules/run] Campaign end-date expiry check failed:', err);
  }

  return NextResponse.json(result);
}
