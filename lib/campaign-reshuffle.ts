import { sql } from '@/lib/db';
import { getValidAccessToken } from '@/lib/google-tokens';
import { removePathFromPlaylist, addPathToPlaylist } from '@/lib/playlist-ops';
import { parseBreakDay, parseBreakHour, parseBreakMinuteOfDay, melbourneWallTimeToUTC } from '@/lib/break-time';
import { PLAYLIST_FOLDER_ID } from '@/lib/folder-config';

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

// Picks `count` breaks from the pool, spread across distinct day+time
// combinations, actively preferring times NOT used last week — only
// reusing an avoided time if there genuinely aren't enough alternatives.
function pickRandomAvoiding(
  pool: { id: string; name: string }[],
  count: number,
  avoidKeys: Set<string>
): { id: string; name: string }[] {
  if (count <= 0 || pool.length === 0) return [];
  const groups = new Map<string, { id: string; name: string }[]>();
  for (const pl of pool) {
    const day = parseBreakDay(pl.name) ?? 0;
    const minuteOfDay = parseBreakMinuteOfDay(pl.name) ?? 0;
    const key = `${day}-${minuteOfDay}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(pl);
  }
  const shuffledKeys = Array.from(groups.keys()).sort(() => Math.random() - 0.5);
  const preferred = shuffledKeys.filter(k => !avoidKeys.has(k));
  const fallback = shuffledKeys.filter(k => avoidKeys.has(k));
  const orderedKeys = [...preferred, ...fallback];

  const picked: { id: string; name: string }[] = [];
  const pickedIds = new Set<string>();
  for (const key of orderedKeys) {
    if (picked.length >= count) break;
    const candidate = groups.get(key)!.find(c => !pickedIds.has(c.id));
    if (candidate) { picked.push(candidate); pickedIds.add(candidate.id); }
  }
  // Still short (very constrained pool) — reuse groups for extra blocks
  while (picked.length < count) {
    let added = false;
    for (const key of orderedKeys) {
      const candidate = groups.get(key)!.find(c => !pickedIds.has(c.id));
      if (candidate) {
        picked.push(candidate); pickedIds.add(candidate.id); added = true;
        if (picked.length >= count) break;
      }
    }
    if (!added) break;
  }
  return picked;
}

async function reshuffleOneCampaign(campaign: any, accessToken: string): Promise<string> {
  const existingSchedules = await sql`
    SELECT * FROM schedules WHERE campaign_id = ${campaign.id} AND is_active = true
  `;
  const avoidKeys = new Set(
    (existingSchedules as any[]).map(s => `${parseBreakDay(s.playlist_name)}-${parseBreakMinuteOfDay(s.playlist_name)}`)
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
  const pool = matching.filter((pl: any) => !excludedPlaylistIds.has(pl.id));
  const picked = pickRandomAvoiding(pool, campaign.spots_per_week, avoidKeys);

  // Full reshuffle: clear everything currently placed, then place the
  // freshly picked set. This is deliberately different from an edit
  // (which preserves unchanged breaks) — the whole point here is change.
  for (const sched of existingSchedules as any[]) {
    try { await removePathFromPlaylist(sched.playlist_id, sched.audio_local_path, accessToken); } catch {}
    await sql`DELETE FROM schedules WHERE id = ${sched.id}`;
  }

  const weeklyEndDate = campaign.end_date ? new Date(campaign.end_date).toISOString() : null;
  const now = new Date();
  let placed = 0;
  for (const slot of picked) {
    const day = parseBreakDay(slot.name) ?? 0;
    const hour = parseBreakHour(slot.name) ?? 9;
    const timeOfDay = `${String(hour).padStart(2, '0')}:00`;
    try {
      await addPathToPlaylist(slot.id, campaign.audio_local_path, campaign.position ?? -1, accessToken);
      await sql`
        INSERT INTO schedules (
          audio_file_id, audio_file_name, audio_directory_name, audio_local_path,
          playlist_id, playlist_name, position,
          schedule_type, days_of_week, specific_dates, time_of_day,
          next_run_at, expires_at, created_by, campaign_id
        ) VALUES (
          ${campaign.audio_file_id ?? ''}, ${campaign.audio_file_name}, ${campaign.audio_directory_name ?? ''}, ${campaign.audio_local_path},
          ${slot.id}, ${slot.name}, ${campaign.position ?? -1},
          'recurring', ${String(day)}, null, ${timeOfDay},
          ${now.toISOString()}, ${weeklyEndDate}, 'weekly-reshuffle', ${campaign.id}
        )
      `;
      placed++;
    } catch {}
  }

  await sql`UPDATE campaigns SET last_reshuffled_at = NOW() WHERE id = ${campaign.id}`;
  return `${campaign.sponsor_name}: reshuffled to ${placed} break(s)`;
}

// Called from the scheduler cron each run — cheap no-op unless it's a new
// Melbourne week and there's at least one campaign due for reshuffle.
export async function reshuffleDueCampaigns(): Promise<{ processed: number; details: string[] }> {
  const campaigns = await sql`SELECT * FROM campaigns WHERE randomize_weekly = true AND status = 'active'`;
  const due = (campaigns as any[]).filter(isDueForReshuffle);
  if (due.length === 0) return { processed: 0, details: [] };

  const accessToken = await getValidAccessToken();
  if (!accessToken) return { processed: 0, details: ['Weekly reshuffle skipped: Google Drive not connected'] };

  const details: string[] = [];
  for (const campaign of due) {
    try {
      details.push(await reshuffleOneCampaign(campaign, accessToken));
    } catch (err: any) {
      details.push(`${campaign.sponsor_name}: reshuffle failed — ${err.message ?? String(err)}`);
    }
  }
  return { processed: due.length, details };
}
