import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { getValidAccessToken } from '@/lib/google-tokens';
import { computeReformatPreview } from '@/lib/reformat-playlists';

export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const token = req.cookies.get('token')?.value;
  const user = token ? await verifyToken(token) : null;
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const accessToken = await getValidAccessToken();
  if (!accessToken) return NextResponse.json({ error: 'Google Drive not connected' }, { status: 400 });

  const result = await computeReformatPreview(accessToken);
  return NextResponse.json(result);
}
