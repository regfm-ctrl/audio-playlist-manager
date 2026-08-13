import { sql } from '@/lib/db';
import { PLAYLIST_FOLDER_ID } from '@/lib/folder-config';
import { fetchPlaylistState, savePlaylistContent } from '@/lib/playlist-ops';
import { isIntroPath, isOutroPath, isProtectedPath, buildPlaylistContent } from '@/lib/stings';

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
  // Rules apply sequentially, so this also correctly catches paths that
  // already went through the rule above and ended up with "CSAs Audio" —
  // the folder itself was renamed to just "CSAs", a separate fix from
  // the earlier prefix correction.
  { old: 'T:\\REGFM - RadioBOSS\\Traffic System\\CSAs Audio\\', new: 'T:\\REGFM - RadioBOSS\\Traffic System\\CSAs\\' },
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
        // Routed through fetchPlaylistState rather than a raw fetch+regex
        // here too — that's what correctly handles both lowercase and
        // legacy-capital "container=", and decodes URL-encoded paths back
        // to plain Windows paths before this ever tries to match them
        // against PATH_REPLACEMENTS (which is written in terms of plain
        // paths, not encoded ones).
        const state = await fetchPlaylistState(pl.id, accessToken);
        if (!state) { errors.push(`${pl.name}: failed to read`); return null; }
        const oldPaths = state.existingPaths.filter((p) => PATH_REPLACEMENTS.some(r => p.includes(r.old)));
        if (oldPaths.length === 0) return null;
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

// In-place path correction for one playlist file — a straight find-and-
// replace on whatever's currently there, preserving exact order and
// position. Deliberately not a remove-then-add: that would risk the
// break briefly looking empty (if it only had one item) and picking a
// fresh intro/outro from rotation, when nothing about the actual content
// has changed — just the path string pointing at it.
async function fixPlaylistPaths(playlistId: string, accessToken: string): Promise<{ changed: boolean; error?: string }> {
  try {
    const state = await fetchPlaylistState(playlistId, accessToken);
    if (!state) return { changed: false, error: 'Could not read playlist' };
    const { containerName, existingPaths } = state;

    const newPaths = existingPaths.map(applyPathReplacements);
    const changed = newPaths.some((p, i) => p !== existingPaths[i]);
    if (!changed) return { changed: false };

    // Route through the shared builder rather than constructing the file
    // content by hand — that's what keeps this correctly using the
    // lowercase "container=", the #EXTINF line, and properly
    // URL-encoded paths that RadioBOSS actually expects, automatically
    // staying in sync with that format if it's ever refined further.
    const introPath = newPaths.find(isIntroPath) || null;
    const outroPath = newPaths.find(isOutroPath) || null;
    const realPaths = newPaths.filter((p) => !isProtectedPath(p));
    const newContent = buildPlaylistContent(containerName, realPaths, introPath, outroPath);
    const ok = await savePlaylistContent(playlistId, newContent, accessToken);
    if (!ok) return { changed: false, error: 'Failed to save' };
    return { changed: true };
  } catch (err: any) {
    return { changed: false, error: err.message ?? String(err) };
  }
}

export type PathMigrationResult = {
  campaignsUpdated: number;
  schedulesUpdated: number;
  driveFilesUpdated: number;
  driveFilesFailed: string[];
};

export async function applyPathMigration(accessToken: string): Promise<PathMigrationResult> {
  const BATCH_SIZE = 15;

  // 1. Campaigns — batched, DB-only
  const campaigns = await sql`SELECT id, audio_local_path, audio_files FROM campaigns`;
  let campaignsUpdated = 0;
  for (let i = 0; i < campaigns.length; i += BATCH_SIZE) {
    const batch = (campaigns as any[]).slice(i, i + BATCH_SIZE);
    const outcomes = await Promise.all(batch.map(async (c: any) => {
      let files: any[] = [];
      try { files = typeof c.audio_files === 'string' ? JSON.parse(c.audio_files) : (c.audio_files || []); } catch { files = []; }

      let changed = false;
      const newFiles = files.map((f: any) => {
        if (f.localPath) {
          const newPath = applyPathReplacements(f.localPath);
          if (newPath !== f.localPath) { changed = true; return { ...f, localPath: newPath }; }
        }
        return f;
      });
      const newLegacyPath = c.audio_local_path ? applyPathReplacements(c.audio_local_path) : c.audio_local_path;
      if (newLegacyPath !== c.audio_local_path) changed = true;

      if (!changed) return false;
      await sql`UPDATE campaigns SET audio_local_path = ${newLegacyPath}, audio_files = ${JSON.stringify(newFiles)} WHERE id = ${c.id}`;
      return true;
    }));
    campaignsUpdated += outcomes.filter(Boolean).length;
  }

  // 2. Schedules — batched, DB-only
  const schedules = await sql`SELECT id, audio_local_path FROM schedules WHERE is_active = true`;
  let schedulesUpdated = 0;
  for (let i = 0; i < schedules.length; i += BATCH_SIZE) {
    const batch = (schedules as any[]).slice(i, i + BATCH_SIZE);
    const outcomes = await Promise.all(batch.map(async (s: any) => {
      const newPath = applyPathReplacements(s.audio_local_path);
      if (newPath === s.audio_local_path) return false;
      await sql`UPDATE schedules SET audio_local_path = ${newPath} WHERE id = ${s.id}`;
      return true;
    }));
    schedulesUpdated += outcomes.filter(Boolean).length;
  }

  // 3. Actual Drive file content — the part that actually matters for
  // RadioBOSS, since it reads these files directly
  const listRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q='${PLAYLIST_FOLDER_ID}'+in+parents+and+trashed=false&fields=files(id,name)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!listRes.ok) throw new Error('Failed to list playlists');
  const listData = await listRes.json();
  const playlists = (listData.files || []).filter((f: any) => f.name.endsWith('.m3u8'));

  let driveFilesUpdated = 0;
  const driveFilesFailed: string[] = [];
  for (let i = 0; i < playlists.length; i += BATCH_SIZE) {
    const batch = playlists.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(async (pl: any) => {
      const result = await fixPlaylistPaths(pl.id, accessToken);
      return { name: pl.name, ...result };
    }));
    for (const r of results) {
      if (r.error) driveFilesFailed.push(`${r.name}: ${r.error}`);
      else if (r.changed) driveFilesUpdated++;
    }
  }

  return { campaignsUpdated, schedulesUpdated, driveFilesUpdated, driveFilesFailed };
}
