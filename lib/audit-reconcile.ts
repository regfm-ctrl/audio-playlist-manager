import { sql } from '@/lib/db';
import { fetchPlaylistState, addPathToPlaylist } from '@/lib/playlist-ops';
import { isProtectedPath } from '@/lib/stings';
import { PLAYLIST_FOLDER_ID } from '@/lib/folder-config';

export type PhantomItem = {
  playlistId: string;
  playlistName: string;
  path: string;
  fileName: string;
};

export type ReconcileResult = {
  scanned: number;
  added: string[];
  phantoms: PhantomItem[];
  errors: string[];
};

// Compares every active schedule (what the database expects to be placed)
// against the real content of every playlist file. Missing items (expected
// but not present) get added automatically — that's purely additive and
// safe. Phantom items (present but not expected by any active schedule)
// are only reported, never removed automatically, since they may be
// legitimate manual additions made outside the scheduling system.
export async function runReconcileAudit(accessToken: string): Promise<ReconcileResult> {
  const schedules = await sql`
    SELECT playlist_id, playlist_name, audio_local_path, audio_file_name
    FROM schedules WHERE is_active = true
  `;
  const expectedByPlaylist = new Map<string, { path: string; audioFileName: string }[]>();
  for (const s of schedules as any[]) {
    if (!expectedByPlaylist.has(s.playlist_id)) expectedByPlaylist.set(s.playlist_id, []);
    expectedByPlaylist.get(s.playlist_id)!.push({ path: s.audio_local_path, audioFileName: s.audio_file_name });
  }

  const listRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q='${PLAYLIST_FOLDER_ID}'+in+parents+and+trashed=false&fields=files(id,name)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!listRes.ok) throw new Error('Failed to list playlists');
  const listData = await listRes.json();
  const playlists = (listData.files || []).filter((f: any) => f.name.endsWith('.m3u8'));

  const added: string[] = [];
  const phantoms: PhantomItem[] = [];
  const errors: string[] = [];

  const BATCH_SIZE = 15;
  for (let i = 0; i < playlists.length; i += BATCH_SIZE) {
    const batch = playlists.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(async (pl: any) => {
      try {
        const state = await fetchPlaylistState(pl.id, accessToken);
        if (!state) { errors.push(`${pl.name}: failed to read`); return; }

        const actualReal = state.existingPaths.filter(p => !isProtectedPath(p));
        const actualSet = new Set(actualReal);
        const expected = expectedByPlaylist.get(pl.id) || [];
        const expectedPaths = new Set(expected.map(e => e.path));

        for (const exp of expected) {
          if (actualSet.has(exp.path)) continue;
          try {
            const outcome = await addPathToPlaylist(pl.id, exp.path, -1, accessToken);
            if (outcome === 'added') added.push(`${pl.name}: ${exp.audioFileName}`);
            else if (outcome === 'failed') errors.push(`${pl.name}: failed to add ${exp.audioFileName}`);
          } catch (err: any) {
            errors.push(`${pl.name}: ${err.message ?? String(err)}`);
          }
        }

        for (const path of actualReal) {
          if (expectedPaths.has(path)) continue;
          const fileName = path.split('\\').pop() || path.split('/').pop() || path;
          phantoms.push({ playlistId: pl.id, playlistName: pl.name, path, fileName });
        }
      } catch (err: any) {
        errors.push(`${pl.name}: ${err.message ?? String(err)}`);
      }
    }));
  }

  return { scanned: playlists.length, added, phantoms, errors };
}
