import { sql } from '@/lib/db';
import { removePathFromPlaylist } from '@/lib/playlist-ops';
import { addPathToPlaylistOrdered } from '@/lib/playlist-ordering';
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
  positionType: string;
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

// Finds the least-loaded playlist that's genuinely valid for this schedule's
// own campaign rules (day, hour range, specific-breaks restriction, and no
// same-category clash) — shared by both the count-based rebalance and the
// category-conflict fixer below, so a "valid destination" means the exact
// same thing in both places.
function findBestDestination(
  sched: any,
  currentPlaylistId: string,
  allPlaylists: { id: string; name: string }[],
  load: Map<string, number>,
  categoriesByPlaylist: Map<string, Set<string>>,
  maxPerPlaylist: number
): { id: string; name: string } | null {
  const allowedDayNums = sched.allowed_days ? sched.allowed_days.split(',').map(Number) : [0, 1, 2, 3, 4, 5, 6];
  const [fh, fm] = sched.time_from ? sched.time_from.split(':').map(Number) : [0, 0];
  const [th, tm] = sched.time_to ? sched.time_to.split(':').map(Number) : [23, 59];
  const fromMin = fh * 60 + (fm || 0), toMin = th * 60 + (tm || 0);
  const allowedBreakIds = sched.allowed_breaks ? sched.allowed_breaks.split(',') : null;
  const category = sched.business_category ? sched.business_category.toLowerCase() : null;

  const candidates = allPlaylists
    .filter(p => p.id !== currentPlaylistId)
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

  return candidates[0] ?? null;
}

async function fetchActiveSchedulesWithCampaigns() {
  return sql`
    SELECT s.id, s.campaign_id, s.playlist_id, s.playlist_name, s.audio_file_name, s.audio_local_path, s.created_at, s.position_type,
           c.sponsor_name, c.allowed_days, c.time_from, c.time_to, c.allowed_breaks, c.business_category
    FROM schedules s
    LEFT JOIN campaigns c ON c.id = s.campaign_id
    WHERE s.is_active = true
  `;
}

function buildLoadAndCategoryMaps(allPlaylists: { id: string; name: string }[], byPlaylist: Map<string, any[]>) {
  const load = new Map<string, number>();
  for (const p of allPlaylists) load.set(p.id, byPlaylist.get(p.id)?.length ?? 0);

  const categoriesByPlaylist = new Map<string, Set<string>>();
  for (const [plId, scheds] of byPlaylist) {
    const cats = new Set<string>();
    for (const s of scheds) if (s.business_category) cats.add(s.business_category.toLowerCase());
    categoriesByPlaylist.set(plId, cats);
  }
  return { load, categoriesByPlaylist };
}

// Dry run only — reads current state (from the database, since that's kept
// in sync with Drive by everything else in the app, so no need to fetch
// every playlist's actual content) and works out a plan. Nothing is
// written until applyRebalanceMove is called separately.
export async function computeRebalancePlan(maxPerPlaylist: number, accessToken: string): Promise<RebalancePlan> {
  const rows = await fetchActiveSchedulesWithCampaigns();
  const allPlaylists = await listAllPlaylists(accessToken);

  const byPlaylist = new Map<string, any[]>();
  for (const r of rows as any[]) {
    if (!byPlaylist.has(r.playlist_id)) byPlaylist.set(r.playlist_id, []);
    byPlaylist.get(r.playlist_id)!.push(r);
  }

  const { load, categoriesByPlaylist } = buildLoadAndCategoryMaps(allPlaylists, byPlaylist);

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

      const dest = findBestDestination(sched, plId, allPlaylists, load, categoriesByPlaylist, maxPerPlaylist);
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
        positionType: sched.position_type || 'middle',
      });

      load.set(plId, (load.get(plId) ?? 1) - 1);
      load.set(dest.id, (load.get(dest.id) ?? 0) + 1);
      const category = sched.business_category ? sched.business_category.toLowerCase() : null;
      if (category) {
        if (!categoriesByPlaylist.has(dest.id)) categoriesByPlaylist.set(dest.id, new Set());
        categoriesByPlaylist.get(dest.id)!.add(category);
      }
    }
  }

  return { maxPerPlaylist, overloadedPlaylists: overloadedCount, moves, skipped };
}

