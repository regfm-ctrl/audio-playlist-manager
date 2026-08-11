import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { verifyToken } from '@/lib/auth';
import { ensureCampaignCategoryColumns } from '@/lib/campaign-schema';
import { getValidAccessToken } from '@/lib/google-tokens';
import { removePathFromPlaylistLocked } from '@/lib/playlist-ordering';
import { melbourneWallTimeToUTC } from '@/lib/break-time';
import { logActivity } from '@/lib/activity';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Produces a human-readable summary of what actually changed between the
// existing campaign and the incoming edit — the point of this is that
// "Campaign updated" alone tells you nothing useful later; knowing
// exactly what changed (which days, which files, spot count) is what
// makes the activity log worth having.
function summarizeCampaignChanges(before: any, after: any, beforeFiles: any[], afterFiles: any[]): string {
  const changes: string[] = [];

  if (before.sponsor_name !== after.sponsor_name) changes.push(`sponsor "${before.sponsor_name}" → "${after.sponsor_name}"`);
  if ((before.business_category || null) !== (after.business_category || null)) changes.push(`category "${before.business_category || 'none'}" → "${after.business_category || 'none'}"`);
  if (before.spots_per_week !== after.spots_per_week) changes.push(`spots/week ${before.spots_per_week} → ${after.spots_per_week}`);
  if (before.distribution_type !== after.distribution_type) changes.push(`distribution "${before.distribution_type}" → "${after.distribution_type}"`);

  const beforeDays = (before.allowed_days || '').split(',').filter(Boolean).map(Number).sort().map((d: number) => DAY_NAMES[d]).join(',');
  const afterDays = (after.allowed_days || '').split(',').filter(Boolean).map(Number).sort().map((d: number) => DAY_NAMES[d]).join(',');
  if (beforeDays !== afterDays) changes.push(`allowed days [${beforeDays || 'none'}] → [${afterDays || 'none'}]`);

  if ((before.time_from || null) !== (after.time_from || null) || (before.time_to || null) !== (after.time_to || null)) {
    changes.push(`hours ${before.time_from ?? '00:00'}-${before.time_to ?? '23:59'} → ${after.time_from ?? '00:00'}-${after.time_to ?? '23:59'}`);
  }
  if ((before.position_type || 'middle') !== (after.position_type || 'middle')) changes.push(`position "${before.position_type || 'middle'}" → "${after.position_type || 'middle'}"`);
  if ((before.start_date || null) !== (after.start_date || null)) changes.push(`start date ${before.start_date} → ${after.start_date}`);
  if ((before.end_date || null) !== (after.end_date || null)) changes.push(`end date ${before.end_date || 'ongoing'} → ${after.end_date || 'ongoing'}`);
  if (!!before.randomize_weekly !== !!after.randomize_weekly) changes.push(`randomize weekly ${before.randomize_weekly ? 'on' : 'off'} → ${after.randomize_weekly ? 'on' : 'off'}`);

  const beforePaths = new Set(beforeFiles.map((f) => f.localPath));
  const afterPaths = new Set(afterFiles.map((f) => f.localPath));
  const added = afterFiles.filter((f) => !beforePaths.has(f.localPath)).map((f) => f.name);
  const removed = beforeFiles.filter((f) => !afterPaths.has(f.localPath)).map((f) => f.name);
  if (added.length > 0) changes.push(`added file(s): ${added.join(', ')}`);
  if (removed.length > 0) changes.push(`removed file(s): ${removed.join(', ')}`);

  return changes.length > 0 ? changes.join(' | ') : 'no substantive changes detected';
}

// The frontend sends per-file expiresAt as a plain "YYYY-MM-DDTHH:MM"
// Melbourne-local string (no timezone math needed client-side) — convert
// to a proper UTC ISO timestamp here, same approach as go_live_time/
// expiry_time at the campaign level.
function normalizeAudioFilesExpiry(files: any[]): any[] {
  if (!Array.isArray(files)) return files;
  return files.map(f => {
    if (!f?.expiresAt || typeof f.expiresAt !== 'string') return f;
    // Already converted (a full ISO string with seconds/zone) — leave as-is
    if (f.expiresAt.includes('Z') || /[+-]\d{2}:\d{2}$/.test(f.expiresAt)) return f;
    const [datePart, timePart] = f.expiresAt.split('T');
    if (!datePart || !timePart) return f;
    const [y, m, d] = datePart.split('-').map(Number);
    const [h, min] = timePart.split(':').map(Number);
    return { ...f, expiresAt: melbourneWallTimeToUTC(y, m, d, h, min || 0).toISOString() };
  });
}

