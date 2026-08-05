import { NextRequest, NextResponse } from 'next/server';
import { hasStoredToken } from '@/lib/google-tokens';

export async function GET(req: NextRequest) {
  const connected = await hasStoredToken();
  return NextResponse.json({ connected });
}
