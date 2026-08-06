import { isIntroPath, isOutroPath, isProtectedPath, getNextSting, buildPlaylistContent } from '@/lib/stings';

export async function fetchPlaylistState(playlistId: string, accessToken: string): Promise<{ containerName: string; existingPaths: string[] } | null> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${playlistId}?alt=media`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) return null;
  const content = await res.text();
  const lines = content.split('\n').filter((l) => l.trim());
  let containerName = '';
  let existingPaths: string[] = [];
  for (const line of lines) {
    if (line.startsWith('#EXTM3U')) continue;
    if (line.startsWith('Container=')) {
      const match = line.match(/Container=<([^>]+)>(.+)/);
      if (match) {
        containerName = decodeURIComponent(match[1].replace(/\+/g, ' '));
        existingPaths = match[2].split('|').filter((p) => p.trim());
      }
    }
  }
  return { containerName, existingPaths };
}

export async function savePlaylistContent(playlistId: string, content: string, accessToken: string): Promise<boolean> {
  const res = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files/${playlistId}?uploadType=media&supportsAllDrives=true`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'text/plain' },
      body: content,
    }
  );
  return res.ok;
}

// Removes a specific path from a playlist. If that was the last real
// (non-sting) item, the intro/outro get dropped too. Returns true if the
// path was actually found and removed.
export async function removePathFromPlaylist(playlistId: string, pathToRemove: string, accessToken: string): Promise<boolean> {
  const state = await fetchPlaylistState(playlistId, accessToken);
  if (!state) return false;
  const { containerName, existingPaths } = state;
  if (!existingPaths.includes(pathToRemove)) return false;

  const introPath = existingPaths.find(isIntroPath) || null;
  const outroPath = existingPaths.find(isOutroPath) || null;
  const updatedReal = existingPaths.filter((p) => p !== pathToRemove && !isProtectedPath(p));
  const newContent = buildPlaylistContent(containerName, updatedReal, introPath, outroPath);
  return savePlaylistContent(playlistId, newContent, accessToken);
}

// Adds a path to a playlist at the given position (relative to real
// content only). Wraps with a fresh intro/outro in rotation if the break
// was empty. Returns 'added' | 'already_present' | 'failed'.
export async function addPathToPlaylist(
  playlistId: string,
  pathToAdd: string,
  position: number,
  accessToken: string
): Promise<'added' | 'already_present' | 'failed'> {
  const state = await fetchPlaylistState(playlistId, accessToken);
  if (!state) return 'failed';
  const { containerName, existingPaths } = state;
  if (existingPaths.includes(pathToAdd)) return 'already_present';

  const realPaths = existingPaths.filter((p) => !isProtectedPath(p));
  const wasEmpty = realPaths.length === 0;
  let introPath = existingPaths.find(isIntroPath) || null;
  let outroPath = existingPaths.find(isOutroPath) || null;
  if (wasEmpty) {
    introPath = await getNextSting('intro', accessToken);
    outroPath = await getNextSting('outro', accessToken);
  }
  if (position >= 0 && position < realPaths.length) {
    realPaths.splice(position, 0, pathToAdd);
  } else {
    realPaths.push(pathToAdd);
  }
  const newContent = buildPlaylistContent(containerName, realPaths, introPath, outroPath);
  const ok = await savePlaylistContent(playlistId, newContent, accessToken);
  return ok ? 'added' : 'failed';
}