async function getUser(req: NextRequest) {
  const token = req.cookies.get('token')?.value;
  if (!token) return null;
  return verifyToken(token);
}

// GET — list all campaigns
export async function GET(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await ensureCampaignCategoryColumns();
  const rows = await sql`SELECT * FROM campaigns ORDER BY created_at DESC`;
  return NextResponse.json(rows);
}

// POST — create campaign
export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await ensureCampaignCategoryColumns();

  const {
    sponsor_name, business_category, audio_file_id, audio_file_name, audio_directory_name, audio_local_path, audio_files,
    spots_per_week, distribution_type, per_day_counts,
    allowed_days, time_from, time_to, allowed_breaks,
    position, position_type, start_date, end_date, booking_reference, booking_details, randomize_weekly, go_live_time, expiry_time,
  } = await req.json();

  // audio_files is the canonical list going forward. The singular columns
  // are kept in sync with the first file for backward compatibility with
  // any older code path that still reads them directly.
  const filesList = normalizeAudioFilesExpiry(Array.isArray(audio_files) && audio_files.length > 0
    ? audio_files
    : (audio_local_path ? [{ id: audio_file_id, name: audio_file_name, dir: audio_directory_name, localPath: audio_local_path }] : []));
  const firstFile = filesList[0] || { id: audio_file_id, name: audio_file_name, dir: audio_directory_name, localPath: audio_local_path };

  const rows = await sql`
    INSERT INTO campaigns (
      sponsor_name, business_category, audio_file_id, audio_file_name, audio_directory_name, audio_local_path, audio_files,
      spots_per_week, distribution_type, per_day_counts,
      allowed_days, time_from, time_to, allowed_breaks,
      position, position_type, start_date, end_date, created_by, booking_reference, booking_details, randomize_weekly,
      go_live_time, expiry_time
    ) VALUES (
      ${sponsor_name}, ${business_category || null}, ${firstFile.id ?? ''}, ${firstFile.name ?? ''}, ${firstFile.dir ?? ''}, ${firstFile.localPath ?? audio_local_path},
      ${JSON.stringify(filesList)},
      ${spots_per_week}, ${distribution_type}, ${per_day_counts ? JSON.stringify(per_day_counts) : null},
      ${allowed_days ?? null}, ${time_from ?? null}, ${time_to ?? null}, ${allowed_breaks ?? null},
      ${position ?? -1}, ${position_type || 'middle'}, ${start_date}, ${end_date ?? null}, ${user.username}, ${booking_reference || null}, ${booking_details || null}, ${!!randomize_weekly},
      ${go_live_time || '06:00'}, ${expiry_time || '22:00'}
    ) RETURNING *
  `;
  await logActivity((user as any).userId ?? 0, user.username, 'CAMPAIGN_CREATED', '/api/campaigns',
    `"${sponsor_name}" — ${spots_per_week} spots/week, ${filesList.length} file(s), category: ${business_category || 'none'}`);
  return NextResponse.json(rows[0]);
}

