import { sql } from '@/lib/db';

export type CampaignAudioFile = {
  id: string;
  name: string;
  dir: string;
  localPath: string;
  expiresAt?: string | null; // ISO UTC timestamp — this specific file stops being used in rotation after this point, while the campaign's other files keep going
};

export async function ensureCampaignAudioRotationTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS campaign_audio_rotation (
      campaign_id INTEGER PRIMARY KEY,
      position INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

// Parses whatever shape the DB gives back for the audio_files column
// (JSONB comes back already parsed via the Neon driver, but handle a
// stringified fallback just in case) into a clean, de-duplicated array.
// Falls back to a single-item array built from the legacy singular
// columns, so campaigns created before this feature existed keep working
// unchanged. De-duplicating defensively here means even if a duplicate
// ever slipped into the stored list, rotation can't be skewed by it.
export function parseCampaignAudioFiles(campaign: any): CampaignAudioFile[] {
  let files: any = campaign.audio_files;
  if (typeof files === 'string') {
    try { files = JSON.parse(files); } catch { files = []; }
  }
  if (Array.isArray(files) && files.length > 0) {
    const seen = new Set<string>();
    const deduped: CampaignAudioFile[] = [];
    for (const f of files) {
      if (f?.id && !seen.has(f.id)) { seen.add(f.id); deduped.push(f); }
    }
    if (deduped.length > 0) return deduped;
  }

  if (campaign.audio_local_path) {
    return [{
      id: campaign.audio_file_id ?? '',
      name: campaign.audio_file_name ?? '',
      dir: campaign.audio_directory_name ?? '',
      localPath: campaign.audio_local_path,
    }];
  }
  return [];
}

// Picks the next file in rotation for this campaign, round-robin, and
// persists the position so a later edit that adds more breaks continues
// the rotation rather than restarting at file 1 every time. Expired files
// (per-file expiresAt already passed) are excluded from the pool entirely
// — the campaign just keeps rotating through whatever's still valid.
export function isFileExpired(file: CampaignAudioFile, now: Date = new Date()): boolean {
  return !!file.expiresAt && new Date(file.expiresAt) <= now;
}

export function getValidCampaignAudioFiles(files: CampaignAudioFile[], now: Date = new Date()): CampaignAudioFile[] {
  return files.filter(f => !isFileExpired(f, now));
}

export async function getNextCampaignAudioFile(campaignId: number, files: CampaignAudioFile[]): Promise<CampaignAudioFile> {
  const validFiles = getValidCampaignAudioFiles(files);
  if (validFiles.length === 0) throw new Error('No valid (non-expired) audio files remain for this campaign');
  if (validFiles.length === 1) return validFiles[0];

  await ensureCampaignAudioRotationTable();
  const rows = await sql`
    INSERT INTO campaign_audio_rotation (campaign_id, position)
    VALUES (${campaignId}, 0)
    ON CONFLICT (campaign_id) DO UPDATE SET position = campaign_audio_rotation.position + 1, updated_at = NOW()
    RETURNING position
  `;
  const position = rows[0].position as number;
  return validFiles[position % validFiles.length];
}

// Reserves `count` consecutive rotation slots in one go and returns the
// files in the exact order requested. Always call this — rather than
// getNextCampaignAudioFile in a loop or inside a Promise.all — whenever
// assigning files to more than one slot at once. Calling the single-file
// version from within parallel/concurrent work doesn't guarantee the
// assignment order matches the slot order (network timing decides who
// reaches the counter first), which can make rotation look uneven even
// though the underlying counter itself is correct. This does the DB
// round-trips sequentially (fast — it's just a counter increment, not a
// Drive call) so slot order and file order always line up.
export async function getNextCampaignAudioFiles(campaignId: number, files: CampaignAudioFile[], count: number): Promise<CampaignAudioFile[]> {
  const validFiles = getValidCampaignAudioFiles(files);
  if (validFiles.length === 0) throw new Error('No valid (non-expired) audio files remain for this campaign');
  if (validFiles.length === 1) return new Array(count).fill(validFiles[0]);

  await ensureCampaignAudioRotationTable();
  const result: CampaignAudioFile[] = [];
  for (let i = 0; i < count; i++) {
    const rows = await sql`
      INSERT INTO campaign_audio_rotation (campaign_id, position)
      VALUES (${campaignId}, 0)
      ON CONFLICT (campaign_id) DO UPDATE SET position = campaign_audio_rotation.position + 1, updated_at = NOW()
      RETURNING position
    `;
    const position = rows[0].position as number;
    result.push(validFiles[position % validFiles.length]);
  }
  return result;
}
