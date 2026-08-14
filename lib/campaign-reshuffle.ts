import { sql } from '@/lib/db';
import { getPlaylistLoad, MAX_SPONSORS_PER_BREAK } from '@/lib/playlist-load';
import { parseCampaignAudioFiles, getNextCampaignAudioFiles, getValidCampaignAudioFiles } from '@/lib/campaign-audio-rotation';
import { getValidAccessToken } from '@/lib/google-tokens';
import { addPathToPlaylistOrdered, normalizePositionType, removePathFromPlaylistLocked } from '@/lib/playlist-ordering';
import { parseBreakDay, parseBreakHour, parseBreakMinuteOfDay, melbourneWallTimeToUTC } from '@/lib/break-time';
import { PLAYLIST_FOLDER_ID } from '@/lib/folder-config';
import { ensureCampaignCategoryColumns } from '@/lib/campaign-schema';
import { logActivity } from '@/lib/activity';

// Returns YYYY-MM-DD of the most recent Monday in Melbourne time (today's
// date if today is itself a Monday). Used as the weekly reshuffle boundary.
export function getMelbourneMondayDateString(referenceDate: Date = new Date()): string {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Australia/Melbourne',
    year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(referenceDate)) parts[p.type] = p.value;
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const currentWeekday = weekdayMap[parts.weekday];
  const daysSinceMonday = (currentWeekday + 6) % 7;
  const melbDate = new Date(Date.UTC(parseInt(parts.year), parseInt(parts.month) - 1, parseInt(parts.day)));
  melbDate.setUTCDate(melbDate.getUTCDate() - daysSinceMonday);
  return melbDate.toISOString().split('T')[0];
}

function isDueForReshuffle(campaign: any): boolean {
  if (!campaign.randomize_weekly) return false;
  // A campaign whose end date has already passed should never get
  // reshuffled — that would place fresh content with an expiry already in
  // the past, which the very next scheduler run would just remove again
  // moments later. Wasteful, and a brief window where already-expired
  // content could genuinely air.
  if (campaign.end_date) {
    const [y, m, d] = campaign.end_date.split('-').map(Number);
    const [eh, em] = (campaign.expiry_time || '22:00').split(':').map(Number);
    const endThreshold = melbourneWallTimeToUTC(y, m, d, eh, em || 0);
    if (endThreshold <= new Date()) return false;
  }
  const thisMonday = getMelbourneMondayDateString();
  if (!campaign.last_reshuffled_at) return true;
  const lastMonday = getMelbourneMondayDateString(new Date(campaign.last_reshuffled_at));
  return lastMonday < thisMonday;
}

async function getCategoryExcludedPlaylistIds(
  businessCategory: string | null | undefined,
  campaignId: number,
  startDate: string,
  endDate: string | null | undefined
): Promise<Set<string>> {
  const excluded = new Set<string>();
  if (!businessCategory || !businessCategory.trim()) return excluded;

  const sameCategory = await sql`
    SELECT id, start_date, end_date FROM campaigns
    WHERE LOWER(business_category) = LOWER(${businessCategory}) AND id != ${campaignId}
  `;
  const newStart = new Date(startDate).getTime();
  const newEnd = endDate ? new Date(endDate).getTime() : Infinity;
  const conflictingIds = (sameCategory as any[])
    .filter(c => {
      const cStart = new Date(c.start_date).getTime();
      const cEnd = c.end_date ? new Date(c.end_date).getTime() : Infinity;
      return cStart <= newEnd && cEnd >= newStart;
    })
    .map(c => c.id);
  if (conflictingIds.length === 0) return excluded;

  const conflictSet = new Set(conflictingIds);
  const scheduleRows = await sql`SELECT playlist_id, campaign_id FROM schedules WHERE campaign_id IS NOT NULL AND is_active = true`;
  for (const row of scheduleRows as any[]) {
    if (conflictSet.has(row.campaign_id)) excluded.add(row.playlist_id);
  }
  return excluded;
}

