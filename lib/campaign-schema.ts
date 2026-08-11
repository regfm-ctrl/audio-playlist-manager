import { sql } from '@/lib/db';

// Adds the columns needed for business-category conflict checking.
// Safe to call on every request — IF NOT EXISTS makes it a no-op after
// the first run.
export async function ensureCampaignCategoryColumns() {
  await sql`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS business_category TEXT`;
  await sql`ALTER TABLE schedules ADD COLUMN IF NOT EXISTS campaign_id INTEGER`;
  await sql`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS booking_reference TEXT`;
  await sql`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS booking_details TEXT`;
  await sql`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS randomize_weekly BOOLEAN DEFAULT false`;
  await sql`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS last_reshuffled_at TIMESTAMPTZ`;
  await sql`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS audio_files JSONB DEFAULT '[]'`;
  await sql`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS go_live_time TEXT DEFAULT '06:00'`;
  await sql`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS expiry_time TEXT DEFAULT '22:00'`;
  await sql`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS reshuffle_lock_acquired_at TIMESTAMPTZ`;
  await sql`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS position_type TEXT DEFAULT 'middle'`;
  await sql`ALTER TABLE schedules ADD COLUMN IF NOT EXISTS position_type TEXT DEFAULT 'middle'`;
}
