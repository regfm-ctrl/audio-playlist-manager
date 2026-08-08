import { sql } from '@/lib/db';
import { removePathFromPlaylist, addPathToPlaylist } from '@/lib/playlist-ops';
import { parseBreakDay, parseBreakTime, parseBreakMinuteOfDay, calculateNextRun } from '@/lib/break-time';
import { PLAYLIST_FOLDER_ID } from '@/lib/folder-config';

export type RebalanceMove = {
  scheduleId: number;
  sponsorName: string;
  audioFileName: string;
  audioLocalPath: string;
  fromPlaylistId: string;
  fromPlaylistName: string;
  toPlaylistId: string;
  toPlaylistName: string;
};

export type RebalanceSkipped = {
  scheduleId: number;
  sponsorName: string;
  playlistName: string;
  reason: string;
};

export type RebalancePlan = {
  maxPerPlaylist: number;
  overloadedPlaylists: number;
  moves: RebalanceMove[];
  skipped: RebalanceSkipped[];
};

async function listAllPlaylists(accessToken: string): Promise<{ id: string; name: string }[]> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q='${PLAYLIST_FOLDER_ID}'+in+parents+and+trashed=false&fields=files(id,name)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error('Failed to list playlists');
  const data = await res.json();
  return (data.files || []).filter((f: any) => f.name.endsWith('.m3u8'));
}

// Dry run only — reads current state (from the database, since that's kept
// in sync with Drive by everything else in the app, so no need to fetch
// every playlist's actual content) and works out a plan. Nothing is
// written until applyRebalanceMove is called separately.
export async function computeRebalancePlan(maxPerPlaylist: number, accessToken: string): Promise<RebalancePlan> {
  const rows = await sql`
    SELECT s.id, s.campaign_id, s.playlist_id, s.playlist_name, s.audio_file_name, s.audio_local_path, s.created_at,
           c.sponsor_name, c.allowed_days, c.time_from, c.time_to, c.allowed_breaks, c.business_category
    FROM schedules s
    LEFT JOIN campaigns c ON c.id = s.campaign_id
    WHERE s.is_active = true
  `;

  const allPlaylists = await listAllPlaylists(accessToken);

  const byPlaylist = new Map<string, any[]>();
  for (const r of rows as any[]) {
    if (!byPlaylist.has(r.playlist_id)) byPlaylist.set(r.playlist_id, []);
    byPlaylist.get(r.playlist_id)!.push(r);
  }

  // Tentative load per playlist, updated as moves are planned so later
  // decisions in the same run see an accurate picture
  const load = new Map<string, number>();
  for (const p of allPlaylists) load.set(p.id, byPlaylist.get(p.id)?.length ?? 0);

  // Which business categories are already sitting in each playlist
  const categoriesByPlaylist = new Map<string, Set<string>>();
  for (const [plId, scheds] of byPlaylist) {
    const cats = new Set<string>();
    for (const s of scheds) if (s.business_category) cats.add(s.business_category.toLowerCase());
    categoriesByPlaylist.set(plId, cats);
  }

  const moves: RebalanceMove[] = [];
  const skipped: RebalanceSkipped[] = [];
  let overloadedCount = 0;

  for (const [plId, scheds] of byPlaylist) {
    if (scheds.length <= maxPerPlaylist) continue;
    overloadedCount++;

    // Keep the oldest placements stable, move the newest excess ones
    const sorted = [...scheds].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    const excess = sorted.slice(maxPerPlaylist);

    for (const sched of excess) {
      if (!sched.campaign_id) {
        skipped.push({
          scheduleId: sched.id, sponsorName: sched.audio_file_name, playlistName: sched.playlist_name,
          reason: 'Not linked to a campaign — no rules to check against, left in place',
        });
        continue;
      }

      const allowedDayNums = sched.allowed_days ? sched.allowed_days.split(',').map(Number) : [0, 1, 2, 3, 4, 5, 6];
      const [fh, fm] = sched.time_from ? sched.time_from.split(':').map(Number) : [0, 0];
      const [th, tm] = sched.time_to ? sched.time_to.split(':').map(Number) : [23, 59];
      const fromMin = fh * 60 + (fm || 0), toMin = th * 60 + (tm || 0);
      const allowedBreakIds = sched.allowed_breaks ? sched.allowed_breaks.split(',') : null;
      const category = sched.business_category ? sched.business_category.toLowerCase() : null;

      const candidates = allPlaylists
        .filter(p => p.id !== plId)
        .filter(p => {
          if (allowedBreakIds && !allowedBreakIds.includes(p.id)) return false;
          const day = parseBreakDay(p.name);
          if (day !== null && !allowedDayNums.includes(day)) return false;
          const minuteOfDay = parseBreakMinuteOfDay(p.name);
          if (minuteOfDay !== null && (minuteOfDay < fromMin || minuteOfDay > toMin)) return false;
          if ((load.get(p.id) ?? 0) >= maxPerPlaylist) return false;
          if (category && categoriesByPlaylist.get(p.id)?.has(category)) return false;
          return true;
        })
        .sort((a, b) => (load.get(a.id) ?? 0) - (load.get(b.id) ?? 0));

      const dest = candidates[0];
      if (!dest) {
        skipped.push({
          scheduleId: sched.id, sponsorName: sched.sponsor_name || sched.audio_file_name, playlistName: sched.playlist_name,
          reason: "No valid emptier break available under this campaign's own day/hour/category rules",
        });
        continue;
      }

      moves.push({
        scheduleId: sched.id,
        sponsorName: sched.sponsor_name || sched.audio_file_name,
        audioFileName: sched.audio_file_name,
        audioLocalPath: sched.audio_local_path,
        fromPlaylistId: plId,
        fromPlaylistName: sched.playlist_name,
        toPlaylistId: dest.id,
        toPlaylistName: dest.name,
      });

      load.set(plId, (load.get(plId) ?? 1) - 1);
      load.set(dest.id, (load.get(dest.id) ?? 0) + 1);
      if (category) {
        if (!categoriesByPlaylist.has(dest.id)) categoriesByPlaylist.set(dest.id, new Set());
        categoriesByPlaylist.get(dest.id)!.add(category);
      }
    }
  }

  return { maxPerPlaylist, overloadedPlaylists: overloadedCount, moves, skipped };
}

