import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { getValidAccessToken } from '@/lib/google-tokens';
import { removePathFromPlaylistLocked } from '@/lib/playlist-ordering';

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const token = req.cookies.get('token')?.value;
  const user = token ? await verifyToken(token) : null;
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { items } = await req.json();
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: 'No items provided' }, { status: 400 });
  }

  const accessToken = await getValidAccessToken();
  if (!accessToken) return NextResponse.json({ error: 'Google Drive not connected' }, { status: 400 });

  const BATCH_SIZE = 15;
  let succeeded = 0;
  const failed: string[] = [];

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch: { playlistId: string; path: string; fileName?: string; playlistName?: string }[] = items.slice(i, i + BATCH_SIZE);
    const outcomes = await Promise.all(batch.map(async (item) => {
      try {
        const removed = await removePathFromPlaylistLocked(item.playlistId, item.path, accessToken);
        return removed;
      } catch (err: any) {
        console.error('[remove-phantom-bulk] Failed:', item, err);
        return false;
      }
    }));
    outcomes.forEach((ok, idx) => {
      if (ok) succeeded++;
      else failed.push(`${batch[idx].fileName ?? batch[idx].path} (${batch[idx].playlistName ?? batch[idx].playlistId})`);
    });
  }

  return NextResponse.json({ succeeded, failed, total: items.length });
}
