import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { applyStaleAudioRefFix, type StaleAudioRefItem } from '@/lib/stale-audio-ref-cleanup';
import { logActivity } from '@/lib/activity';
import { ensureCampaignCategoryColumns } from '@/lib/campaign-schema';

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const token = req.cookies.get('token')?.value;
  const user = token ? await verifyToken(token) : null;
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { items } = await req.json() as { items: StaleAudioRefItem[] };
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: 'No items provided' }, { status: 400 });
  }

  const result = await applyStaleAudioRefFix(items);

  await ensureCampaignCategoryColumns();
  await logActivity((user as any).userId ?? 0, user.username, 'STALE_AUDIO_REFS_FIXED',
    '/admin/audit', `${result.succeeded} of ${result.total} reference(s) fixed${result.failed.length > 0 ? `, ${result.failed.length} failed` : ''}`);

  return NextResponse.json(result);
}
