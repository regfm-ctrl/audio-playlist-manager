import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { getValidAccessToken } from '@/lib/google-tokens';

// Returns a currently-valid Google Drive access token, refreshing it
// server-side (via the stored refresh token) if it's expired or close to it.
// The browser should call this instead of doing its own Google sign-in —
// this is what lets the app stay connected indefinitely without ever
// showing the "Connect Google Drive" screen again.
export async function GET(req: NextRequest) {
  const token = req.cookies.get('token')?.value;
  const user = token ? await verifyToken(token) : null;
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const accessToken = await getValidAccessToken();

  const res = NextResponse.json({ accessToken });
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  return res;
}
