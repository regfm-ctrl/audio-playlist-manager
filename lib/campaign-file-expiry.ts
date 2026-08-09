import { sql } from '@/lib/db';
import { removePathFromPlaylist, addPathToPlaylist } from '@/lib/playlist-ops';
import { parseCampaignAudioFiles, getNextCampaignAudioFiles, isFileExpired } from '@/lib/campaign-audio-rotation';

// Cheap no-op unless a campaign actually has a per-file expiry set and it's
// actually passed. Runs every scheduler cycle alongside the weekly
// reshuffle check.
export async function expireIndividualAudioFiles(accessToken: string): Promise<{ processed: number; details: string[] }> {
  // Narrow to campaigns that could possibly have something due, before
  // doing any real work — most campaigns never use this feature at all.
  const campaigns = await sql`
    SELECT id, sponsor_name, position, audio_files
    FROM campaigns
    WHERE status = 'active' AND audio_files::text LIKE '%expiresAt%'
  `;

  const details: string[] = [];
  let processed = 0;
  const now = new Date();
  const BATCH_SIZE = 15;

  for (const campaign of campaigns as any[]) {
    const allFiles = parseCampaignAudioFiles(campaign);
    const expiredFiles = allFiles.filter(f => isFileExpired(f, now));
    if (expiredFiles.length === 0) continue;
    const expiredPaths = new Set(expiredFiles.map(f => f.localPath));

    const schedules = await sql`
      SELECT * FROM schedules WHERE campaign_id = ${campaign.id} AND is_active = true
    `;
    const affected = (schedules as any[]).filter(s => expiredPaths.has(s.audio_local_path));
    if (affected.length === 0) continue;

    // Pre-assign replacements sequentially, in order — same reasoning as
    // everywhere else that assigns rotation files to more than one slot at
    // once (calling the rotation counter from inside concurrent work
    // doesn't guarantee assignment order matches slot order).
    let replacements: any[] = [];
    try {
      replacements = await getNextCampaignAudioFiles(campaign.id, allFiles, affected.length);
    } catch {
      replacements = []; // no valid (non-expired) files remain at all
    }

    for (let i = 0; i < affected.length; i += BATCH_SIZE) {
      const batch = affected.slice(i, i + BATCH_SIZE);
      const batchReplacements = replacements.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async (sched: any, j: number) => {
        const replacement = batchReplacements[j];
        try {
          await removePathFromPlaylist(sched.playlist_id, sched.audio_local_path, accessToken);
          if (replacement) {
            await addPathToPlaylist(sched.playlist_id, replacement.localPath, campaign.position ?? -1, accessToken);
            await sql`
              UPDATE schedules SET
                audio_file_id = ${replacement.id ?? ''}, audio_file_name = ${replacement.name ?? ''},
                audio_directory_name = ${replacement.dir ?? ''}, audio_local_path = ${replacement.localPath}
              WHERE id = ${sched.id}
            `;
            details.push(`${campaign.sponsor_name}: ${sched.playlist_name} — expired file swapped to ${replacement.name}`);
          } else {
            // No valid files left in the whole campaign — nothing to put
            // here instead, so the placement is cleared rather than left
            // pointing at a file that no longer exists in the rotation.
            await sql`UPDATE schedules SET is_active = false WHERE id = ${sched.id}`;
            details.push(`${campaign.sponsor_name}: ${sched.playlist_name} — cleared, no valid files remain in rotation`);
          }
          processed++;
        } catch (err: any) {
          details.push(`${campaign.sponsor_name}: ${sched.playlist_name} — failed: ${err.message ?? String(err)}`);
        }
      }));
    }
  }

  return { processed, details };
}
