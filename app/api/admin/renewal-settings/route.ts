import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { getRenewalReminderSettings, setSetting } from '@/lib/app-settings';

export async function GET(req: NextRequest) {
  const token = req.cookies.get('token')?.value;
  const user = token ? await verifyToken(token) : null;
  if (user?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const settings = await getRenewalReminderSettings();
  return NextResponse.json(settings);
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get('token')?.value;
  const user = token ? await verifyToken(token) : null;
  if (user?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { emails, days } = await req.json();

  const cleanEmails = (Array.isArray(emails) ? emails : [])
    .map((e: string) => (e || '').trim())
    .filter((e: string) => e.length > 0)
    .slice(0, 4);

  const cleanDays = (Array.isArray(days) ? days : [])
    .map((d: any) => parseInt(d))
    .filter((d: number) => !isNaN(d) && d > 0)
    .sort((a: number, b: number) => b - a);

  await setSetting('renewal_reminder_emails', JSON.stringify(cleanEmails));
  await setSetting('renewal_reminder_days', JSON.stringify(cleanDays));

  return NextResponse.json({ emails: cleanEmails, days: cleanDays });
}
