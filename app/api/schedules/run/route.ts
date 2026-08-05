import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { verifyToken } from '@/lib/auth';
import { logActivity } from '@/lib/activity';
import { getValidAccessToken } from '@/lib/google-tokens';
import { INTRO_FOLDER_ID, OUTRO_FOLDER_ID, INTRO_LOCAL_PATH_PREFIX, OUTRO_LOCAL_PATH_PREFIX } from '@/lib/folder-config';

const NOTIFY_EMAIL = 'rorie.g.ryan@gmail.com';
const FROM_EMAIL = 'rorie.ryan@broadcastnow.com.au';
const CRON_SECRET = process.env.CRON_SECRET;

// Intro/outro stings — never treated as removable sponsor content, and
// never edited directly by the scheduler/removal logic below.
const isIntroPath = (path: string) => path.includes('Sponsor Intro & Outros') && path.includes('\\Intros\\')
const isOutroPath = (path: string) => path.includes('Sponsor Intro & Outros') && path.includes('\\Outros\\')
const isProtectedPath = (path: string) => isIntroPath(path) || isOutroPath(path)
const GMAIL_MCP_URL = 'https://gmailmcp.googleapis.com/mcp/v1';

// ─── Intro/outro rotation ────────────────────────────────────────────────
// Picks a new intro/outro sting each time a break goes from empty to
// populated, rotating round-robin through everything in the source Drive
// folder so consecutive breaks don't repeat until the whole set has aired.

