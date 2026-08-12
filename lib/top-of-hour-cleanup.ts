import { fetchPlaylistState, savePlaylistContent } from '@/lib/playlist-ops';
import { isIntroPath, isOutroPath, isProtectedPath, buildPlaylistContent } from '@/lib/stings';
import { parseBreakMinute } from '@/lib/break-time';
import { PLAYLIST_FOLDER_ID } from '@/lib/folder-config';
import { withPlaylistLock } from '@/lib/playlist-lock';

export type TopOfHourOutroItem = { playlistId: string; playlistName: string; outroFileName: string };

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

// Read-only scan — finds every top-of-hour break (minute = 00) that
// currently has an outro sting, without changing anything.
export async function computeTopOfHourOutroPreview(accessToken: string): Promise<{ items: TopOfHourOutroItem[]; scanned: number }> {
  const allPlaylists = await listPlaylists(accessToken);
  const topOfHour = allPlaylists.filter((pl) => parseBreakMinute(pl.name) === 0);

  const items: TopOfHourOutroItem[] = [];
  for (let i = 0; i < topOfHour.length; i += BATCH_SIZE) {
    const batch = topOfHour.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(async (pl) => {
      try {
        const state = await fetchPlaylistState(pl.id, accessToken);
        if (!state) return null;
        const outro = state.existingPaths.find(isOutroPath);
        if (!outro) return null;
        return { playlistId: pl.id, playlistName: pl.name, outroFileName: outro.split('\\').pop() || outro };
      } catch {
        return null;
      }
    }));
    items.push(...results.filter((r): r is TopOfHourOutroItem => r !== null));
  }

  return { items, scanned: topOfHour.length };
}

// Removes just the outro from one playlist, keeping the intro and all
// real content exactly as they were. Locked, since this is a read-then-
// write sequence like every other break-modifying operation.
async function removeOutroFromPlaylist(playlistId: string, accessToken: string): Promise<boolean> {
  return withPlaylistLock(playlistId, async () => {
    const state = await fetchPlaylistState(playlistId, accessToken);
    if (!state) throw new Error(`Could not read playlist ${playlistId}`);
    const { containerName, existingPaths } = state;

    const introPath = existingPaths.find(isIntroPath) || null;
    const realPaths = existingPaths.filter((p) => !isProtectedPath(p));
    const stillHasOutro = existingPaths.some(isOutroPath);
    if (!stillHasOutro) return false; // already clean — nothing to do

    const newContent = buildPlaylistContent(containerName, realPaths, introPath, null);
    const ok = await savePlaylistContent(playlistId, newContent, accessToken);
    if (!ok) throw new Error(`Failed to save playlist ${playlistId} while removing outro`);
    return true;
  });
}

export async function applyTopOfHourOutroCleanup(
  items: TopOfHourOutroItem[],
  accessToken: string
): Promise<{ succeeded: number; failed: string[]; total: number }> {
  let succeeded = 0;
  const failed: string[] = [];

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const outcomes = await Promise.all(batch.map(async (item) => {
      try {
        await removeOutroFromPlaylist(item.playlistId, accessToken);
        return true;
      } catch (err: any) {
        console.error('[top-of-hour-cleanup] Failed:', item.playlistName, err);
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
