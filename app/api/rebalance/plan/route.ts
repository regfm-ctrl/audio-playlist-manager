import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { getValidAccessToken } from '@/lib/google-tokens';
import { computeRebalancePlan } from '@/lib/rebalance';

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const token = req.cookies.get('token')?.value;
  const user = token ? await verifyToken(token) : null;
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const max = parseInt(req.nextUrl.searchParams.get('max') || '2');
  if (!Number.isFinite(max) || max < 1) {
    return NextResponse.json({ error: 'max must be a positive number' }, { status: 400 });
  }

  const accessToken = await getValidAccessToken();
  if (!accessToken) return NextResponse.json({ error: 'Google Drive not connected' }, { status: 400 });

  const plan = await computeRebalancePlan(max, accessToken);
  return NextResponse.json(plan);
}
