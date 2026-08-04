import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { verifyToken } from '@/lib/auth';

async function getUser(req: NextRequest) {
  const token = req.cookies.get('token')?.value;
  if (!token) return null;
  return verifyToken(token);
}

// GET — list all campaigns
export async function GET(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rows = await sql`SELECT * FROM campaigns ORDER BY created_at DESC`;
  return NextResponse.json(rows);
}

// POST — create campaign
export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const {
    sponsor_name, audio_file_id, audio_file_name, audio_directory_name, audio_local_path,
    spots_per_week, distribution_type, per_day_counts,
    allowed_days, time_from, time_to, allowed_breaks,
    position, start_date, end_date,
  } = await req.json();

  const rows = await sql`
    INSERT INTO campaigns (
      sponsor_name, audio_file_id, audio_file_name, audio_directory_name, audio_local_path,
      spots_per_week, distribution_type, per_day_counts,
      allowed_days, time_from, time_to, allowed_breaks,
      position, start_date, end_date, created_by
    ) VALUES (
      ${sponsor_name}, ${audio_file_id}, ${audio_file_name}, ${audio_directory_name}, ${audio_local_path},
      ${spots_per_week}, ${distribution_type}, ${per_day_counts ? JSON.stringify(per_day_counts) : null},
      ${allowed_days ?? null}, ${time_from ?? null}, ${time_to ?? null}, ${allowed_breaks ?? null},
      ${position ?? -1}, ${start_date}, ${end_date ?? null}, ${user.username}
    ) RETURNING *
  `;
  return NextResponse.json(rows[0]);
}

// PATCH — update status or details
export async function PATCH(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id, status } = await req.json();
  await sql`UPDATE campaigns SET status = ${status} WHERE id = ${id}`;
  return NextResponse.json({ ok: true });
}

// DELETE — remove campaign
export async function DELETE(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await req.json();
  await sql`DELETE FROM campaigns WHERE id = ${id}`;
  return NextResponse.json({ ok: true });
}
