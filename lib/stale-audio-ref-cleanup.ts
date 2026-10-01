import { sql } from '@/lib/db';

// Mirrors AUDIO_DIRECTORIES in app/campaigns/page.tsx / DEFAULT_AUDIO_DIRECTORIES
// in lib/folder-config.ts — the set of folders a campaign's audio files can
// come from, needed here to know which live Drive folder to check each
// stored reference against.
const AUDIO_DIRECTORIES = [
  { name: 'IDs - Test Update', driveId: '1cy56CgC1KtxCgZI-kGOEWTTNuC5rjzh_' },
  { name: 'CSAs - Audio', driveId: '14Oy00clKujI6ldWv7NW35DybZVBN_MPm' },
  { name: 'Promos - Audio', driveId: '1PzkL-eDZVPU-g3D7c5IUY93g14-SV3l6' },
  { name: 'Sponsors - Audio', driveId: '1B_LOIo2jl_-P-1UrWoRZ4W688_lk0NQC' },
];

export type StaleAudioRefItem = {
  campaignId: number;
  sponsorName: string;
  fileName: string;
  dir: string;
  storedId: string;
  currentId: string | null; // null = no file with this name currently exists in that folder at all
};

// Live listing of every file currently in a Drive folder, by name — this is
// the same kind of query the Sponsorship Breaks file browser already does,
// which is exactly why that screen never has this problem: it always asks
// Drive fresh, rather than trusting an old saved answer.
async function listFolderFilesByName(driveId: string, accessToken: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let pageToken: string | undefined;
  do {
    const url = `https://www.googleapis.com/drive/v3/files?q='${driveId}'+in+parents+and+trashed=false&fields=nextPageToken,files(id,name)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) break;
    const data = await res.json();
    for (const f of data.files || []) map.set(f.name, f.id);
    pageToken = data.nextPageToken;
  } while (pageToken);
  return map;
}

export async function computeStaleAudioRefPreview(accessToken: string): Promise<{ items: StaleAudioRefItem[]; scanned: number }> {
  // One live listing per folder, reused across every campaign — far cheaper
  // than re-querying Drive once per audio file.
  const folderListings = new Map<string, Map<string, string>>();
  for (const dir of AUDIO_DIRECTORIES) {
    folderListings.set(dir.name, await listFolderFilesByName(dir.driveId, accessToken));
  }

  const campaigns = await sql`SELECT id, sponsor_name, audio_files FROM campaigns WHERE audio_files IS NOT NULL`;

  const items: StaleAudioRefItem[] = [];
  let scanned = 0;

  for (const campaign of campaigns as any[]) {
    let audioFiles: any[] = [];
    try {
      audioFiles = typeof campaign.audio_files === 'string' ? JSON.parse(campaign.audio_files) : (campaign.audio_files || []);
    } catch {
      continue;
    }

    for (const file of audioFiles) {
      if (!file?.id || !file?.name || !file?.dir) continue;
      scanned++;
      const listing = folderListings.get(file.dir);
      if (!listing) continue; // unrecognised folder name — can't verify, skip rather than guess

      const currentId = listing.get(file.name) ?? null;
      if (currentId !== file.id) {
        items.push({
          campaignId: campaign.id,
          sponsorName: campaign.sponsor_name,
          fileName: file.name,
          dir: file.dir,
          storedId: file.id,
          currentId,
        });
      }
    }
  }

  return { items, scanned };
}

export async function applyStaleAudioRefFix(items: StaleAudioRefItem[]): Promise<{ succeeded: number; failed: string[]; total: number }> {
  let succeeded = 0;
  const failed: string[] = [];

  // Group by campaign, since one campaign can have multiple stale files and
  // each campaign's audio_files array should be updated in a single write.
  const byCampaign = new Map<number, StaleAudioRefItem[]>();
  for (const item of items) {
    if (!item.currentId) continue; // nothing to fix to if the file's genuinely gone/renamed
    const list = byCampaign.get(item.campaignId) || [];
    list.push(item);
    byCampaign.set(item.campaignId, list);
  }

  for (const [campaignId, fixes] of byCampaign) {
    try {
      const rows = await sql`SELECT audio_files FROM campaigns WHERE id = ${campaignId}`;
      if (rows.length === 0) throw new Error('Campaign not found');
      let audioFiles: any[] = typeof rows[0].audio_files === 'string' ? JSON.parse(rows[0].audio_files) : (rows[0].audio_files || []);

      for (const fix of fixes) {
        audioFiles = audioFiles.map((f: any) =>
          f.name === fix.fileName && f.dir === fix.dir && f.id === fix.storedId
            ? { ...f, id: fix.currentId }
            : f
        );
      }

      await sql`UPDATE campaigns SET audio_files = ${JSON.stringify(audioFiles)} WHERE id = ${campaignId}`;
      succeeded += fixes.length;
    } catch (err: any) {
      console.error('[stale-audio-ref] Failed to update campaign', campaignId, err);
      fixes.forEach((f) => failed.push(`${f.sponsorName} — ${f.fileName}`));
    }
  }

  const skippedNoCurrentId = items.filter((i) => !i.currentId).length;

  return { succeeded, failed, total: items.length - skippedNoCurrentId };
}
