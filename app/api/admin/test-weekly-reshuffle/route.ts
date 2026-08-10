import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { reshuffleDueCampaigns } from '@/lib/campaign-reshuffle';

// Fluid Compute headroom — a bulk multi-campaign reshuffle can genuinely
// take a while (each campaign triggers its own burst of Drive calls).
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const token = req.cookies.get('token')?.value;
  const user = token ? await verifyToken(token) : null;
  // Redundant with middleware (which already blocks non-admins from
  // reaching /api/admin/*), but cheap and worth keeping as a second layer
  // given what this endpoint actually does.
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden — admin access required' }, { status: 403 });
  }

  const result = await reshuffleDueCampaigns(true); // force=true: treat every eligible campaign as due, same as a real Monday
  return NextResponse.json(result);
}
