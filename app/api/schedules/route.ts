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

const MELBOURNE_TZ = 'Australia/Melbourne';

function getMelbourneDate(date: Date): Date {
  // Convert a UTC date to Melbourne local time representation
  const melb = new Date(date.toLocaleString('en-AU', { timeZone: MELBOURNE_TZ }));
  return melb;
}

function melbourneTimeToUTC(dateStr: string, timeOfDay: string): Date {
  // dateStr: 'YYYY-MM-DD', timeOfDay: 'HH:MM'
  // Create a date string in Melbourne time and convert to UTC
  const [hours, minutes] = timeOfDay.split(':').map(Number);
  const [year, month, day] = dateStr.split('-').map(Number);
  
  // Use Intl to find the UTC offset for Melbourne on that date
  const testDate = new Date(year, month - 1, day, hours, minutes, 0);
  const melbStr = testDate.toLocaleString('en-AU', { timeZone: MELBOURNE_TZ, hour12: false });
  const utcStr = testDate.toLocaleString('en-AU', { timeZone: 'UTC', hour12: false });
  
  // Calculate offset in minutes
  const toMs = (s: string) => {
    const parts = s.split(/[/, :]/).map(Number);
    return new Date(parts[2], parts[1]-1, parts[0], parts[3], parts[4]).getTime();
  };
  const offsetMs = toMs(melbStr) - toMs(utcStr);
  
  // Build the target UTC time
  const localMs = new Date(`${dateStr}T${timeOfDay.padStart(5,'0')}:00`).getTime();
  return new Date(localMs - offsetMs);
}

function calculateNextRun(
  scheduleType: string,
  daysOfWeek: string | null,
  specificDates: string | null,
  timeOfDay: string
): string {
  const nowUTC = new Date();
  const nowMelb = getMelbourneDate(nowUTC);

  const pad = (n: number) => String(n).padStart(2, '0');
  const todayMelbStr = `${nowMelb.getFullYear()}-${pad(nowMelb.getMonth()+1)}-${pad(nowMelb.getDate())}`;

  if (scheduleType === 'once' && specificDates) {
    const dates = specificDates.split(',').map((d: string) => d.trim());
    const futureDates = dates
      .map(d => ({ str: d, utc: melbourneTimeToUTC(d, timeOfDay) }))
      .filter(d => d.utc > nowUTC)
      .sort((a, b) => a.utc.getTime() - b.utc.getTime());
    if (futureDates.length > 0) return futureDates[0].utc.toISOString();
  }

  if (scheduleType === 'recurring' && daysOfWeek) {
    const days = daysOfWeek.split(',').map(Number);
    for (let i = 0; i <= 7; i++) {
      const candidate = new Date(nowMelb);
      candidate.setDate(nowMelb.getDate() + i);
      const candidateStr = `${candidate.getFullYear()}-${pad(candidate.getMonth()+1)}-${pad(candidate.getDate())}`;
      const candidateUTC = melbourneTimeToUTC(candidateStr, timeOfDay);
      if (days.includes(candidate.getDay()) && candidateUTC > nowUTC) {
        return candidateUTC.toISOString();
      }
    }
  }

  // Default: tomorrow Melbourne time
  const tomorrow = new Date(nowMelb);
  tomorrow.setDate(nowMelb.getDate() + 1);
  const tomorrowStr = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth()+1)}-${pad(tomorrow.getDate())}`;
  return melbourneTimeToUTC(tomorrowStr, timeOfDay).toISOString();
}

