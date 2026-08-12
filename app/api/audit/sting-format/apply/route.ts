import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { getValidAccessToken } from '@/lib/google-tokens';
import { applyStingFormatMigration, type StingFormatItem } from '@/lib/sting-format-migration';
import { logActivity } from '@/lib/activity';
import { ensureCampaignCategoryColumns } from '@/lib/campaign-schema';

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const token = req.cookies.get('token')?.value;
  const user = token ? await verifyToken(token) : null;
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { items } = await req.json() as { items: StingFormatItem[] };
  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: 'No items provided' }, { status: 400 });
  }

  const accessToken = await getValidAccessToken();
  if (!accessToken) return NextResponse.json({ error: 'Google Drive not connected' }, { status: 400 });

  const result = await applyStingFormatMigration(items, accessToken);

  await ensureCampaignCategoryColumns();
  await logActivity((user as any).userId ?? 0, user.username, 'STING_FORMAT_MIGRATED',
    '/admin/audit', `${result.succeeded} of ${result.total} sting(s) switched to WAV${result.failed.length > 0 ? `, ${result.failed.length} failed` : ''}`);

  return NextResponse.json(result);
}
