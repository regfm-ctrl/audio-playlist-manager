import { fetchPlaylistState, savePlaylistContent } from '@/lib/playlist-ops';
import { isIntroPath, isOutroPath, isProtectedPath, buildPlaylistContent } from '@/lib/stings';
import { PLAYLIST_FOLDER_ID } from '@/lib/folder-config';
import { withPlaylistLock } from '@/lib/playlist-lock';

export type StingRemovalItem = {
  playlistId: string;
  playlistName: string;
  hasIntro: boolean;
  hasOutro: boolean;
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

// Read-only scan — finds every break that still has an intro and/or
// outro sting present, without changing anything.
export async function computeStingRemovalPreview(accessToken: string): Promise<{ items: StingRemovalItem[]; scanned: number }> {
  const allPlaylists = await listPlaylists(accessToken);

  const items: StingRemovalItem[] = [];
  for (let i = 0; i < allPlaylists.length; i += BATCH_SIZE) {
    const batch = allPlaylists.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(async (pl) => {
      try {
        const state = await fetchPlaylistState(pl.id, accessToken);
        if (!state) return null;
        const hasIntro = state.existingPaths.some(isIntroPath);
        const hasOutro = state.existingPaths.some(isOutroPath);
        if (!hasIntro && !hasOutro) return null;
        return { playlistId: pl.id, playlistName: pl.name, hasIntro, hasOutro };
      } catch {
        return null;
      }
    }));
    items.push(...results.filter((r): r is StingRemovalItem => r !== null));
  }

  return { items, scanned: allPlaylists.length };
}

// Rewrites one playlist with every sting removed and every real content
// item preserved exactly as-is, in the same order.
async function removeStingsFromPlaylist(playlistId: string, accessToken: string): Promise<boolean> {
  return withPlaylistLock(playlistId, async () => {
    const state = await fetchPlaylistState(playlistId, accessToken);
    if (!state) throw new Error(`Could not read playlist ${playlistId}`);
    const { containerName, existingPaths } = state;

    const realPaths = existingPaths.filter((p) => !isProtectedPath(p));
    const stillHasSting = existingPaths.some((p) => isIntroPath(p) || isOutroPath(p));
    if (!stillHasSting) return false; // already clean — nothing to do

    const newContent = realPaths.length > 0
      ? buildPlaylistContent(containerName, realPaths, null, null)
      : '#EXTM3U\n';
    const ok = await savePlaylistContent(playlistId, newContent, accessToken);
    if (!ok) throw new Error(`Failed to save playlist ${playlistId} while removing stings`);
    return true;
  });
}

export async function applyStingRemoval(
  items: StingRemovalItem[],
  accessToken: string
): Promise<{ succeeded: number; failed: string[]; total: number }> {
  let succeeded = 0;
  const failed: string[] = [];

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const outcomes = await Promise.all(batch.map(async (item) => {
      try {
        await removeStingsFromPlaylist(item.playlistId, accessToken);
        return true;
      } catch (err: any) {
        console.error('[sting-removal-cleanup] Failed:', item.playlistName, err);
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
