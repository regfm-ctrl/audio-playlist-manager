import { sql } from '@/lib/db';

// Adds the columns needed for business-category conflict checking.
// Safe to call on every request — IF NOT EXISTS makes it a no-op after
// the first run.
export async function ensureCampaignCategoryColumns() {
  await sql`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS business_category TEXT`;
  await sql`ALTER TABLE schedules ADD COLUMN IF NOT EXISTS campaign_id INTEGER`;
}
