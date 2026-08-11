import { NextRequest, NextResponse } from 'next/server';
import { findCategoryConflicts } from '@/lib/category-conflicts';
import { logActivity } from '@/lib/activity';
import { ensureCampaignCategoryColumns } from '@/lib/campaign-schema';

const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await ensureCampaignCategoryColumns();
  const conflicts = await findCategoryConflicts();

  // Logged here (not just returned) so it shows up in the Admin activity
  // log even if nobody happens to check the script's own log file.
  await logActivity(0, 'scheduler', 'CATEGORY_CONFLICT_CHECK', '/api/cron/category-conflicts-check',
    conflicts.length === 0 ? 'None found — every break is clean' : `${conflicts.length} conflicting break(s) found`);

  return NextResponse.json({
    ok: true,
    conflictCount: conflicts.length,
    conflicts: conflicts.map((c: any) => ({
      playlist: c.playlistName,
      category: c.category,
      sponsors: c.sponsors.map((s: any) => s.sponsorName),
    })),
  });
}
