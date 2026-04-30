import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { verifyToken } from '@/lib/auth';

async function getUser(req: NextRequest) {
  const token = req.cookies.get('token')?.value;
  if (!token) return null;
  return verifyToken(token);
}

// GET — fetch cached durations for a list of file IDs
export async function GET(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const ids = req.nextUrl.searchParams.get('ids');
  if (!ids) return NextResponse.json([]);

  const idList = ids.split(',').filter(Boolean);
  const rows = await sql`
    SELECT file_id, duration_seconds, file_name
    FROM audio_durations
    WHERE file_id = ANY(${idList})
  `;
  return NextResponse.json(rows);
}

// POST — save a batch of measured durations
export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { durations } = await req.json();
  // durations: Array<{ file_id: string, file_name: string, duration_seconds: number }>

  for (const d of durations) {
    await sql`
      INSERT INTO audio_durations (file_id, file_name, duration_seconds, measured_at)
      VALUES (${d.file_id}, ${d.file_name}, ${d.duration_seconds}, NOW())
      ON CONFLICT (file_id) DO UPDATE
        SET duration_seconds = ${d.duration_seconds},
            file_name = ${d.file_name},
            measured_at = NOW()
    `;
  }
  return NextResponse.json({ ok: true, saved: durations.length });
}
