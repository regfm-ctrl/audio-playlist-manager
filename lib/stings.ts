import { sql } from '@/lib/db';
import { INTRO_FOLDER_ID, OUTRO_FOLDER_ID, INTRO_LOCAL_PATH_PREFIX, OUTRO_LOCAL_PATH_PREFIX } from '@/lib/folder-config';

// Intro/outro stings — never treated as removable sponsor content, and
// never edited directly by scheduler/save logic.
export const isIntroPath = (path: string) => path.includes('Sponsor Intro & Outros') && path.includes('\\Intros\\');
export const isOutroPath = (path: string) => path.includes('Sponsor Intro & Outros') && path.includes('\\Outros\\');
export const isProtectedPath = (path: string) => isIntroPath(path) || isOutroPath(path);

async function ensureRotationTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS sting_rotation (
      kind TEXT PRIMARY KEY,
      position INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

async function listDriveFiles(folderId: string, accessToken: string): Promise<{ id: string; name: string }[]> {
  try {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+trashed=false+and+mimeType!='application/vnd.google-apps.folder'&fields=files(id,name)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true&orderBy=name`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    const files: { id: string; name: string }[] = data.files || [];
    // Only real audio files — RadioBOSS drops .rbdata (its own waveform/
    // metadata cache) alongside audio in the same folder, and it should
    // never be picked as a sting.
    return files.filter(f => /\.(mp3|wav)$/i.test(f.name));
  } catch {
    return [];
  }
}

const STING_FOLDERS: Record<'intro' | 'outro', { folderId: string; localPrefix: string }> = {
  intro: { folderId: INTRO_FOLDER_ID, localPrefix: INTRO_LOCAL_PATH_PREFIX },
  outro: { folderId: OUTRO_FOLDER_ID, localPrefix: OUTRO_LOCAL_PATH_PREFIX },
};

// Returns the next sting's local path in rotation, or null if the folder
// isn't configured or is empty (in which case the break just plays without
// that sting, rather than failing). formatFilter narrows the pool to a
// single extension — used when specifically migrating away from an old
// format (e.g. reassigning every MP3-sting break to a WAV one), without
// needing a separate rotation table for that one-time purpose.
export async function getNextSting(kind: 'intro' | 'outro', accessToken: string, formatFilter?: 'mp3' | 'wav'): Promise<string | null> {
  const cfg = STING_FOLDERS[kind];
  if (!cfg.folderId) return null;

  let files = await listDriveFiles(cfg.folderId, accessToken);
  if (formatFilter) files = files.filter(f => f.name.toLowerCase().endsWith(`.${formatFilter}`));
  if (files.length === 0) return null;

  await ensureRotationTable();
  const rows = await sql`
    INSERT INTO sting_rotation (kind, position)
    VALUES (${kind}, 0)
    ON CONFLICT (kind) DO UPDATE SET position = sting_rotation.position + 1, updated_at = NOW()
    RETURNING position
  `;
  const position = rows[0].position as number;
  const file = files[position % files.length];
  return cfg.localPrefix + file.name;
}

// Rebuilds a playlist's Container= line from its real (non-sting) content
// plus whichever intro/outro paths apply. If there's no real content, the
// file is written fully empty — RadioBOSS does nothing with it, by design.
export function buildPlaylistContent(containerName: string, realPaths: string[], introPath: string | null, outroPath: string | null): string {
  // A break with zero real content must have NO Container= line at all —
  // RadioBOSS treats a Container= line (even with zero tracks after it)
  // as "there's a file here" and loads it, which defeats the point of an
  // empty break being skipped entirely. The name itself is remembered
  // separately (lib/playlist-names.ts) and reapplied the next time this
  // break gets real content again.
  if (realPaths.length === 0) return `#EXTM3U\n`;
  const allPaths = [
    ...(introPath ? [introPath] : []),
    ...realPaths,
    ...(outroPath ? [outroPath] : []),
  ];
  // RadioBOSS expects the full application/x-www-form-urlencoded style
  // here — not just the name, every path too (spaces as +, backslashes
  // as %5C, colons as %3A, etc.). A raw, unencoded Windows path in this
  // position is what was causing RadioBOSS to crash on these breaks.
  const encodeForM3U = (str: string) => encodeURIComponent(str).replace(/%20/g, '+');
  const encodedName = encodeForM3U(containerName || 'Not predefined');
  const encodedPaths = allPaths.map(encodeForM3U);
  // RadioBOSS also expects an #EXTINF line naming the first real track
  // (not the intro), and a lowercase "container=" — both were missing/
  // wrong in what this used to generate.
  const firstRealFileName = (realPaths[0].split('\\').pop() || '').replace(/\.(mp3|wav)$/i, '');
  return `#EXTM3U\n#EXTINF:30,${firstRealFileName}\ncontainer=<${encodedName}>${encodedPaths.join('|')}\n`;
}
