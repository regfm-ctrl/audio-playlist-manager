import { sql } from '@/lib/db';

// Hard ceiling — a break is never picked as a destination once it already
// holds this many sponsors, regardless of how constrained the rest of a
// campaign's candidate pool is. The existing load-ascending sort on top of
// this still naturally prefers 0-1 sponsor breaks whenever they're
// available, so in practice most picks land well under this ceiling —
// this is just the absolute line that's never crossed.
export const MAX_SPONSORS_PER_BREAK = 3;

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

