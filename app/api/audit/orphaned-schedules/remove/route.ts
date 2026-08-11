import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { verifyToken } from '@/lib/auth';
import { getValidAccessToken } from '@/lib/google-tokens';
import { removePathFromPlaylistLocked } from '@/lib/playlist-ordering';

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  const token = req.cookies.get('token')?.value;
  const user = token ? await verifyToken(token) : null;
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { scheduleIds } = await req.json();
  if (!Array.isArray(scheduleIds) || scheduleIds.length === 0) {
    return NextResponse.json({ error: 'No schedule IDs provided' }, { status: 400 });
  }

  const accessToken = await getValidAccessToken();
  if (!accessToken) return NextResponse.json({ error: 'Google Drive not connected' }, { status: 400 });

  // Re-verify these are still genuinely orphaned right before acting on
  // them — the list the user is looking at could be a moment stale
  // (e.g. the campaign got recreated with the same ID reused, unlikely
  // but not impossible).
  const rows = await sql`
    SELECT s.id, s.playlist_id, s.playlist_name, s.audio_file_name, s.audio_local_path
    FROM schedules s
    WHERE s.id = ANY(${scheduleIds})
      AND s.is_active = true
      AND s.campaign_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM campaigns c WHERE c.id = s.campaign_id)
  `;

  const BATCH_SIZE = 15;
  let succeeded = 0;
  const failed: string[] = [];

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE) as any[];
    const outcomes = await Promise.all(batch.map(async (sched) => {
      try {
        await removePathFromPlaylistLocked(sched.playlist_id, sched.audio_local_path, accessToken);
        await sql`DELETE FROM schedules WHERE id = ${sched.id}`;
        return true;
      } catch (err: any) {
        console.error('[orphaned-schedules/remove] Failed:', sched, err);
        return false;
      }
    }));
    outcomes.forEach((ok, idx) => {
      if (ok) succeeded++;
      else failed.push(`${batch[idx].audio_file_name} (${batch[idx].playlist_name})`);
    });
  }

  return NextResponse.json({ succeeded, failed, total: rows.length });
}