// Snapshot of which business categories currently occupy each playlist,
// built once before a batch of campaigns starts reshuffling. Combined
// with the live in-batch updates in reshuffleOneCampaignLocked, this is
// what stops two same-category campaigns processed concurrently in the
// same batch from both landing on the same break — the per-campaign DB
// query alone (getCategoryExcludedPlaylistIds) can't see another
// campaign's picks until that campaign's writes actually land, which is
// exactly the race window this closes.
export async function getInitialCategoryMap(): Promise<Map<string, Set<string>>> {
  const rows = await sql`
    SELECT s.playlist_id, c.business_category
    FROM schedules s
    JOIN campaigns c ON c.id = s.campaign_id
    WHERE s.is_active = true AND c.business_category IS NOT NULL AND c.business_category != ''
  `;
  const map = new Map<string, Set<string>>();
  for (const row of rows as any[]) {
    const cat = row.business_category.toLowerCase();
    if (!map.has(row.playlist_id)) map.set(row.playlist_id, new Set());
    map.get(row.playlist_id)!.add(cat);
  }
  return map;
}

// Picks `count` breaks from the pool, spread across distinct day+time
// combinations, actively preferring times NOT used last week — only
// reusing an avoided time if there genuinely aren't enough alternatives.
function pickRandomAvoiding(
  pool: { id: string; name: string }[],
  count: number,
  avoidKeys: Set<string>,
  loadByPlaylist: Map<string, number>
): { id: string; name: string }[] {
  if (count <= 0 || pool.length === 0) return [];
  const groups = new Map<string, { id: string; name: string }[]>();
  for (const pl of pool) {
    // Hard cap — a break already at the ceiling is never even considered
    // as a candidate, regardless of how constrained the rest of the pool
    // is. This is what actually prevents a break from ever accumulating
    // beyond the limit, on top of the load-based preference below.
    if ((loadByPlaylist.get(pl.id) ?? 0) >= MAX_SPONSORS_PER_BREAK) continue;
    const day = parseBreakDay(pl.name) ?? 0;
    const minuteOfDay = parseBreakMinuteOfDay(pl.name) ?? 0;
    const key = `${day}-${minuteOfDay}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(pl);
  }

  const groupLoad = new Map<string, number>();
  for (const [key, blocks] of groups) {
    groupLoad.set(key, Math.min(...blocks.map(b => loadByPlaylist.get(b.id) ?? 0)));
  }
  // Least-loaded first (spreads across real capacity), with avoiding last
  // week's exact time still taking priority over load, and a random
  // tiebreaker so equally-loaded options still vary week to week.
  const byLoadThenRandom = (a: string, b: string) => (groupLoad.get(a)! - groupLoad.get(b)!) || (Math.random() - 0.5);
  const allKeys = Array.from(groups.keys());
  const preferred = allKeys.filter(k => !avoidKeys.has(k)).sort(byLoadThenRandom);
  const fallback = allKeys.filter(k => avoidKeys.has(k)).sort(byLoadThenRandom);
  const orderedKeys = [...preferred, ...fallback];

  const pickLeastLoaded = (candidates: { id: string; name: string }[]) =>
    candidates.slice().sort((a, b) => (loadByPlaylist.get(a.id) ?? 0) - (loadByPlaylist.get(b.id) ?? 0))[0];

  const picked: { id: string; name: string }[] = [];
  const pickedIds = new Set<string>();
  for (const key of orderedKeys) {
    if (picked.length >= count) break;
    const remaining = groups.get(key)!.filter(c => !pickedIds.has(c.id));
    if (remaining.length === 0) continue;
    const candidate = pickLeastLoaded(remaining);
    picked.push(candidate); pickedIds.add(candidate.id);
  }
  // Still short (very constrained pool) — reuse groups for extra blocks
  while (picked.length < count) {
    let added = false;
    for (const key of orderedKeys) {
      const remaining = groups.get(key)!.filter(c => !pickedIds.has(c.id));
      if (remaining.length === 0) continue;
      const candidate = pickLeastLoaded(remaining);
      picked.push(candidate); pickedIds.add(candidate.id); added = true;
      if (picked.length >= count) break;
    }
    if (!added) break;
  }
  return picked;
}

// Prevents two processes from reshuffling the same campaign at the same
// time — e.g. the automatic scheduler and a manual trigger overlapping.
// Without this, both would read the campaign's placements at nearly the
// same moment, both clear what they saw, and both place a fresh set —
// and since neither knows about the other, freshly-placed audio from one
// attempt can get orphaned by the other's cleanup step, leaving real
// content behind with no schedule row tracking it (exactly the "0
// missing, but untracked items keep appearing" pattern this was built to
// fix). Implemented as a claim-with-timeout row update: only one caller
// can successfully claim the lock, and a stale lock (crashed process)
// auto-expires after 10 minutes rather than blocking the campaign
// forever.
async function acquireReshuffleLock(campaignId: number): Promise<boolean> {
  const rows = await sql`
    UPDATE campaigns
    SET reshuffle_lock_acquired_at = NOW()
    WHERE id = ${campaignId}
      AND (reshuffle_lock_acquired_at IS NULL OR reshuffle_lock_acquired_at < NOW() - INTERVAL '10 minutes')
    RETURNING id
  `;
  return rows.length > 0;
}

async function releaseReshuffleLock(campaignId: number): Promise<void> {
  await sql`UPDATE campaigns SET reshuffle_lock_acquired_at = NULL WHERE id = ${campaignId}`;
}

export async function reshuffleOneCampaign(campaign: any, accessToken: string, loadByPlaylist: Map<string, number>, categoryByPlaylist: Map<string, Set<string>>): Promise<string> {
  await ensureCampaignCategoryColumns();
  const gotLock = await acquireReshuffleLock(campaign.id);
  if (!gotLock) {
    return `${campaign.sponsor_name}: skipped — already being reshuffled by another process right now`;
  }
  try {
    return await reshuffleOneCampaignLocked(campaign, accessToken, loadByPlaylist, categoryByPlaylist);
  } finally {
    await releaseReshuffleLock(campaign.id);
  }
}

async function reshuffleOneCampaignLocked(campaign: any, accessToken: string, loadByPlaylist: Map<string, number>, categoryByPlaylist: Map<string, Set<string>>): Promise<string> {
  const existingSchedules = await sql`
    SELECT * FROM schedules WHERE campaign_id = ${campaign.id} AND is_active = true
  `;
  const avoidKeys = new Set(
    (existingSchedules as any[]).map(s => `${parseBreakDay(s.playlist_name)}-${parseBreakMinuteOfDay(s.playlist_name)}`)
  );
  // Remember what file was sitting in each break before the reshuffle, so
  // if that same break gets picked again, it's never handed straight back
  // the exact file it just had.
  const previousFileByPlaylist = new Map<string, string>(
    (existingSchedules as any[]).map(s => [s.playlist_id, s.audio_local_path])
  );

  const listRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q='${PLAYLIST_FOLDER_ID}'+in+parents+and+trashed=false&fields=files(id,name)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!listRes.ok) throw new Error('Failed to list playlists');
  const listData = await listRes.json();
  const playlists = (listData.files || []).filter((f: any) => f.name.endsWith('.m3u8'));

  const allowedDayNums = campaign.allowed_days ? campaign.allowed_days.split(',').map(Number) : [0, 1, 2, 3, 4, 5, 6];
  // Compare full minute-of-day, not just the hour — otherwise a break at
  // 10:15pm passes an "until 10pm" cutoff since it's still hour "22".
  const [timeFromH, timeFromM] = campaign.time_from ? campaign.time_from.split(':').map(Number) : [0, 0];
  const [timeToH, timeToM] = campaign.time_to ? campaign.time_to.split(':').map(Number) : [23, 59];
  const timeFromMinutes = timeFromH * 60 + (timeFromM || 0);
  const timeToMinutes = timeToH * 60 + (timeToM || 0);
  const allowedBreakIds = campaign.allowed_breaks ? campaign.allowed_breaks.split(',') : null;

  const matching = playlists.filter((pl: any) => {
    if (allowedBreakIds && !allowedBreakIds.includes(pl.id)) return false;
    const day = parseBreakDay(pl.name);
    if (day !== null && !allowedDayNums.includes(day)) return false;
    const minuteOfDay = parseBreakMinuteOfDay(pl.name);
    if (minuteOfDay !== null && (minuteOfDay < timeFromMinutes || minuteOfDay > timeToMinutes)) return false;
    return true;
  });

  const excludedPlaylistIds = await getCategoryExcludedPlaylistIds(
    campaign.business_category, campaign.id, campaign.start_date, campaign.end_date
  );
  // On top of the DB-based exclusion (which catches conflicts with
  // campaigns outside this batch), also check the shared live map — this
  // is what catches two same-category campaigns being reshuffled
  // concurrently in the same batch, since neither one's DB writes are
  // visible to the other yet at the moment they're both deciding.
  const category = campaign.business_category ? campaign.business_category.toLowerCase() : null;
  const pool = matching.filter((pl: any) => {
    if (excludedPlaylistIds.has(pl.id)) return false;
    if (category && categoryByPlaylist.get(pl.id)?.has(category)) return false;
    return true;
  });
  const audioFiles = parseCampaignAudioFiles(campaign);

  // For "per day" distribution, spots_per_week is a stale/unrelated field
  // — the actual target comes from summing per_day_counts, and each day
  // needs its own pick from that day's own pool, same as campaign
  // creation/editing already does it. Using spots_per_week directly here
  // (as this used to) silently used the wrong target and produced a
  // shortfall with no obvious cause.
  let picked: { id: string; name: string }[] = [];
  let effectiveTarget = campaign.spots_per_week;
  if (campaign.distribution_type === 'per_day' && campaign.per_day_counts) {
    let perDayCounts: Record<string, number> = {};
    try {
      perDayCounts = typeof campaign.per_day_counts === 'string' ? JSON.parse(campaign.per_day_counts) : campaign.per_day_counts;
    } catch {}
    effectiveTarget = Object.values(perDayCounts).reduce((sum: number, n: any) => sum + (Number(n) || 0), 0);
    for (const [dayStr, count] of Object.entries(perDayCounts)) {
      const dayNum = parseInt(dayStr);
      const dayPool = pool.filter((pl: any) => parseBreakDay(pl.name) === dayNum);
      const dayAvoid = new Set([...avoidKeys].filter(k => k.startsWith(`${dayNum}-`)));
      picked.push(...pickRandomAvoiding(dayPool, count as number, dayAvoid, loadByPlaylist));
    }
  } else {
    picked = pickRandomAvoiding(pool, campaign.spots_per_week, avoidKeys, loadByPlaylist);
  }

  // Update the shared load map immediately with this campaign's own
  // decisions — removing what it just cleared, adding what it just picked
  // — so any other campaign reshuffling later in the same batch sees an
  // accurate picture instead of a stale snapshot from before this run
  // started. Without this, every campaign in a bulk Monday reshuffle sees
  // the exact same "this break looks empty" picture and independently
  // piles into the same handful of breaks, blind to each other.
  //
  // Same reasoning applies to category exclusion: this whole block runs
  // synchronously with no await in between, so it's atomic relative to
  // other campaigns running concurrently in the same batch — critical,
  // since two same-category campaigns processed at the same moment would
  // otherwise both query the database, both see nothing conflicting yet
  // (neither's picks are written yet), and both independently land on the
  // same break.
  for (const sched of existingSchedules as any[]) {
    loadByPlaylist.set(sched.playlist_id, Math.max(0, (loadByPlaylist.get(sched.playlist_id) ?? 1) - 1));
  }
  for (const slot of picked) {
    loadByPlaylist.set(slot.id, (loadByPlaylist.get(slot.id) ?? 0) + 1);
    if (category) {
      if (!categoryByPlaylist.has(slot.id)) categoryByPlaylist.set(slot.id, new Set());
      categoryByPlaylist.get(slot.id)!.add(category);
    }
  }

  // Diagnostic breakdown of the candidate funnel, only surfaced in the
  // result message when the pick came up short — so a shortfall shows
  // exactly where it happened instead of just a smaller-than-expected
  // number with no explanation.
  const distinctSlots = new Set(pool.map((pl: any) => `${parseBreakDay(pl.name)}-${parseBreakMinuteOfDay(pl.name)}`)).size;
  const shortfallNote = picked.length < effectiveTarget
    ? ` [wanted ${effectiveTarget}, got ${picked.length}: ${playlists.length} total playlists → ${matching.length} match day/hour/allowed-breaks → ${excludedPlaylistIds.size} excluded for category conflict → ${pool.length} in pool (${distinctSlots} distinct times)]`
    : '';

  // Full reshuffle: clear everything currently placed, then place the
  // freshly picked set. This is deliberately different from an edit
  // (which preserves unchanged breaks) — the whole point here is change.
  // Batched in parallel, same pattern as the rest of the app. Only delete
  // the database row if the Drive removal actually succeeded (or genuinely
  // wasn't needed) — never on a real failure, or the audio is orphaned in
  // Drive with no record of it left anywhere.
  const BATCH_SIZE = 15;
  for (let i = 0; i < existingSchedules.length; i += BATCH_SIZE) {
    const batch = (existingSchedules as any[]).slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (sched: any) => {
      try {
        await removePathFromPlaylistLocked(sched.playlist_id, sched.audio_local_path, accessToken);
        await sql`DELETE FROM schedules WHERE id = ${sched.id}`;
      } catch (err) {
        console.error('[reshuffle] Failed to remove/clear schedule:', sched.id, err);
      }
    }));
  }

  const weeklyEndDate = campaign.end_date
    ? (() => {
        const [y, m, d] = campaign.end_date.split('-').map(Number);
        const [eh, em] = (campaign.expiry_time || '22:00').split(':').map(Number);
        return melbourneWallTimeToUTC(y, m, d, eh, em || 0).toISOString();
      })()
    : null;
  const now = new Date();
  let placed = 0;
  // Files pre-assigned sequentially, in slot order, before the parallel
  // Drive work starts — see getNextCampaignAudioFiles for why.
  const rawReshuffleFiles = await getNextCampaignAudioFiles(campaign.id, audioFiles, picked.length);

  // If a break happens to get re-picked and its assigned file is the exact
  // same one it just had, shift to the next file in the valid pool instead
  // — the rotation counter alone has no memory of what any specific break
  // had before, so this needs to be checked explicitly.
  const validFiles = getValidCampaignAudioFiles(audioFiles);
  const reshuffleFiles = picked.map((slot, i) => {
    const file = rawReshuffleFiles[i];
    const previousPath = previousFileByPlaylist.get(slot.id);
    if (previousPath && file.localPath === previousPath && validFiles.length > 1) {
      const idx = validFiles.findIndex(f => f.id === file.id);
      return validFiles[(idx + 1) % validFiles.length];
    }
    return file;
  });
  const errors: string[] = [];
  for (let i = 0; i < picked.length; i += BATCH_SIZE) {
    const batch = picked.slice(i, i + BATCH_SIZE);
    const batchFiles = reshuffleFiles.slice(i, i + BATCH_SIZE);
    const outcomes = await Promise.all(batch.map(async (slot, j) => {
      const day = parseBreakDay(slot.name) ?? 0;
      const hour = parseBreakHour(slot.name) ?? 9;
      const timeOfDay = `${String(hour).padStart(2, '0')}:00`;
      try {
        const file = batchFiles[j];
        await addPathToPlaylistOrdered(slot.id, file.localPath, normalizePositionType(campaign.position_type), accessToken);
        await sql`
          INSERT INTO schedules (
            audio_file_id, audio_file_name, audio_directory_name, audio_local_path,
            playlist_id, playlist_name, position, position_type,
            schedule_type, days_of_week, specific_dates, time_of_day,
            next_run_at, expires_at, created_by, campaign_id
          ) VALUES (
            ${file.id ?? ''}, ${file.name ?? ''}, ${file.dir ?? ''}, ${file.localPath},
            ${slot.id}, ${slot.name}, ${campaign.position ?? -1}, ${normalizePositionType(campaign.position_type)},
            'recurring', ${String(day)}, null, ${timeOfDay},
            ${now.toISOString()}, ${weeklyEndDate}, 'weekly-reshuffle', ${campaign.id}
          )
        `;
        return true;
      } catch (err: any) {
        console.error(`[reshuffle] Failed to place ${slot.name} for campaign ${campaign.id}:`, err);
        errors.push(`${slot.name}: ${err.message ?? String(err)}`);
        return false;
      }
    }));
    placed += outcomes.filter(Boolean).length;
  }

  await sql`UPDATE campaigns SET last_reshuffled_at = NOW() WHERE id = ${campaign.id}`;
  const errorSummary = errors.length > 0
    ? ` — ${errors.length} FAILED: ${errors.slice(0, 5).join(' | ')}${errors.length > 5 ? ` ...and ${errors.length - 5} more` : ''}`
    : '';
  return `${campaign.sponsor_name}: reshuffled to ${placed} break(s)${errorSummary}${shortfallNote}`;
}

// Called from the scheduler cron each run — cheap no-op unless it's a new
// Melbourne week and there's at least one campaign due for reshuffle.
// force=true skips the "is it actually Monday" check and treats every
// eligible campaign as due — used to manually trigger the real weekly
// reshuffle process on demand (e.g. to verify a fix), rather than a
// separate simulated code path that could behave differently from what
// actually runs on the real Monday.
export async function reshuffleDueCampaigns(force = false): Promise<{ processed: number; totalEligible: number; details: string[] }> {
  // Ordered by least-recently-reshuffled first — this is what makes
  // repeated manual triggers (or repeated hourly runs on a real busy
  // Monday) correctly work through the whole list over several calls,
  // rather than the same capped-off first batch getting reprocessed every
  // time. Each campaign's last_reshuffled_at gets set to "now" the moment
  // it's processed, which naturally pushes it to the back of the queue.
  const campaigns = await sql`
    SELECT * FROM campaigns
    WHERE randomize_weekly = true AND status = 'active'
    ORDER BY last_reshuffled_at ASC NULLS FIRST
  `;
  const due = force ? (campaigns as any[]) : (campaigns as any[]).filter(isDueForReshuffle);
  if (due.length === 0) return { processed: 0, totalEligible: due.length, details: [] };

  const accessToken = await getValidAccessToken();
  if (!accessToken) return { processed: 0, totalEligible: due.length, details: ['Weekly reshuffle skipped: Google Drive not connected'] };

  const loadByPlaylist = await getPlaylistLoad();
  const categoryByPlaylist = await getInitialCategoryMap();

  // Every campaign with weekly randomization enabled becomes due on the
  // same Monday, all at once — this grows directly with campaign count, so
  // it's capped and batched too (smaller batch than elsewhere, since each
  // campaign itself triggers a burst of Drive calls internally). Anything
  // beyond the cap simply waits for the next hourly run, same as the
  // due/expired schedule caps.
  const CAMPAIGN_CAP = 20;
  const dueThisRun = due.slice(0, CAMPAIGN_CAP);

  const details: string[] = [];
  const CAMPAIGN_BATCH_SIZE = 4;
  for (let i = 0; i < dueThisRun.length; i += CAMPAIGN_BATCH_SIZE) {
    const batch = dueThisRun.slice(i, i + CAMPAIGN_BATCH_SIZE);
    const batchDetails = await Promise.all(batch.map(async (campaign) => {
      try {
        return await reshuffleOneCampaign(campaign, accessToken, loadByPlaylist, categoryByPlaylist);
      } catch (err: any) {
        return `${campaign.sponsor_name}: reshuffle failed — ${err.message ?? String(err)}`;
      }
    }));
    details.push(...batchDetails);
  }
  if (dueThisRun.length > 0) {
    const errorCount = details.filter((d) => d.includes('FAILED') || d.includes('failed')).length;
    await logActivity(0, 'scheduler', force ? 'RESHUFFLE_MANUAL_TRIGGER' : 'RESHUFFLE_AUTOMATIC',
      '/api/schedules/run',
      `Processed ${dueThisRun.length} of ${due.length} eligible campaign(s)${errorCount > 0 ? `, ${errorCount} with errors` : ''}`);
  }
  return { processed: dueThisRun.length, totalEligible: due.length, details };
}
