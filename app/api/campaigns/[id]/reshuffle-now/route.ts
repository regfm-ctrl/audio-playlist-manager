import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { verifyToken } from '@/lib/auth';
import { getValidAccessToken } from '@/lib/google-tokens';
import { getPlaylistLoad } from '@/lib/playlist-load';
import { reshuffleOneCampaign } from '@/lib/campaign-reshuffle';

export const maxDuration = 60;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const token = req.cookies.get('token')?.value;
  const user = token ? await verifyToken(token) : null;
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const id = parseInt(params.id);
  const rows = await sql`SELECT * FROM campaigns WHERE id = ${id}`;
  const campaign = rows[0];
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
  if (!campaign.randomize_weekly) {
    return NextResponse.json({ error: 'This campaign does not have Randomize Weekly enabled — reshuffling only applies to campaigns using that option.' }, { status: 400 });
  }
  if (campaign.status !== 'active') {
    return NextResponse.json({ error: 'Campaign is not active' }, { status: 400 });
  }

  const accessToken = await getValidAccessToken();
  if (!accessToken) return NextResponse.json({ error: 'Google Drive not connected' }, { status: 400 });

  const loadByPlaylist = await getPlaylistLoad();
  const detail = await reshuffleOneCampaign(campaign, accessToken, loadByPlaylist);
  return NextResponse.json({ detail });
}
