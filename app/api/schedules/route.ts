import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { verifyToken } from '@/lib/auth';

async function getUser(req: NextRequest) {
  const token = req.cookies.get('token')?.value;
  if (!token) return null;
  return verifyToken(token);
}

// GET — list all schedules
export async function GET(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rows = await sql`
    SELECT * FROM schedules ORDER BY created_at DESC
  `;
  return NextResponse.json(rows);
}

// POST — create a schedule
export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const {
    audio_file_id, audio_file_name, audio_directory_name, audio_local_path,
    playlist_id, playlist_name, position,
    schedule_type, days_of_week, specific_dates, time_of_day,
  } = await req.json();

  // Calculate next run
  const next_run_at = calculateNextRun(schedule_type, days_of_week, specific_dates, time_of_day);

  const rows = await sql`
    INSERT INTO schedules (
      audio_file_id, audio_file_name, audio_directory_name, audio_local_path,
      playlist_id, playlist_name, position,
      schedule_type, days_of_week, specific_dates, time_of_day,
      next_run_at, created_by
    ) VALUES (
      ${audio_file_id}, ${audio_file_name}, ${audio_directory_name}, ${audio_local_path},
      ${playlist_id}, ${playlist_name}, ${position ?? -1},
      ${schedule_type}, ${days_of_week ?? null}, ${specific_dates ?? null}, ${time_of_day},
      ${next_run_at}, ${user.username}
    ) RETURNING *
  `;
  return NextResponse.json(rows[0]);
}

// PATCH — update a schedule
export async function PATCH(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id, is_active, days_of_week, specific_dates, time_of_day, schedule_type, position } = await req.json();

  const next_run_at = calculateNextRun(schedule_type, days_of_week, specific_dates, time_of_day);

  await sql`
    UPDATE schedules SET
      is_active = ${is_active},
      days_of_week = ${days_of_week ?? null},
      specific_dates = ${specific_dates ?? null},
      time_of_day = ${time_of_day},
      schedule_type = ${schedule_type},
      position = ${position ?? -1},
      next_run_at = ${next_run_at}
    WHERE id = ${id}
  `;
  return NextResponse.json({ ok: true });
}

// DELETE — remove a schedule
export async function DELETE(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await req.json();
  await sql`DELETE FROM schedules WHERE id = ${id}`;
  return NextResponse.json({ ok: true });
}

function calculateNextRun(
  scheduleType: string,
  daysOfWeek: string | null,
  specificDates: string | null,
  timeOfDay: string
): string {
  const now = new Date();
  const [hours, minutes] = timeOfDay.split(':').map(Number);

  if (scheduleType === 'once' && specificDates) {
    const dates = specificDates.split(',').map((d: string) => new Date(d.trim()));
    const future = dates.filter((d) => d > now).sort((a, b) => a.getTime() - b.getTime());
    if (future.length > 0) {
      future[0].setHours(hours, minutes, 0, 0);
      return future[0].toISOString();
    }
  }

  if (scheduleType === 'recurring' && daysOfWeek) {
    const days = daysOfWeek.split(',').map(Number);
    const candidate = new Date(now);
    for (let i = 0; i <= 7; i++) {
      const d = new Date(candidate);
      d.setDate(candidate.getDate() + i);
      d.setHours(hours, minutes, 0, 0);
      if (days.includes(d.getDay()) && d > now) {
        return d.toISOString();
      }
    }
  }

  // Default: tomorrow at the specified time
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(hours, minutes, 0, 0);
  return tomorrow.toISOString();
}