async function ensureRotationTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS sting_rotation (
      kind TEXT PRIMARY KEY,
      position INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

async function listDriveFiles(folderId: string, accessToken: string): Promise<{ id: string; name: string }[]> {
  try {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+trashed=false+and+mimeType!='application/vnd.google-apps.folder'&fields=files(id,name)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true&orderBy=name`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.files || [];
  } catch {
    return [];
  }
}

const STING_FOLDERS: Record<'intro' | 'outro', { folderId: string; localPrefix: string }> = {
  intro: { folderId: INTRO_FOLDER_ID, localPrefix: INTRO_LOCAL_PATH_PREFIX },
  outro: { folderId: OUTRO_FOLDER_ID, localPrefix: OUTRO_LOCAL_PATH_PREFIX },
};

// Returns the next sting's local path in rotation, or null if the folder
// isn't configured or is empty (in which case the break just plays without
// that sting, rather than failing).
async function getNextSting(kind: 'intro' | 'outro', accessToken: string): Promise<string | null> {
  const cfg = STING_FOLDERS[kind];
  if (!cfg.folderId) return null;

  const files = await listDriveFiles(cfg.folderId, accessToken);
  if (files.length === 0) return null;

  await ensureRotationTable();
  const rows = await sql`
    INSERT INTO sting_rotation (kind, position)
    VALUES (${kind}, 0)
    ON CONFLICT (kind) DO UPDATE SET position = sting_rotation.position + 1, updated_at = NOW()
    RETURNING position
  `;
  const position = rows[0].position as number;
  const file = files[position % files.length];
  return cfg.localPrefix + file.name;
}

// Rebuilds a playlist's Container= line from its real (non-sting) content
// plus whichever intro/outro paths apply. If there's no real content, the
// file is written fully empty — RadioBOSS does nothing with it, by design.
function buildPlaylistContent(containerName: string, realPaths: string[], introPath: string | null, outroPath: string | null): string {
  if (realPaths.length === 0) return `#EXTM3U\n`;
  const allPaths = [
    ...(introPath ? [introPath] : []),
    ...realPaths,
    ...(outroPath ? [outroPath] : []),
  ];
  const encodedName = encodeURIComponent(containerName || 'Not predefined').replace(/%20/g, '+');
  return `#EXTM3U\nContainer=<${encodedName}>${allPaths.join('|')}\n`;
}

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

  // Find expired schedules before deactivating them
  const expired = await sql`
    SELECT * FROM schedules
    WHERE is_active = true
    AND expires_at IS NOT NULL
    AND expires_at <= ${now.toISOString()}
  `;

  // For each expired schedule, remove the file from ALL playlists that contain it
  for (const schedule of expired) {
    try {
      const pathToRemove = schedule.audio_local_path;

      // 1. List all playlists in the playlist folder
      const listRes = await fetch(
        `https://www.googleapis.com/drive/v3/files?q='${process.env.PLAYLIST_FOLDER_ID}'+in+parents+and+trashed=false&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      let playlistFiles: { id: string; name: string }[] = [];
      if (listRes.ok) {
        const listData = await listRes.json();
        playlistFiles = listData.files || [];
      } else {
        // Fallback: just use the playlist from the schedule record
        playlistFiles = [{ id: schedule.playlist_id, name: schedule.playlist_name }];
      }

      let removedFrom: string[] = [];

      // 2. Check each playlist for the file and remove it
      for (const playlist of playlistFiles) {
        try {
          const fileRes = await fetch(
            `https://www.googleapis.com/drive/v3/files/${playlist.id}?alt=media`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
          if (!fileRes.ok) continue;

          const playlistContent = await fileRes.text();
          const lines = playlistContent.split('\n').filter((l: string) => l.trim());
          let containerName = '';
          let existingPaths: string[] = [];

          for (const line of lines) {
            if (line.startsWith('#EXTM3U')) continue;
            if (line.startsWith('Container=')) {
              const match = line.match(/Container=<([^>]+)>(.+)/);
              if (match) {
                containerName = decodeURIComponent(match[1].replace(/\+/g, ' '));
                existingPaths = match[2].split('|').filter((p: string) => p.trim());
              }
            }
          }

          // Skip if file not in this playlist
          if (!existingPaths.includes(pathToRemove)) continue;

          // Remove the file. If that was the last real (non-sting) item,
          // drop the intro/outro too so the break goes fully empty.
          const introPath = existingPaths.find(isIntroPath) || null;
          const outroPath = existingPaths.find(isOutroPath) || null;
          const updatedReal = existingPaths.filter((p: string) => p !== pathToRemove && !isProtectedPath(p));
          const newContent = buildPlaylistContent(containerName, updatedReal, introPath, outroPath);

          const saveRes = await fetch(
            `https://www.googleapis.com/upload/drive/v3/files/${playlist.id}?uploadType=media&supportsAllDrives=true`,
            {
              method: 'PATCH',
              headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'text/plain' },
              body: newContent,
            }
          );

          if (saveRes.ok) {
            removedFrom.push(playlist.name.replace(/\.m3u8$/i, ''));
          }
        } catch (innerErr) {
          console.error(`[scheduler] Error checking playlist ${playlist.name}:`, innerErr);
        }
      }

      if (removedFrom.length > 0) {
        await sql`
          INSERT INTO schedule_runs (schedule_id, audio_file_name, playlist_name, status, message)
          VALUES (${schedule.id}, ${schedule.audio_file_name}, ${removedFrom.join(', ')}, 'expired', ${'Removed from: ' + removedFrom.join(', ')})
        `;
        await logActivity(0, 'scheduler', `EXPIRED: ${schedule.audio_file_name} removed from ${removedFrom.join(', ')}`, '/api/schedules/run');
        console.log(`[scheduler] Removed expired ${schedule.audio_file_name} from: ${removedFrom.join(', ')}`);
      } else {
        await sql`
          INSERT INTO schedule_runs (schedule_id, audio_file_name, playlist_name, status, message)
          VALUES (${schedule.id}, ${schedule.audio_file_name}, 'none', 'expired', 'File not found in any playlists')
        `;
      }

    } catch (err: any) {
      console.error('[scheduler] Error removing expired file:', schedule.id, err);
      await sql`
        INSERT INTO schedule_runs (schedule_id, audio_file_name, playlist_name, status, message)
        VALUES (${schedule.id}, ${schedule.audio_file_name}, ${schedule.playlist_name}, 'expire_error', ${err.message})
      `;
    }
  }

  // Now deactivate all expired schedules
  await sql`
    UPDATE schedules
    SET is_active = false
    WHERE is_active = true
    AND expires_at IS NOT NULL
    AND expires_at <= ${now.toISOString()}
  `;

  // Get all active schedules due to run (not expired)
  // forceRun=true ignores next_run_at and runs ALL active schedules immediately
  const due = forceRun
    ? await sql`
        SELECT * FROM schedules
        WHERE is_active = true
        AND (expires_at IS NULL OR expires_at > ${now.toISOString()})
        AND schedule_type != 'expiry_only'
      `
    : await sql`
        SELECT * FROM schedules
        WHERE is_active = true
        AND next_run_at <= ${now.toISOString()}
        AND (expires_at IS NULL OR expires_at > ${now.toISOString()})
        AND schedule_type != 'expiry_only'
      `;

  if (due.length === 0 && !forceRun) return { processed: 0, results: [] };
  if (due.length === 0) return { processed: 0, results: [], message: 'No active schedules found' };

  const results: any[] = [];

  for (const schedule of due) {
    try {
      // 1. Fetch current playlist content from Google Drive
      const fileRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${schedule.playlist_id}?alt=media`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      if (!fileRes.ok) throw new Error(`Failed to fetch playlist: ${fileRes.status}`);

      const content = await fileRes.text();

      // 2. Parse existing playlist items
      const lines = content.split('\n').filter((l: string) => l.trim());
      let containerName = '';
      let existingPaths: string[] = [];

      for (const line of lines) {
        if (line.startsWith('#EXTM3U')) continue;
        if (line.startsWith('Container=')) {
          const match = line.match(/Container=<([^>]+)>(.+)/);
          if (match) {
            containerName = decodeURIComponent(match[1].replace(/\+/g, ' '));
            existingPaths = match[2].split('|').filter((p: string) => p.trim());
          }
        }
      }

      // 3. Build the new file path
      const newPath = schedule.audio_local_path;

      // Skip if already in playlist
      if (existingPaths.includes(newPath)) {
        await sql`
          INSERT INTO schedule_runs (schedule_id, audio_file_name, playlist_name, status, message)
          VALUES (${schedule.id}, ${schedule.audio_file_name}, ${schedule.playlist_name}, 'skipped', 'Already in playlist')
        `;
        results.push({ schedule: schedule.audio_file_name, status: 'skipped', reason: 'Already in playlist' });
      } else {
        // 4. Work out real (non-sting) content and whether this break was
        // empty before this add — if so, pick a new intro/outro in rotation.
        const realPaths = existingPaths.filter((p) => !isProtectedPath(p));
        const wasEmpty = realPaths.length === 0;

        let introPath = existingPaths.find(isIntroPath) || null;
        let outroPath = existingPaths.find(isOutroPath) || null;
        if (wasEmpty) {
          introPath = await getNextSting('intro', accessToken);
          outroPath = await getNextSting('outro', accessToken);
        }

        // Insert at position or append (position is relative to the real
        // content only, so it's unaffected by where the intro/outro sit)
        const position = schedule.position;
        if (position >= 0 && position < realPaths.length) {
          realPaths.splice(position, 0, newPath);
        } else {
          realPaths.push(newPath);
        }

        // 5. Generate new playlist content
        const newContent = buildPlaylistContent(containerName, realPaths, introPath, outroPath);

        // 6. Save back to Google Drive
        const saveRes = await fetch(
          `https://www.googleapis.com/upload/drive/v3/files/${schedule.playlist_id}?uploadType=media&supportsAllDrives=true`,
          {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'text/plain',
            },
            body: newContent,
          }
        );

        if (!saveRes.ok) throw new Error(`Failed to save playlist: ${saveRes.status}`);

        await sql`
          INSERT INTO schedule_runs (schedule_id, audio_file_name, playlist_name, status, message)
          VALUES (${schedule.id}, ${schedule.audio_file_name}, ${schedule.playlist_name}, 'success', 'Added to playlist')
        `;

        await logActivity(0, 'scheduler', `SCHEDULED_ADD: ${schedule.audio_file_name} → ${schedule.playlist_name}`, '/api/schedules/run');

        results.push({ schedule: schedule.audio_file_name, playlist: schedule.playlist_name, status: 'success' });
      }

      // 7. Update next_run_at or deactivate if one-time
      if (schedule.schedule_type === 'once') {
        await sql`UPDATE schedules SET is_active = false, last_run_at = ${now.toISOString()} WHERE id = ${schedule.id}`;
      } else {
        const next = calculateNextRun(schedule.schedule_type, schedule.days_of_week, schedule.specific_dates, schedule.time_of_day, now);
        await sql`UPDATE schedules SET last_run_at = ${now.toISOString()}, next_run_at = ${next} WHERE id = ${schedule.id}`;
      }

    } catch (err: any) {
      console.error('[scheduler] Error processing schedule:', schedule.id, err);
      await sql`
        INSERT INTO schedule_runs (schedule_id, audio_file_name, playlist_name, status, message)
        VALUES (${schedule.id}, ${schedule.audio_file_name}, ${schedule.playlist_name}, 'error', ${err.message})
      `;
      results.push({ schedule: schedule.audio_file_name, status: 'error', error: err.message });
    }
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

function calculateNextRun(
  scheduleType: string,
  daysOfWeek: string | null,
  specificDates: string | null,
  timeOfDay: string,
  fromDate: Date = new Date()
): string {
  const [hours, minutes] = timeOfDay.split(':').map(Number);

  if (scheduleType === 'recurring' && daysOfWeek) {
    const days = daysOfWeek.split(',').map(Number);
    for (let i = 1; i <= 7; i++) {
      const d = new Date(fromDate);
      d.setDate(fromDate.getDate() + i);
      d.setHours(hours, minutes, 0, 0);
      if (days.includes(d.getDay())) return d.toISOString();
    }
  }

  const tomorrow = new Date(fromDate);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(hours, minutes, 0, 0);
  return tomorrow.toISOString();
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
  return NextResponse.json(result);
}

// GET — cron endpoint (Vercel calls this)
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // For cron, we need the stored Google token — fetch from DB if you store it
  // For now return instructions
  return NextResponse.json({ message: 'Use POST with accessToken for now' });
}
