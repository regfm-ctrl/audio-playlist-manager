import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { getWeeklyOverview } from '@/lib/schedule-overview';

// Read-only. Called server-to-server by the Approval Portal to show the Weekly
// Overview (every sponsor in every break, by day) inside the Portal.
// It is the same data as the Weekly Overview page here, so a campaign that has
// not reached its start date is left out until it goes live.
//
// Auth: Authorization: Bearer <PORTAL_API_SECRET>, same as the other Portal routes.

function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const secret = process.env.PORTAL_API_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'Portal integration not configured (PORTAL_API_SECRET missing)' }, { status: 503 });
  }
  const header = req.headers.get('authorization') || '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!provided || !secretMatches(provided, secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const overview = await getWeeklyOverview();
    return NextResponse.json({ ok: true, overview });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? 'Could not load the overview' }, { status: 500 });
  }
}
