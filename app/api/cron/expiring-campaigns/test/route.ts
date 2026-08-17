import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getRenewalReminderSettings } from '@/lib/app-settings';
import { formatMelbourneExpiry } from '@/lib/campaign-expiry-status';

const CRON_SECRET = process.env.CRON_SECRET;

// Read-only — never touches reminders_sent, so it's safe to call as many
// times as needed while testing. Uses up to 2 real, currently-active
// campaign names (with fabricated future dates) so the preview looks
// genuinely representative rather than generic placeholder text; falls
// back to made-up names if there are no active campaigns to borrow from.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { emails } = await getRenewalReminderSettings();

  const rows = await sql`
    SELECT sponsor_name, expiry_time FROM campaigns
    WHERE status = 'active' AND (exclude_from_renewal_reminders IS NOT TRUE)
    ORDER BY id DESC LIMIT 2
  `;
  const sampleCampaigns = (rows as any[]).length > 0 ? rows : [{ sponsor_name: 'Sample Sponsor A', expiry_time: '22:00' }, { sponsor_name: 'Sample Sponsor B', expiry_time: '22:00' }];

  const now = new Date();
  const due = sampleCampaigns.slice(0, 2).map((c, i) => {
    const daysUntil = i === 0 ? 7 : 3;
    const fakeEndDate = new Date(now.getTime() + daysUntil * 24 * 60 * 60 * 1000);
    const endDateStr = fakeEndDate.toISOString().split('T')[0];
    return {
      sponsorName: c.sponsor_name,
      endDate: endDateStr,
      expiresAt: formatMelbourneExpiry(endDateStr, c.expiry_time || '22:00'),
      daysUntil,
    };
  });

  return NextResponse.json({ due, emails, isTest: true });
}
