import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { getValidAccessToken } from '@/lib/google-tokens';
import { PLAYLIST_FOLDER_ID } from '@/lib/folder-config';
import { savePlaylistContent } from '@/lib/playlist-ops';

export const maxDuration = 60;

async function getUser(req: NextRequest) {
  const token = req.cookies.get('token')?.value;
  if (!token) return null;
  return verifyToken(token);
}

async function clearOne(pl: { id: string; name: string }, accessToken: string) {
  try {
    const ok = await savePlaylistContent(pl.id, '#EXTM3U\n', accessToken);
    return { name: pl.name, ok };
  } catch (err: any) {
    return { name: pl.name, ok: false, error: err.message ?? String(err) };
  }
}

// Wipes every playlist in the folder back to a genuinely bare #EXTM3U —
// no Container line, no tracks — so RadioBOSS skips all of them. Names
// are NOT lost: they're already safely stored via /api/playlists/sync-names
// and will be reapplied automatically the next time each break gets real
// content again. Run this once after a folder recreation to clear out
// any stale/phantom content; safe to re-run, but it's destructive to
// whatever's currently in the files, so only run it when nothing should
// currently be populated.
export async function GET(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const accessToken = await getValidAccessToken();
  if (!accessToken) return NextResponse.json({ error: 'Google Drive not connected' }, { status: 400 });

  const listRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q='${PLAYLIST_FOLDER_ID}'+in+parents+and+trashed=false&fields=files(id,name)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!listRes.ok) return NextResponse.json({ error: 'Failed to list playlists' }, { status: 500 });
  const listData = await listRes.json();
  const playlists = (listData.files || []).filter((f: any) => f.name.endsWith('.m3u8'));

  const BATCH_SIZE = 20;
  let cleared = 0;
  const errors: string[] = [];

  for (let i = 0; i < playlists.length; i += BATCH_SIZE) {
    const batch = playlists.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map((pl: any) => clearOne(pl, accessToken)));
    for (const r of results) {
      if (r.ok) cleared++;
      else errors.push(`${r.name}: ${r.error ?? 'save failed'}`);
    }
  }

  return NextResponse.json({ scanned: playlists.length, cleared, errors });
}
