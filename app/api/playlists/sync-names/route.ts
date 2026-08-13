import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { getValidAccessToken } from '@/lib/google-tokens';
import { storeContainerName } from '@/lib/playlist-names';
import { PLAYLIST_FOLDER_ID } from '@/lib/folder-config';

// Give this route as much time as the plan allows — with a lot of break
// files, even parallel batches can take a little while.
export const maxDuration = 60;

async function getUser(req: NextRequest) {
  const token = req.cookies.get('token')?.value;
  if (!token) return null;
  return verifyToken(token);
}

async function scanOne(pl: { id: string; name: string }, accessToken: string) {
  try {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${pl.id}?alt=media`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) return { name: pl.name, error: 'fetch failed' as const };
    const content = await res.text();
    // Case-insensitive: matches both the current lowercase "container="
    // and legacy capital "Container=" from files not yet rewritten.
    const match = content.match(/container=<([^>]+)>(.*)/i);
    if (match) {
      const containerName = decodeURIComponent(match[1].replace(/\+/g, ' '));
      if (containerName) {
        await storeContainerName(pl.id, containerName);
        return { name: pl.name, containerName };
      }
    }
    return { name: pl.name, containerName: null };
  } catch (err: any) {
    return { name: pl.name, error: err.message ?? String(err) };
  }
}

// Run this once (safe to re-run any time) to capture the display name
// currently sitting in every playlist file — including your pristine
// predefined ones that haven't been touched by the app yet — before the
// app's own writes ever have a chance to affect them. Visit this URL
// directly in the browser while logged in, or GET it from anywhere.
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
  const captures: string[] = [];
  const errors: string[] = [];
  let captured = 0;

  for (let i = 0; i < playlists.length; i += BATCH_SIZE) {
    const batch = playlists.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map((pl: any) => scanOne(pl, accessToken)));
    for (const r of results) {
      if ('error' in r && r.error) { errors.push(`${r.name}: ${r.error}`); continue; }
      if ('containerName' in r && r.containerName) {
        captured++;
        captures.push(`${r.name}: "${r.containerName}"`);
      }
    }
  }

  return NextResponse.json({ scanned: playlists.length, captured, captures, errors });
}
