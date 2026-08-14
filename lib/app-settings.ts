import { sql } from '@/lib/db';
import { ensureCampaignCategoryColumns } from '@/lib/campaign-schema';

export async function getSetting(key: string): Promise<string | null> {
  await ensureCampaignCategoryColumns();
  const rows = await sql`SELECT value FROM app_settings WHERE key = ${key}`;
  return rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await ensureCampaignCategoryColumns();
  await sql`
    INSERT INTO app_settings (key, value) VALUES (${key}, ${value})
    ON CONFLICT (key) DO UPDATE SET value = ${value}
  `;
}

export async function getRenewalReminderSettings(): Promise<{ emails: string[]; days: number[] }> {
  const emailsRaw = await getSetting('renewal_reminder_emails');
  const daysRaw = await getSetting('renewal_reminder_days');
  let emails: string[] = [];
  let days: number[] = [];
  try { emails = emailsRaw ? JSON.parse(emailsRaw) : []; } catch {}
  try { days = daysRaw ? JSON.parse(daysRaw) : []; } catch {}
  return { emails, days };
}
