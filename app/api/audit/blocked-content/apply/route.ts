import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { getValidAccessToken } from '@/lib/google-tokens';
import { applyBlockedContentCleanup, type BlockedContentItem } from '@/lib/blocked-window-cleanup';
import { logActivity } from '@/lib/activity';
import { ensureCampaignCategoryColumns } from '@/lib/campaign-schema';

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const token = req.cookies.get('token')?.value;
  const user = token ? await verifyToken(token) : null;
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { items } = await req.json() as { items: BlockedContentItem[] };
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: 'No items provided' }, { status: 400 });
  }

  const accessToken = await getValidAccessToken();
  if (!accessToken) return NextResponse.json({ error: 'Google Drive not connected' }, { status: 400 });

  const result = await applyBlockedContentCleanup(items, accessToken);

  await ensureCampaignCategoryColumns();
  await logActivity((user as any).userId ?? 0, user.username, 'BLOCKED_WINDOW_CONTENT_CLEARED',
    '/admin/audit', `${result.succeeded} of ${result.total} break(s) cleared${result.failed.length > 0 ? `, ${result.failed.length} failed` : ''}`);

  return NextResponse.json(result);
}
