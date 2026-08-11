import { sql } from '@/lib/db';

let tableEnsured = false;
async function ensurePlaylistLocksTable() {
  if (tableEnsured) return;
  await sql`
    CREATE TABLE IF NOT EXISTS playlist_locks (
      playlist_id TEXT PRIMARY KEY,
      locked_at TIMESTAMPTZ
    )
  `;
  tableEnsured = true;
}

// Claims an exclusive lock on one specific playlist (break). Any
// operation that reads a playlist's current content and later writes an
// updated version back — add, remove, reorder — is a read-then-write
// sequence, not a single atomic step. If two such operations run
// concurrently against the *same* playlist (very possible: several
// campaigns get reshuffled at once, and different campaigns routinely
// share the same break), whichever one writes second silently overwrites
// whatever the first one just added, even though the first one's database
// row was already created. This lock makes that collision structurally
// impossible rather than just unlikely, by serializing access to any one
// playlist while still letting *different* playlists proceed fully in
// parallel.
async function acquirePlaylistLock(playlistId: string): Promise<boolean> {
  await ensurePlaylistLocksTable();
  const rows = await sql`
    INSERT INTO playlist_locks (playlist_id, locked_at)
    VALUES (${playlistId}, NOW())
    ON CONFLICT (playlist_id) DO UPDATE
      SET locked_at = NOW()
      WHERE playlist_locks.locked_at IS NULL OR playlist_locks.locked_at < NOW() - INTERVAL '30 seconds'
    RETURNING playlist_id
  `;
  return rows.length > 0;
}

async function releasePlaylistLock(playlistId: string): Promise<void> {
  await sql`UPDATE playlist_locks SET locked_at = NULL WHERE playlist_id = ${playlistId}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Runs fn() with exclusive access to this playlist, retrying briefly with
// jittered backoff if something else currently holds the lock (expected
// to resolve within a second or two, since a single playlist write is
// fast) rather than skipping the operation — skipping would just create a
// different kind of missing content.
export async function withPlaylistLock<T>(playlistId: string, fn: () => Promise<T>): Promise<T> {
  const MAX_ATTEMPTS = 25;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const gotLock = await acquirePlaylistLock(playlistId);
    if (gotLock) {
      try {
        return await fn();
      } finally {
        await releasePlaylistLock(playlistId);
      }
    }
    await sleep(150 + Math.random() * 250);
  }
  throw new Error(`Could not acquire lock on playlist ${playlistId} after ${MAX_ATTEMPTS} attempts — another operation held it too long`);
}
