import { fetchPlaylistState, savePlaylistContent } from '@/lib/playlist-ops';
import { isIntroPath, isOutroPath, isProtectedPath, buildPlaylistContent, getNextSting } from '@/lib/stings';
import { PLAYLIST_FOLDER_ID } from '@/lib/folder-config';
import { withPlaylistLock } from '@/lib/playlist-lock';

export type StingFormatItem = {
  playlistId: string;
  playlistName: string;
  kind: 'intro' | 'outro';
  currentFileName: string;
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

// Read-only scan — finds every break whose current intro or outro is
// still an MP3, without changing anything.
export async function computeStingFormatPreview(accessToken: string): Promise<{ items: StingFormatItem[]; scanned: number }> {
  const allPlaylists = await listPlaylists(accessToken);

  const items: StingFormatItem[] = [];
  for (let i = 0; i < allPlaylists.length; i += BATCH_SIZE) {
    const batch = allPlaylists.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(async (pl: { id: string; name: string }) => {
      try {
        const state = await fetchPlaylistState(pl.id, accessToken);
        if (!state) return [];
        const found: StingFormatItem[] = [];
        const intro = state.existingPaths.find(isIntroPath);
        if (intro && intro.toLowerCase().endsWith('.mp3')) {
          found.push({ playlistId: pl.id, playlistName: pl.name, kind: 'intro', currentFileName: intro.split('\\').pop() || intro });
        }
        const outro = state.existingPaths.find(isOutroPath);
        if (outro && outro.toLowerCase().endsWith('.mp3')) {
          found.push({ playlistId: pl.id, playlistName: pl.name, kind: 'outro', currentFileName: outro.split('\\').pop() || outro });
        }
        return found;
      } catch {
        return [];
      }
    }));
    items.push(...results.flat());
  }

  return { items, scanned: allPlaylists.length };
}

// Replaces just the specified sting (intro or outro) on one playlist with
// a freshly-picked WAV file, leaving everything else — real content, the
// other sting if it's unaffected — exactly as it was.
async function replaceStingWithWav(playlistId: string, kind: 'intro' | 'outro', accessToken: string): Promise<boolean> {
  return withPlaylistLock(playlistId, async () => {
    const state = await fetchPlaylistState(playlistId, accessToken);
    if (!state) throw new Error(`Could not read playlist ${playlistId}`);
    const { containerName, existingPaths } = state;

    const currentIntro = existingPaths.find(isIntroPath) || null;
    const currentOutro = existingPaths.find(isOutroPath) || null;
    const realPaths = existingPaths.filter((p) => !isProtectedPath(p));

    const newSting = await getNextSting(kind, accessToken, 'wav');
    if (!newSting) throw new Error(`No WAV files available in the ${kind} folder`);

    const introPath = kind === 'intro' ? newSting : currentIntro;
    const outroPath = kind === 'outro' ? newSting : currentOutro;

    const newContent = buildPlaylistContent(containerName, realPaths, introPath, outroPath);
    const ok = await savePlaylistContent(playlistId, newContent, accessToken);
    if (!ok) throw new Error(`Failed to save playlist ${playlistId} while replacing ${kind}`);
    return true;
  });
}

export async function applyStingFormatMigration(
  items: StingFormatItem[],
  accessToken: string
): Promise<{ succeeded: number; failed: string[]; total: number }> {
  let succeeded = 0;
  const failed: string[] = [];

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const outcomes = await Promise.all(batch.map(async (item) => {
      try {
        await replaceStingWithWav(item.playlistId, item.kind, accessToken);
        return true;
      } catch (err: any) {
        console.error('[sting-format-migration] Failed:', item.playlistName, item.kind, err);
        return false;
      }
    }));
    outcomes.forEach((ok, idx) => {
      if (ok) succeeded++;
      else failed.push(`${batch[idx].playlistName} (${batch[idx].kind})`);
    });
  }

  return { succeeded, failed, total: items.length };
}
