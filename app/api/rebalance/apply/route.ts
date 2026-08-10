import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { getValidAccessToken } from '@/lib/google-tokens';
import { applyRebalanceMove, type RebalanceMove } from '@/lib/rebalance';

// Fluid Compute is enabled on this project, raising the execution ceiling
// well past the standard 60s — needed here since a large rebalance batch
// (each move needs a Drive read + write) can comfortably exceed 60s once
// there are more than roughly 100 moves.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const token = req.cookies.get('token')?.value;
  const user = token ? await verifyToken(token) : null;
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { moves } = await req.json();
  if (!Array.isArray(moves) || moves.length === 0) {
    return NextResponse.json({ error: 'No moves provided' }, { status: 400 });
  }

  const accessToken = await getValidAccessToken();
  if (!accessToken) return NextResponse.json({ error: 'Google Drive not connected' }, { status: 400 });

  const BATCH_SIZE = 15;
  let succeeded = 0;
  const failed: string[] = [];

  for (let i = 0; i < moves.length; i += BATCH_SIZE) {
    const batch: RebalanceMove[] = moves.slice(i, i + BATCH_SIZE);
    const outcomes = await Promise.all(batch.map(m => applyRebalanceMove(m, accessToken)));
    outcomes.forEach((ok, idx) => {
      if (ok) succeeded++;
      else failed.push(`${batch[idx].sponsorName}: ${batch[idx].fromPlaylistName} → ${batch[idx].toPlaylistName}`);
    });
  }

  return NextResponse.json({ succeeded, failed, total: moves.length });
}
