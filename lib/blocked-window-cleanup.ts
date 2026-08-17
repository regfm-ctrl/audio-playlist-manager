import { fetchPlaylistState, savePlaylistContent } from '@/lib/playlist-ops';
import { isProtectedPath } from '@/lib/stings';
import { parseBreakDay, parseBreakMinuteOfDay } from '@/lib/break-time';
import { PLAYLIST_FOLDER_ID } from '@/lib/folder-config';
import { withPlaylistLock } from '@/lib/playlist-lock';
import { getBlockedWindows, isBreakBlocked } from '@/lib/blocked-windows';
import { sql } from '@/lib/db';

export type BlockedContentItem = {
  playlistId: string;
  playlistName: string;
  sponsors: string[]; // real (non-sting) content currently sitting in this blocked break
};

const BATCH_SIZE = 15;

async function listPlaylists(accessToken: string): Promise<{ id: string; name: string }[]> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q='${PLAYLIST_FOLDER_ID}'+in+parents+and+trashed=false&fields=files(id,name)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error('Failed to list playlists');
  const data = await res.json();
  return (data.files || []).filter((f: any) => f.name.endsWith('.m3u8'));
}

// Read-only scan — finds every break that falls inside a blocked window and
// currently has real (non-sting) content sitting in it.
export async function computeBlockedContentPreview(accessToken: string): Promise<{ items: BlockedContentItem[]; scanned: number }> {
  const blockedWindows = await getBlockedWindows();
  if (blockedWindows.length === 0) return { items: [], scanned: 0 };

  const allPlaylists = await listPlaylists(accessToken);
  const inBlockedWindow = allPlaylists.filter((pl) => {
    const day = parseBreakDay(pl.name);
    const minuteOfDay = parseBreakMinuteOfDay(pl.name);
    return isBreakBlocked(day, minuteOfDay, blockedWindows);
  });

  const items: BlockedContentItem[] = [];
  for (let i = 0; i < inBlockedWindow.length; i += BATCH_SIZE) {
    const batch = inBlockedWindow.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(async (pl) => {
      try {
        const state = await fetchPlaylistState(pl.id, accessToken);
        if (!state) return null;
        const realPaths = state.existingPaths.filter((p) => !isProtectedPath(p));
        if (realPaths.length === 0) return null;
        return {
          playlistId: pl.id,
          playlistName: pl.name,
          sponsors: realPaths.map((p) => p.split('\\').pop() || p),
        };
      } catch {
        return null;
      }
    }));
    items.push(...results.filter((r): r is BlockedContentItem => r !== null));
  }

  return { items, scanned: inBlockedWindow.length };
}

// Clears one playlist entirely — every real path AND its stings, since a
// break with no sponsorship breaks at all shouldn't carry an intro/outro
// either. Also deletes the matching schedules rows so the database doesn't
// keep thinking this content is still actively placed somewhere it no
// longer physically is.
async function clearBlockedPlaylist(item: BlockedContentItem, accessToken: string): Promise<boolean> {
  return withPlaylistLock(item.playlistId, async () => {
    const state = await fetchPlaylistState(item.playlistId, accessToken);
    if (!state) throw new Error(`Could not read playlist ${item.playlistId}`);

    const realPaths = state.existingPaths.filter((p) => !isProtectedPath(p));

    for (const path of realPaths) {
      await sql`DELETE FROM schedules WHERE playlist_id = ${item.playlistId} AND audio_local_path = ${path}`;
    }

    const ok = await savePlaylistContent(item.playlistId, '#EXTM3U\n', accessToken);
    if (!ok) throw new Error(`Failed to clear playlist ${item.playlistId}`);
    return true;
  });
}

export async function applyBlockedContentCleanup(
  items: BlockedContentItem[],
  accessToken: string
): Promise<{ succeeded: number; failed: string[]; total: number }> {
  let succeeded = 0;
  const failed: string[] = [];

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const outcomes = await Promise.all(batch.map(async (item) => {
      try {
        await clearBlockedPlaylist(item, accessToken);
        return true;
      } catch (err: any) {
        console.error('[blocked-window-cleanup] Failed:', item.playlistName, err);
        return false;
      }
    }));
    outcomes.forEach((ok, idx) => {
      if (ok) succeeded++;
      else failed.push(batch[idx].playlistName);
    });
  }

  return { succeeded, failed, total: items.length };
}
