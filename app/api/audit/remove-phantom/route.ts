import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { getValidAccessToken } from '@/lib/google-tokens';
import { removePathFromPlaylist } from '@/lib/playlist-ops';

export async function POST(req: NextRequest) {
  const token = req.cookies.get('token')?.value;
  const user = token ? await verifyToken(token) : null;
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { playlistId, path } = await req.json();
  if (!playlistId || !path) return NextResponse.json({ error: 'Missing playlistId or path' }, { status: 400 });

  const accessToken = await getValidAccessToken();
  if (!accessToken) return NextResponse.json({ error: 'Google Drive not connected' }, { status: 400 });

  try {
    const removed = await removePathFromPlaylist(playlistId, path, accessToken);
    return NextResponse.json({ ok: removed });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err.message ?? String(err) }, { status: 500 });
  }
}
