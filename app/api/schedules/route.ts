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
    schedule_type, days_of_week, specific_dates, time_of_day, expires_at,
  } = await req.json();

  // Calculate next run
  const next_run_at = calculateNextRun(schedule_type, days_of_week, specific_dates, time_of_day);

  const rows = await sql`
    INSERT INTO schedules (
      audio_file_id, audio_file_name, audio_directory_name, audio_local_path,
      playlist_id, playlist_name, position,
      schedule_type, days_of_week, specific_dates, time_of_day,
      next_run_at, expires_at, created_by
    ) VALUES (
      ${audio_file_id}, ${audio_file_name}, ${audio_directory_name}, ${audio_local_path},
      ${playlist_id}, ${playlist_name}, ${position ?? -1},
      ${schedule_type}, ${days_of_week ?? null}, ${specific_dates ?? null}, ${time_of_day},
      ${next_run_at}, ${expires_at ?? null}, ${user.username}
    ) RETURNING *
  `;
  return NextResponse.json(rows[0]);
}

// PATCH — update a schedule
export async function PATCH(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id, is_active, days_of_week, specific_dates, time_of_day, schedule_type, position, expires_at } = await req.json();

  const next_run_at = calculateNextRun(schedule_type, days_of_week, specific_dates, time_of_day);

  await sql`
    UPDATE schedules SET
      is_active = ${is_active},
      days_of_week = ${days_of_week ?? null},
      specific_dates = ${specific_dates ?? null},
      time_of_day = ${time_of_day},
      schedule_type = ${schedule_type},
      position = ${position ?? -1},
      next_run_at = ${next_run_at},
      expires_at = ${expires_at ?? null}
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

// Melbourne is UTC+11 (AEDT) in summer, UTC+10 (AEST) in winter
// We use Intl.DateTimeFormat to reliably get the offset
function getMelbourneOffset(): number {
  const now = new Date();
  const utcMs = now.getTime();
  const melbStr = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Melbourne',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  }).format(now);
  // Parse the formatted Melbourne time back to ms
  const [datePart, timePart] = melbStr.split(', ');
  const [day, month, year] = datePart.split('/').map(Number);
  const [hour, min, sec] = timePart.split(':').map(Number);
  const melbMs = Date.UTC(year, month - 1, day, hour === 24 ? 0 : hour, min, sec);
  return (melbMs - utcMs) / 60000; // offset in minutes
}

function calculateNextRun(
  scheduleType: string,
  daysOfWeek: string | null,
  specificDates: string | null,
  timeOfDay: string
): string {
  const offsetMinutes = getMelbourneOffset();
  const nowUTC = new Date();
  // Current Melbourne time as a plain date
  const nowMelbMs = nowUTC.getTime() + offsetMinutes * 60000;
  const nowMelb = new Date(nowMelbMs);

  const [hours, minutes] = timeOfDay.split(':').map(Number);
  const pad = (n: number) => String(n).padStart(2, '0');

  const melbDateToUTC = (y: number, mo: number, d: number, h: number, m: number): Date => {
    const melbMs = Date.UTC(y, mo, d, h, m, 0) - offsetMinutes * 60000;
    return new Date(melbMs);
  };

  if (scheduleType === 'once' && specificDates) {
    const dates = specificDates.split(',').map((d: string) => d.trim());
    const future = dates
      .map(d => {
        const [y, mo, day] = d.split('-').map(Number);
        return melbDateToUTC(y, mo - 1, day, hours, minutes);
      })
      .filter(d => d > nowUTC)
      .sort((a, b) => a.getTime() - b.getTime());
    if (future.length > 0) return future[0].toISOString();
  }

  if (scheduleType === 'recurring' && daysOfWeek) {
    const days = daysOfWeek.split(',').map(Number);
    for (let i = 0; i <= 7; i++) {
      const candidate = new Date(nowMelb);
      candidate.setUTCDate(nowMelb.getUTCDate() + i);
      const utcCandidate = melbDateToUTC(
        candidate.getUTCFullYear(), candidate.getUTCMonth(),
        candidate.getUTCDate(), hours, minutes
      );
      if (days.includes(candidate.getUTCDay()) && utcCandidate > nowUTC) {
        return utcCandidate.toISOString();
      }
    }
  }

  // Default: tomorrow Melbourne time
  const tomorrow = new Date(nowMelb);
  tomorrow.setUTCDate(nowMelb.getUTCDate() + 1);
  return melbDateToUTC(
    tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(),
    tomorrow.getUTCDate(), hours, minutes
  ).toISOString();
}
