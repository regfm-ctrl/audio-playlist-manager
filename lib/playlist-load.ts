import { sql } from '@/lib/db';

// How many active sponsors are currently sitting in each playlist. Used to
// prefer emptier breaks when picking new slots, so campaigns naturally
// spread out across the week's capacity instead of all independently
// converging on the same popular time windows.
export async function getPlaylistLoad(): Promise<Map<string, number>> {
  const rows = await sql`
    SELECT playlist_id, COUNT(*) as cnt
    FROM schedules
    WHERE is_active = true
    GROUP BY playlist_id
  `;
  const load = new Map<string, number>();
  for (const row of rows as any[]) {
    load.set(row.playlist_id, parseInt(row.cnt));
  }
  return load;
}
