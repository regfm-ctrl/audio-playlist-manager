import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { getValidAccessToken } from '@/lib/google-tokens';
import { applyPathMigration } from '@/lib/path-migration';

// Fluid Compute is enabled on this project, raising the execution ceiling
// well past the standard 60s — this is a one-time migration potentially
// touching hundreds of Drive files (each needing a read + a write), so it
// needs the extra headroom.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const token = req.cookies.get('token')?.value;
  const user = token ? await verifyToken(token) : null;
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const accessToken = await getValidAccessToken();
  if (!accessToken) return NextResponse.json({ error: 'Google Drive not connected' }, { status: 400 });

  const result = await applyPathMigration(accessToken);
  return NextResponse.json(result);
}
