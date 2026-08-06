import { sql } from '@/lib/db';

export async function ensurePlaylistNamesTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS playlist_names (
      playlist_id TEXT PRIMARY KEY,
      container_name TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

export async function getStoredContainerName(playlistId: string): Promise<string | null> {
  await ensurePlaylistNamesTable();
  const rows = await sql`SELECT container_name FROM playlist_names WHERE playlist_id = ${playlistId}`;
  return rows[0]?.container_name ?? null;
}

export async function storeContainerName(playlistId: string, containerName: string): Promise<void> {
  if (!containerName || !containerName.trim()) return;
  await ensurePlaylistNamesTable();
  await sql`
    INSERT INTO playlist_names (playlist_id, container_name)
    VALUES (${playlistId}, ${containerName})
    ON CONFLICT (playlist_id) DO UPDATE SET container_name = ${containerName}, updated_at = NOW()
  `;
}
