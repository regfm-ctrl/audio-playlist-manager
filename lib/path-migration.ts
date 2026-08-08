import { sql } from '@/lib/db';
import { PLAYLIST_FOLDER_ID } from '@/lib/folder-config';

// The old, wrong path prefixes found on RadioBOSS's mapped drive, and what
// they need to become. Specific per-subfolder rather than a blanket root
// replace, since each audio type folder actually lives inside a shared
// "Traffic System" parent that wasn't reflected in the old paths at all —
// a plain dash-fix alone wasn't enough.
export const PATH_REPLACEMENTS = [
  { old: 'T:\\REGFM RadioBOSS\\Sponsors\\', new: 'T:\\REGFM - RadioBOSS\\Traffic System\\Sponsors\\' },
  { old: 'T:\\REGFM RadioBOSS\\IDs\\', new: 'T:\\REGFM - RadioBOSS\\Traffic System\\IDs\\' },
  { old: 'T:\\REGFM RadioBOSS\\CSAs Audio\\', new: 'T:\\REGFM - RadioBOSS\\Traffic System\\CSAs Audio\\' },
  { old: 'T:\\REGFM RadioBOSS\\Promos\\', new: 'T:\\REGFM - RadioBOSS\\Traffic System\\Promos\\' },
  { old: 'T:\\My Drive\\Traffic System\\Sponsor Intro & Outros\\Intros\\', new: 'T:\\REGFM - RadioBOSS\\Traffic System\\Sponsor Intro & Outros\\Intros\\' },
  { old: 'T:\\My Drive\\Traffic System\\Sponsor Intro & Outros\\Outros\\', new: 'T:\\REGFM - RadioBOSS\\Traffic System\\Sponsor Intro & Outros\\Outros\\' },
];

export function applyPathReplacements(path: string): string {
  let result = path;
  for (const r of PATH_REPLACEMENTS) {
    if (result.includes(r.old)) result = result.split(r.old).join(r.new);
  }
  return result;
}

export type PathMigrationPreview = {
  campaignsAffected: { id: number; sponsorName: string; oldPath: string; newPath: string; fileCount: number }[];
  schedulesAffectedCount: number;
  driveFilesAffected: { playlistId: string; playlistName: string; oldPaths: string[]; newPaths: string[] }[];
  driveScanned: number;
  errors: string[];
};

export async function computePathMigrationPreview(accessToken: string): Promise<PathMigrationPreview> {
  const errors: string[] = [];

  // 1. Campaigns — check both the legacy single path and the audio_files list
  const campaigns = await sql`SELECT id, sponsor_name, audio_local_path, audio_files FROM campaigns`;
  const campaignsAffected: PathMigrationPreview['campaignsAffected'] = [];
  for (const c of campaigns as any[]) {
    let files: any[] = [];
    try {
      files = typeof c.audio_files === 'string' ? JSON.parse(c.audio_files) : (c.audio_files || []);
    } catch { files = []; }

    const anyFileAffected = files.some((f: any) => f.localPath && applyPathReplacements(f.localPath) !== f.localPath);
    const legacyAffected = c.audio_local_path && applyPathReplacements(c.audio_local_path) !== c.audio_local_path;

    if (anyFileAffected || legacyAffected) {
      campaignsAffected.push({
        id: c.id,
        sponsorName: c.sponsor_name,
        oldPath: c.audio_local_path,
        newPath: applyPathReplacements(c.audio_local_path),
        fileCount: files.length || 1,
      });
    }
  }

  // 2. Schedules — filtered in JS to avoid any ambiguity with backslashes
  // in SQL LIKE patterns
  const allSchedules = await sql`SELECT audio_local_path FROM schedules WHERE is_active = true`;
  const schedulesAffectedCount = (allSchedules as any[])
    .filter(s => s.audio_local_path && applyPathReplacements(s.audio_local_path) !== s.audio_local_path)
    .length;

  // 3. Actual Drive file content — the real source of truth for what
  // RadioBOSS reads
  const listRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q='${PLAYLIST_FOLDER_ID}'+in+parents+and+trashed=false&fields=files(id,name)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!listRes.ok) throw new Error('Failed to list playlists');
  const listData = await listRes.json();
  const playlists = (listData.files || []).filter((f: any) => f.name.endsWith('.m3u8'));

  const driveFilesAffected: PathMigrationPreview['driveFilesAffected'] = [];
  const BATCH_SIZE = 15;
  for (let i = 0; i < playlists.length; i += BATCH_SIZE) {
    const batch = playlists.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(async (pl: any) => {
      try {
        const res = await fetch(`https://www.googleapis.com/drive/v3/files/${pl.id}?alt=media`, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (!res.ok) { errors.push(`${pl.name}: failed to read`); return null; }
        const content = await res.text();
        const hasOld = PATH_REPLACEMENTS.some(r => content.includes(r.old));
        if (!hasOld) return null;

        const match = content.match(/Container=<([^>]+)>(.*)/);
        const paths = match ? match[2].split('|').filter((p: string) => p.trim()) : [];
        const oldPaths = paths.filter((p: string) => PATH_REPLACEMENTS.some(r => p.includes(r.old)));
        const newPaths = oldPaths.map(applyPathReplacements);
        return { playlistId: pl.id, playlistName: pl.name, oldPaths, newPaths };
      } catch (err: any) {
        errors.push(`${pl.name}: ${err.message ?? String(err)}`);
        return null;
      }
    }));
    for (const r of results) if (r) driveFilesAffected.push(r);
  }

  return { campaignsAffected, schedulesAffectedCount, driveFilesAffected, driveScanned: playlists.length, errors };
}
