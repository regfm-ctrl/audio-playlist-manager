import { NextRequest, NextResponse } from 'next/server';
import { hasStoredToken } from '@/lib/google-tokens';

export async function GET(req: NextRequest) {
  const connected = await hasStoredToken();
  const res = NextResponse.json({ connected });
  res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  return res;
}
