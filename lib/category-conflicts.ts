import { sql } from '@/lib/db';

export type CategoryConflict = {
  playlistId: string;
  playlistName: string;
  category: string;
  sponsors: { scheduleId: number; campaignId: number; sponsorName: string; createdAt: string }[];
};

// Finds every break currently holding more than one active sponsor from
// the same business category — which should never happen, since campaign
// creation, edits, and the rebalance tool all check for this.
export async function findCategoryConflicts(): Promise<CategoryConflict[]> {
  const rows = await sql`
    SELECT s.id, s.playlist_id, s.playlist_name, s.created_at, s.campaign_id,
           c.sponsor_name, c.business_category
    FROM schedules s
    JOIN campaigns c ON c.id = s.campaign_id
    WHERE s.is_active = true AND c.business_category IS NOT NULL AND c.business_category != ''
  `;

  // Group by playlist, then by category within that playlist
  const byPlaylist = new Map<string, any[]>();
  for (const r of rows as any[]) {
    if (!byPlaylist.has(r.playlist_id)) byPlaylist.set(r.playlist_id, []);
    byPlaylist.get(r.playlist_id)!.push(r);
  }

  const conflicts: CategoryConflict[] = [];
  for (const [playlistId, scheds] of byPlaylist) {
    const byCategory = new Map<string, any[]>();
    for (const s of scheds) {
      const cat = s.business_category.toLowerCase();
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat)!.push(s);
    }
    for (const [cat, group] of byCategory) {
      // Only a real conflict if it's more than one *distinct campaign* —
      // a campaign with multiple spots in the same break isn't a conflict
      // with itself
      const distinctCampaigns = new Set(group.map((g: any) => g.campaign_id));
      if (distinctCampaigns.size < 2) continue;
      conflicts.push({
        playlistId,
        playlistName: group[0].playlist_name,
        category: group[0].business_category,
        sponsors: group.map((g: any) => ({
          scheduleId: g.id, campaignId: g.campaign_id, sponsorName: g.sponsor_name, createdAt: g.created_at,
        })),
      });
    }
  }
  return conflicts;
}
