import { sql } from '@/lib/db';
import { melbourneWallTimeToUTC } from '@/lib/break-time';
import { logActivity } from '@/lib/activity';
import { ensureCampaignCategoryColumns } from '@/lib/campaign-schema';

// Runs each scheduler cycle — cheap no-op unless a campaign's end date has
// genuinely passed. This only changes the campaigns.status field; it
// doesn't touch schedules or Drive content at all (that's handled
// separately by the regular expiry check in schedules/run).
export async function expireCampaignsPastEndDate(): Promise<{ expired: string[] }> {
  await ensureCampaignCategoryColumns();
  const candidates = await sql`
    SELECT id, sponsor_name, end_date, expiry_time
    FROM campaigns
    WHERE status = 'active' AND end_date IS NOT NULL
  `;

  const now = new Date();
  const expired: string[] = [];

  for (const campaign of candidates as any[]) {
    const [y, m, d] = campaign.end_date.split('-').map(Number);
    const [eh, em] = (campaign.expiry_time || '22:00').split(':').map(Number);
    const endThreshold = melbourneWallTimeToUTC(y, m, d, eh, em || 0);
    if (endThreshold > now) continue;

    await sql`UPDATE campaigns SET status = 'expired' WHERE id = ${campaign.id}`;
    expired.push(campaign.sponsor_name);
  }

  if (expired.length > 0) {
    await logActivity(0, 'scheduler', 'CAMPAIGNS_AUTO_EXPIRED', '/api/schedules/run', expired.join(', '));
  }

  return { expired };
}

// Combines the plain end_date + expiry_time into the actual moment the
// campaign stops airing, formatted the same way the rest of the app shows
// Melbourne timestamps (DD/MM/YYYY, h:mm AM/PM) — not just the bare date.
// Shared by both the real renewal-reminder endpoint and its test endpoint.
export function formatMelbourneExpiry(endDate: string, expiryTime: string): string {
  const [y, m, d] = endDate.split('-').map(Number);
  const [eh, em] = (expiryTime || '22:00').split(':').map(Number);
  const utcInstant = melbourneWallTimeToUTC(y, m, d, eh, em || 0);
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Melbourne', day: '2-digit', month: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(utcInstant);
}