// PATCH — update status, or full campaign details (edit)
export async function PATCH(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await ensureCampaignCategoryColumns();

  const body = await req.json();
  const { id, status } = body;

  // Status-only update (pause/resume) — existing behaviour
  if (status !== undefined && Object.keys(body).length === 2) {
    const existingRows = await sql`SELECT sponsor_name FROM campaigns WHERE id = ${id}`;
    await sql`UPDATE campaigns SET status = ${status} WHERE id = ${id}`;
    const sponsorName = existingRows[0]?.sponsor_name ?? `#${id}`;
    await logActivity((user as any).userId ?? 0, user.username, status === 'paused' ? 'CAMPAIGN_PAUSED' : 'CAMPAIGN_RESUMED', '/api/campaigns', `"${sponsorName}"`);
    return NextResponse.json({ ok: true });
  }

  // Full edit — update every editable field
  const {
    sponsor_name, business_category, audio_file_id, audio_file_name, audio_directory_name, audio_local_path, audio_files,
    spots_per_week, distribution_type, per_day_counts,
    allowed_days, time_from, time_to, allowed_breaks,
    position, position_type, start_date, end_date, booking_reference, booking_details, randomize_weekly, go_live_time, expiry_time,
  } = body;

  const filesList = normalizeAudioFilesExpiry(Array.isArray(audio_files) && audio_files.length > 0
    ? audio_files
    : (audio_local_path ? [{ id: audio_file_id, name: audio_file_name, dir: audio_directory_name, localPath: audio_local_path }] : []));
  const firstFile = filesList[0] || { id: audio_file_id, name: audio_file_name, dir: audio_directory_name, localPath: audio_local_path };

  // Captured before the update runs, so the diff has something to compare
  // against — this is what makes the log entry say "spots/week 10 → 28"
  // instead of just "campaign updated".
  const beforeRows = await sql`SELECT * FROM campaigns WHERE id = ${id}`;
  const before = beforeRows[0];
  let beforeFiles: any[] = [];
  try {
    beforeFiles = before?.audio_files ? (typeof before.audio_files === 'string' ? JSON.parse(before.audio_files) : before.audio_files) : [];
  } catch {}

  // If randomize_weekly is being turned on for the first time, seed
  // last_reshuffled_at to now so the first automatic reshuffle happens on
  // the next Melbourne Monday, not immediately overwriting what was just
  // configured moments ago via this very edit.
  const wasRandomizing = before?.randomize_weekly;
  const justEnabled = randomize_weekly && !wasRandomizing;

  const rows = await sql`
    UPDATE campaigns SET
      sponsor_name = ${sponsor_name},
      business_category = ${business_category || null},
      audio_file_id = ${firstFile.id ?? ''},
      audio_file_name = ${firstFile.name ?? ''},
      audio_directory_name = ${firstFile.dir ?? ''},
      audio_local_path = ${firstFile.localPath ?? audio_local_path},
      audio_files = ${JSON.stringify(filesList)},
      spots_per_week = ${spots_per_week},
      distribution_type = ${distribution_type},
      per_day_counts = ${per_day_counts ? JSON.stringify(per_day_counts) : null},
      allowed_days = ${allowed_days ?? null},
      time_from = ${time_from ?? null},
      time_to = ${time_to ?? null},
      allowed_breaks = ${allowed_breaks ?? null},
      position = ${position ?? -1},
      position_type = ${position_type || 'middle'},
      start_date = ${start_date},
      end_date = ${end_date ?? null},
      booking_reference = ${booking_reference || null},
      booking_details = ${booking_details || null},
      randomize_weekly = ${!!randomize_weekly},
      go_live_time = ${go_live_time || '06:00'},
      expiry_time = ${expiry_time || '22:00'}
    WHERE id = ${id}
    RETURNING *
  `;
  if (justEnabled) {
    await sql`UPDATE campaigns SET last_reshuffled_at = NOW() WHERE id = ${id}`;
  }
  if (before) {
    const changeSummary = summarizeCampaignChanges(before, rows[0] ?? {}, beforeFiles, filesList);
    await logActivity((user as any).userId ?? 0, user.username, 'CAMPAIGN_UPDATED', '/api/campaigns', `"${sponsor_name}": ${changeSummary}`);
  }
  return NextResponse.json(rows[0] ?? { ok: true });
}

// DELETE — remove campaign, optionally also removing its schedules and
// actually stripping the sponsor's audio out of every playlist it's in
// (not just deleting the database rows)
export const maxDuration = 60;

export async function DELETE(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id, withSchedules = false, accessToken: providedToken } = await req.json();

  const campaignRows = await sql`SELECT * FROM campaigns WHERE id = ${id}`;
  const campaign = campaignRows[0];
  let schedulesCleaned = 0;

  if (withSchedules && campaign) {
    // Match by campaign_id (reliable) and fall back to audio_file_name
    // for any legacy schedule rows created before that link existed.
    const schedulesToClean = await sql`
      SELECT * FROM schedules
      WHERE campaign_id = ${id}
         OR (campaign_id IS NULL AND audio_file_name = ${campaign.audio_file_name})
    `;

    if (schedulesToClean.length > 0) {
      const accessToken = providedToken || await getValidAccessToken();

      // Same as campaign confirm — Drive writes are the slow part, so
      // process in parallel batches rather than one break at a time.
      const BATCH_SIZE = 15;
      for (let i = 0; i < schedulesToClean.length; i += BATCH_SIZE) {
        const batch = schedulesToClean.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(async (sched: any) => {
          try {
            if (accessToken) {
              await removePathFromPlaylistLocked(sched.playlist_id, sched.audio_local_path, accessToken);
            }
            await sql`DELETE FROM schedules WHERE id = ${sched.id}`;
            schedulesCleaned++;
          } catch (err) {
            console.error('[campaigns] Failed to clean up schedule during delete:', sched.playlist_name, err);
          }
        }));
      }
    }
  }

  await sql`DELETE FROM campaigns WHERE id = ${id}`;
  await logActivity((user as any).userId ?? 0, user.username, 'CAMPAIGN_DELETED', '/api/campaigns',
    `"${campaign?.sponsor_name ?? `#${id}`}" — ${withSchedules ? `${schedulesCleaned} schedule(s) and their audio also removed` : 'schedules NOT removed (may now be orphaned)'}`);
  return NextResponse.json({ ok: true });
}
