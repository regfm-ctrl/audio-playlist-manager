import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getRenewalReminderSettings } from '@/lib/app-settings';
import { logActivity } from '@/lib/activity';

const CRON_SECRET = process.env.CRON_SECRET;

// Melbourne "today" as a plain YYYY-MM-DD string — end_date is stored the
// same way, so comparing calendar dates directly avoids any timezone
// complexity from comparing full timestamps.
function melbourneTodayDateString(): string {
  const dtf = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit' });
  return dtf.format(new Date());
}

function daysBetween(fromDateStr: string, toDateStr: string): number {
  const from = new Date(fromDateStr + 'T00:00:00Z').getTime();
  const to = new Date(toDateStr + 'T00:00:00Z').getTime();
  return Math.round((to - from) / (1000 * 60 * 60 * 24));
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { emails, days: thresholds } = await getRenewalReminderSettings();
  if (emails.length === 0 || thresholds.length === 0) {
    return NextResponse.json({ due: [], emails: [] }); // not configured yet — nothing to do
  }

  const today = melbourneTodayDateString();
  const candidates = await sql`
    SELECT id, sponsor_name, end_date, reminders_sent
    FROM campaigns
    WHERE status = 'active' AND end_date IS NOT NULL
  `;

  const due: { sponsorName: string; endDate: string; daysUntil: number }[] = [];

  for (const campaign of candidates as any[]) {
    const daysUntil = daysBetween(today, campaign.end_date);
    if (daysUntil < 0) continue; // already past — the auto-expire check handles this separately

    let alreadySent: number[] = [];
    try { alreadySent = campaign.reminders_sent ? (typeof campaign.reminders_sent === 'string' ? JSON.parse(campaign.reminders_sent) : campaign.reminders_sent) : []; } catch {}

    const matchedThreshold = thresholds.find((t: number) => daysUntil === t && !alreadySent.includes(t));
    if (matchedThreshold === undefined) continue;

    due.push({ sponsorName: campaign.sponsor_name, endDate: campaign.end_date, daysUntil });
    await sql`UPDATE campaigns SET reminders_sent = ${JSON.stringify([...alreadySent, matchedThreshold])} WHERE id = ${campaign.id}`;
  }

  if (due.length > 0) {
    await logActivity(0, 'scheduler', 'RENEWAL_REMINDERS_DUE', '/api/cron/expiring-campaigns',
      due.map(d => `${d.sponsorName} (${d.daysUntil}d)`).join(', '));
  }

  return NextResponse.json({ due, emails });
}
