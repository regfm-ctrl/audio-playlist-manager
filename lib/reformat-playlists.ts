import { fetchPlaylistState, savePlaylistContent } from '@/lib/playlist-ops';
import { isIntroPath, isOutroPath, isProtectedPath, buildPlaylistContent } from '@/lib/stings';
import { PLAYLIST_FOLDER_ID } from '@/lib/folder-config';
import { withPlaylistLock } from '@/lib/playlist-lock';

export type ReformatItem = { playlistId: string; playlistName: string; trackCount: number };

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

// Read-only scan — a file written by the old (crashing) format never has
// an #EXTINF line; a file already resaved through the corrected writer
// always does. That single marker reliably tells the two apart without
// needing to separately check path-encoding or the container= case.
// Genuinely empty breaks (no real content) are correctly skipped — there's
// nothing in them to reformat.
export async function computeReformatPreview(accessToken: string): Promise<{ items: ReformatItem[]; scanned: number }> {
  const allPlaylists = await listPlaylists(accessToken);

  const items: ReformatItem[] = [];
  for (let i = 0; i < allPlaylists.length; i += BATCH_SIZE) {
    const batch = allPlaylists.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(async (pl) => {
      try {
        const res = await fetch(`https://www.googleapis.com/drive/v3/files/${pl.id}?alt=media`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) return null;
        const content = await res.text();
        if (!content.includes('container=') && !content.includes('Container=')) return null; // genuinely empty
        if (content.includes('#EXTINF')) return null; // already in the new format

        const state = await fetchPlaylistState(pl.id, accessToken);
        if (!state) return null;
        const realCount = state.existingPaths.filter((p) => !isProtectedPath(p)).length;
        if (realCount === 0) return null;
        return { playlistId: pl.id, playlistName: pl.name, trackCount: realCount };
      } catch {
        return null;
      }
    }));
    items.push(...results.filter((r): r is ReformatItem => r !== null));
  }

  return { items, scanned: allPlaylists.length };
}

// Re-saves one playlist's exact current content through the corrected
// writer — same paths, same intro/outro, same order, just written in the
// syntax RadioBOSS actually expects instead of the one that was crashing it.
async function reformatPlaylist(playlistId: string, accessToken: string): Promise<boolean> {
  return withPlaylistLock(playlistId, async () => {
    const state = await fetchPlaylistState(playlistId, accessToken);
    if (!state) throw new Error(`Could not read playlist ${playlistId}`);
    const { containerName, existingPaths } = state;

    const introPath = existingPaths.find(isIntroPath) || null;
    const outroPath = existingPaths.find(isOutroPath) || null;
    const realPaths = existingPaths.filter((p) => !isProtectedPath(p));
    if (realPaths.length === 0) return false;

    const newContent = buildPlaylistContent(containerName, realPaths, introPath, outroPath);
    const ok = await savePlaylistContent(playlistId, newContent, accessToken);
    if (!ok) throw new Error(`Failed to save playlist ${playlistId} while reformatting`);
    return true;
  });
}

export async function applyReformat(
  items: ReformatItem[],
  accessToken: string
): Promise<{ succeeded: number; failed: string[]; total: number }> {
  let succeeded = 0;
  const failed: string[] = [];

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const outcomes = await Promise.all(batch.map(async (item) => {
      try {
        await reformatPlaylist(item.playlistId, accessToken);
        return true;
      } catch (err: any) {
        console.error('[reformat-playlists] Failed:', item.playlistName, err);
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
