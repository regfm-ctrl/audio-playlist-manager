import { sql } from '@/lib/db';
import { fetchPlaylistState, savePlaylistContent, removePathFromPlaylist as removePathFromPlaylistUnlocked } from '@/lib/playlist-ops';
import { isIntroPath, isOutroPath, isProtectedPath, buildPlaylistContent, getNextSting } from '@/lib/stings';
import { parseBreakMinute } from '@/lib/break-time';
import { withPlaylistLock } from '@/lib/playlist-lock';

export type PositionType = 'first' | 'middle' | 'second_last' | 'last';

const POSITION_WEIGHT: Record<string, number> = { first: 0, middle: 1, second_last: 2, last: 3 };

export function normalizePositionType(value: any): PositionType {
  return value === 'first' || value === 'second_last' || value === 'last' ? value : 'middle';
}

// Adds a path to a playlist, respecting position pinning ('first',
// 'second_last', 'last') for everything currently in that break — not
// just the item being added. Unlike a plain insert-at-index, this always
// re-sorts the break's full real content by each item's declared
// position, so a pin stays correct even as other, unrelated campaigns are
// independently added to or removed from the same break over time.
//
// The database (active schedules for this playlist) is the source of
// truth for what each existing item's position preference is — anything
// not tracked there (e.g. a manual addition) is treated as 'middle',
// same as no preference at all.
//
// Wrapped in a per-playlist lock (see lib/playlist-lock.ts) — this reads
// the current state, queries the database, and writes an updated version
// back, none of which is atomic on its own. Without the lock, two
// concurrent calls targeting the same break (routine when several
// campaigns get reshuffled around the same time) can silently overwrite
// each other.
export async function addPathToPlaylistOrdered(
  playlistId: string,
  pathToAdd: string,
  positionType: string | null | undefined,
  accessToken: string
): Promise<'added' | 'already_present'> {
  return withPlaylistLock(playlistId, () => addPathToPlaylistOrderedUnlocked(playlistId, pathToAdd, positionType, accessToken));
}

async function addPathToPlaylistOrderedUnlocked(
  playlistId: string,
  pathToAdd: string,
  positionType: string | null | undefined,
  accessToken: string
): Promise<'added' | 'already_present'> {
  const state = await fetchPlaylistState(playlistId, accessToken);
  if (!state) throw new Error(`Could not read playlist ${playlistId} to add ${pathToAdd}`);
  const { containerName, existingPaths } = state;
  if (existingPaths.includes(pathToAdd)) return 'already_present';

  const realPaths = existingPaths.filter((p) => !isProtectedPath(p));
  const wasEmpty = realPaths.length === 0;

  const typeByPath = new Map<string, string>();
  if (realPaths.length > 0) {
    const rows = await sql`
      SELECT audio_local_path, position_type FROM schedules
      WHERE playlist_id = ${playlistId} AND is_active = true
    `;
    for (const r of rows as any[]) typeByPath.set(r.audio_local_path, r.position_type || 'middle');
  }

  const items = realPaths.map((p, i) => ({
    path: p,
    weight: POSITION_WEIGHT[normalizePositionType(typeByPath.get(p))],
    order: i,
  }));
  items.push({ path: pathToAdd, weight: POSITION_WEIGHT[normalizePositionType(positionType)], order: items.length });
  items.sort((a, b) => a.weight - b.weight || a.order - b.order);
  const orderedRealPaths = items.map((i) => i.path);

  let introPath = existingPaths.find(isIntroPath) || null;
  let outroPath = existingPaths.find(isOutroPath) || null;
  if (wasEmpty) {
    introPath = await getNextSting('intro', accessToken);
    // Top-of-hour breaks (6:00am, 7:00am, etc.) get an intro only, no
    // outro — every other break gets both.
    const isTopOfHour = parseBreakMinute(containerName) === 0;
    outroPath = isTopOfHour ? null : await getNextSting('outro', accessToken);
  }

  const newContent = buildPlaylistContent(containerName, orderedRealPaths, introPath, outroPath);
  const ok = await savePlaylistContent(playlistId, newContent, accessToken);
  if (!ok) throw new Error(`Failed to save playlist ${playlistId} after adding ${pathToAdd}`);
  return 'added';
}

// Re-sorts a playlist's existing content by each item's current position
// preference, without adding anything new — used when a schedule already
// in a break has its position_type changed (e.g. a campaign edited to
// "Last in Break"), so the reordering takes effect immediately rather
// than waiting for some unrelated future change to that break to trigger
// it incidentally. Same locking reasoning as above.
export async function reorderPlaylistByPosition(playlistId: string, accessToken: string): Promise<boolean> {
  return withPlaylistLock(playlistId, () => reorderPlaylistByPositionUnlocked(playlistId, accessToken));
}

async function reorderPlaylistByPositionUnlocked(playlistId: string, accessToken: string): Promise<boolean> {
  const state = await fetchPlaylistState(playlistId, accessToken);
  if (!state) throw new Error(`Could not read playlist ${playlistId} to reorder`);
  const { containerName, existingPaths } = state;
  const realPaths = existingPaths.filter((p) => !isProtectedPath(p));
  if (realPaths.length === 0) return false;

  const rows = await sql`
    SELECT audio_local_path, position_type FROM schedules
    WHERE playlist_id = ${playlistId} AND is_active = true
  `;
  const typeByPath = new Map<string, string>();
  for (const r of rows as any[]) typeByPath.set(r.audio_local_path, r.position_type || 'middle');

  const items = realPaths.map((p, i) => ({
    path: p,
    weight: POSITION_WEIGHT[normalizePositionType(typeByPath.get(p))],
    order: i,
  }));
  items.sort((a, b) => a.weight - b.weight || a.order - b.order);
  const orderedRealPaths = items.map((i) => i.path);

  // No actual change in order — skip the write entirely
  if (orderedRealPaths.every((p, i) => p === realPaths[i])) return false;

  const introPath = existingPaths.find(isIntroPath) || null;
  const outroPath = existingPaths.find(isOutroPath) || null;
  const newContent = buildPlaylistContent(containerName, orderedRealPaths, introPath, outroPath);
  const ok = await savePlaylistContent(playlistId, newContent, accessToken);
  if (!ok) throw new Error(`Failed to save playlist ${playlistId} while reordering`);
  return true;
}

// Locked equivalent of removePathFromPlaylist — same read-then-write race
// applies to removal too (e.g. two campaigns both being reshuffled at
// once, each clearing their own old placement from a break they happen to
// share). Every caller that adds or removes content from a break should
// use the locked versions in this file rather than the raw ones in
// lib/playlist-ops.ts directly, so a lock covers the full read-modify-
// write sequence consistently everywhere.
export async function removePathFromPlaylistLocked(playlistId: string, pathToRemove: string, accessToken: string): Promise<boolean> {
  return withPlaylistLock(playlistId, () => removePathFromPlaylistUnlocked(playlistId, pathToRemove, accessToken));
}
