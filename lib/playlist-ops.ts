import { isIntroPath, isOutroPath, isProtectedPath, getNextSting, buildPlaylistContent } from '@/lib/stings';
import { getStoredContainerName, storeContainerName } from '@/lib/playlist-names';

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
    if (line.startsWith('#EXTM3U') || line.startsWith('#EXTINF')) continue;
    // Case-insensitive: RadioBOSS's own expected format uses lowercase
    // "container=", but older files (written before that was corrected)
    // used capital "Container=" — both need to keep working.
    if (/^container=/i.test(line)) {
      const match = line.match(/container=<([^>]+)>(.*)/i);
      if (match) {
        containerName = decodeURIComponent(match[1].replace(/\+/g, ' '));
        existingPaths = match[2].split('|').filter((p) => p.trim()).map((p) => {
          // Paths are URL-encoded in the current format, but older files
          // still have raw Windows paths — a raw path never contains a
          // literal "%", so this reliably tells the two apart without
          // needing to know which format a given file is in.
          if (!p.includes('%')) return p;
          try {
            return decodeURIComponent(p.replace(/\+/g, ' '));
          } catch {
            return p;
          }
        });
      }
    }
  }

  if (containerName) {
    // Opportunistically remember this name so it survives even after the
    // file goes fully bare (see buildPlaylistContent — an empty break must
    // have no Container= line at all, or RadioBOSS treats it as populated).
    await storeContainerName(playlistId, containerName);
  } else {
    // File has no Container= line right now (genuinely bare) — recall
    // whatever name was last known for this break.
    const remembered = await getStoredContainerName(playlistId);
    if (remembered) containerName = remembered;
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
// path was found and removed, false if it genuinely wasn't there to begin
// with. Throws if the playlist couldn't be read or the save failed — that's
// a real failure, not "nothing to do", and callers must not treat it as
// success (a caller that swallows this and proceeds anyway can end up
// adding audio to a new break while never actually removing it from the
// old one, leaving an orphaned copy behind).
export async function removePathFromPlaylist(playlistId: string, pathToRemove: string, accessToken: string): Promise<boolean> {
  const state = await fetchPlaylistState(playlistId, accessToken);
  if (!state) throw new Error(`Could not read playlist ${playlistId} to remove ${pathToRemove}`);
  const { containerName, existingPaths } = state;
  if (!existingPaths.includes(pathToRemove)) return false;

  const introPath = existingPaths.find(isIntroPath) || null;
  const outroPath = existingPaths.find(isOutroPath) || null;
  const updatedReal = existingPaths.filter((p) => p !== pathToRemove && !isProtectedPath(p));
  const newContent = buildPlaylistContent(containerName, updatedReal, introPath, outroPath);
  const ok = await savePlaylistContent(playlistId, newContent, accessToken);
  if (!ok) throw new Error(`Failed to save playlist ${playlistId} after removing ${pathToRemove}`);
  return true;
}

// Adds a path to a playlist at the given position (relative to real
// content only). Wraps with a fresh intro/outro in rotation if the break
// was empty. Returns 'added' | 'already_present'. Throws on a genuine read
// or save failure — same reasoning as removePathFromPlaylist above; a
// caller must not treat a failed add as if the file is now safely in its
// new home.
export async function addPathToPlaylist(
  playlistId: string,
  pathToAdd: string,
  position: number,
  accessToken: string
): Promise<'added' | 'already_present'> {
  const state = await fetchPlaylistState(playlistId, accessToken);
  if (!state) throw new Error(`Could not read playlist ${playlistId} to add ${pathToAdd}`);
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
  if (!ok) throw new Error(`Failed to save playlist ${playlistId} after adding ${pathToAdd}`);
  return 'added';
}