export async function applyRebalanceMove(move: RebalanceMove, accessToken: string): Promise<boolean> {
  try {
    await removePathFromPlaylist(move.fromPlaylistId, move.audioLocalPath, accessToken);
    await addPathToPlaylist(move.toPlaylistId, move.audioLocalPath, -1, accessToken);

    // The move can land on a genuinely different day and/or time, not just
    // a different block at the same time — so the schedule's own
    // days_of_week/time_of_day/next_run_at bookkeeping needs to reflect
    // the destination, not just playlist_id/playlist_name. Otherwise the
    // Schedules page would show stale info and next_run_at would be
    // computed off the wrong time going forward.
    const day = parseBreakDay(move.toPlaylistName);
    const time = parseBreakTime(move.toPlaylistName);
    const daysOfWeek = day !== null ? String(day) : null;
    const timeOfDay = time ? `${String(time.hour).padStart(2, '0')}:00` : null;
    const nextRun = daysOfWeek && timeOfDay
      ? calculateNextRun('recurring', daysOfWeek, null, timeOfDay)
      : null;

    await sql`
      UPDATE schedules SET
        playlist_id = ${move.toPlaylistId},
        playlist_name = ${move.toPlaylistName},
        days_of_week = COALESCE(${daysOfWeek}, days_of_week),
        time_of_day = COALESCE(${timeOfDay}, time_of_day),
        next_run_at = COALESCE(${nextRun}, next_run_at)
      WHERE id = ${move.scheduleId}
    `;
    return true;
  } catch (err) {
    console.error('[rebalance] Move failed:', move, err);
    return false;
  }
}