// Targets breaks that hold two-plus DISTINCT campaigns sharing the same
// business category — regardless of total headcount, unlike the count-based
// plan above. Keeps the oldest campaign in each conflicted category, moves
// every newer conflicting one out. Reuses the exact same destination-finding
// rules, so a fixed break can never create a new conflict elsewhere.
export async function computeCategoryConflictFixPlan(accessToken: string): Promise<RebalancePlan> {
  const rows = (await fetchActiveSchedulesWithCampaigns() as any[])
    .filter(r => r.campaign_id && r.business_category);
  const allPlaylists = await listAllPlaylists(accessToken);

  const byPlaylist = new Map<string, any[]>();
  for (const r of rows) {
    if (!byPlaylist.has(r.playlist_id)) byPlaylist.set(r.playlist_id, []);
    byPlaylist.get(r.playlist_id)!.push(r);
  }

  // Load map covers every active schedule (not just ones with a category),
  // so destination-load checks stay accurate — reuse the full unfiltered
  // fetch for that.
  const allRows = await fetchActiveSchedulesWithCampaigns();
  const fullByPlaylist = new Map<string, any[]>();
  for (const r of allRows as any[]) {
    if (!fullByPlaylist.has(r.playlist_id)) fullByPlaylist.set(r.playlist_id, []);
    fullByPlaylist.get(r.playlist_id)!.push(r);
  }
  const { load, categoriesByPlaylist } = buildLoadAndCategoryMaps(allPlaylists, fullByPlaylist);

  // A generous cap — this fixer isn't count-based, so "max" here just needs
  // to be high enough not to itself become the limiting factor when picking
  // a destination (the real constraint is the category-clash check).
  const EFFECTIVE_MAX = 999;

  const moves: RebalanceMove[] = [];
  const skipped: RebalanceSkipped[] = [];
  let conflictedPlaylists = 0;

  for (const [plId, scheds] of byPlaylist) {
    const byCategory = new Map<string, any[]>();
    for (const s of scheds) {
      const cat = s.business_category.toLowerCase();
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat)!.push(s);
    }

    for (const [, group] of byCategory) {
      const distinctCampaigns = new Set(group.map((g: any) => g.campaign_id));
      if (distinctCampaigns.size < 2) continue;
      conflictedPlaylists++;

      // Keep one schedule per campaign in this break already covered —
      // conflict is about DISTINCT CAMPAIGNS clashing, so keep the oldest
      // campaign's schedule(s) here and move every other campaign's out.
      const sortedByAge = [...group].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      const keepCampaignId = sortedByAge[0].campaign_id;
      const toMove = group.filter((s: any) => s.campaign_id !== keepCampaignId);

      for (const sched of toMove) {
        const dest = findBestDestination(sched, plId, allPlaylists, load, categoriesByPlaylist, EFFECTIVE_MAX);
        if (!dest) {
          skipped.push({
            scheduleId: sched.id, sponsorName: sched.sponsor_name || sched.audio_file_name, playlistName: sched.playlist_name,
            reason: "No valid break available under this campaign's own day/hour/category rules",
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
          positionType: sched.position_type || 'middle',
        });

        load.set(plId, (load.get(plId) ?? 1) - 1);
        load.set(dest.id, (load.get(dest.id) ?? 0) + 1);
        const category = sched.business_category.toLowerCase();
        if (!categoriesByPlaylist.has(dest.id)) categoriesByPlaylist.set(dest.id, new Set());
        categoriesByPlaylist.get(dest.id)!.add(category);
      }
    }
  }

  return { maxPerPlaylist: 0, overloadedPlaylists: conflictedPlaylists, moves, skipped };
}

export async function applyRebalanceMove(move: RebalanceMove, accessToken: string): Promise<boolean> {
  try {
    await removePathFromPlaylist(move.fromPlaylistId, move.audioLocalPath, accessToken);
    await addPathToPlaylistOrdered(move.toPlaylistId, move.audioLocalPath, move.positionType, accessToken);

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
