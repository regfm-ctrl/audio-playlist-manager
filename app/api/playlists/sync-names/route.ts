import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { getValidAccessToken } from '@/lib/google-tokens';
import { storeContainerName } from '@/lib/playlist-names';
import { PLAYLIST_FOLDER_ID } from '@/lib/folder-config';

async function getUser(req: NextRequest) {
  const token = req.cookies.get('token')?.value;
  if (!token) return null;
  return verifyToken(token);
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

  let scanned = 0;
  let captured = 0;
  const captures: string[] = [];
  const errors: string[] = [];

  for (const pl of playlists) {
    scanned++;
    try {
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files/${pl.id}?alt=media`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!res.ok) { errors.push(`${pl.name}: fetch failed`); continue; }
      const content = await res.text();
      const match = content.match(/Container=<([^>]+)>(.*)/);
      if (match) {
        const containerName = decodeURIComponent(match[1].replace(/\+/g, ' '));
        if (containerName) {
          await storeContainerName(pl.id, containerName);
          captured++;
          captures.push(`${pl.name}: "${containerName}"`);
        }
      }
    } catch (err: any) {
      errors.push(`${pl.name}: ${err.message ?? String(err)}`);
    }
  }

  return NextResponse.json({ scanned, captured, captures, errors });
}
