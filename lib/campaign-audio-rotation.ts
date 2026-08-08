import { sql } from '@/lib/db';

export type CampaignAudioFile = {
  id: string;
  name: string;
  dir: string;
  localPath: string;
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
// stringified fallback just in case) into a clean array. Falls back to a
// single-item array built from the legacy singular columns, so campaigns
// created before this feature existed keep working unchanged.
export function parseCampaignAudioFiles(campaign: any): CampaignAudioFile[] {
  let files: any = campaign.audio_files;
  if (typeof files === 'string') {
    try { files = JSON.parse(files); } catch { files = []; }
  }
  if (Array.isArray(files) && files.length > 0) return files;

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
// the rotation rather than restarting at file 1 every time.
export async function getNextCampaignAudioFile(campaignId: number, files: CampaignAudioFile[]): Promise<CampaignAudioFile> {
  if (files.length === 1) return files[0];

  await ensureCampaignAudioRotationTable();
  const rows = await sql`
    INSERT INTO campaign_audio_rotation (campaign_id, position)
    VALUES (${campaignId}, 0)
    ON CONFLICT (campaign_id) DO UPDATE SET position = campaign_audio_rotation.position + 1, updated_at = NOW()
    RETURNING position
  `;
  const position = rows[0].position as number;
  return files[position % files.length];
}
