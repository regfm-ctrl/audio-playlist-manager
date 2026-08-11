import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { verifyToken } from '@/lib/auth';

// Finds active schedules left behind by a campaign that was deleted
// without its "also remove schedules" option — the campaign row is gone,
// but the schedule rows (and the real audio in Drive) are still sitting
// there, with nothing left to naturally end them.
export async function GET(req: NextRequest) {
  const token = req.cookies.get('token')?.value;
  const user = token ? await verifyToken(token) : null;
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rows = await sql`
    SELECT s.id, s.playlist_id, s.playlist_name, s.audio_file_name, s.audio_local_path, s.campaign_id
    FROM schedules s
    WHERE s.is_active = true
      AND s.campaign_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM campaigns c WHERE c.id = s.campaign_id)
    ORDER BY s.campaign_id, s.playlist_name
  `;

  return NextResponse.json({ orphaned: rows });
}
