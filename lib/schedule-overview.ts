import { sql } from '@/lib/db';
import { parseBreakDay, parseBreakTime } from '@/lib/break-time';

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export type OverviewSlot = {
  time: string; // "6:00am"
  minuteOfDay: number; // for sorting
  sponsors: string[];
};

export type WeeklyOverview = Record<number, OverviewSlot[]>; // 0=Sunday..6=Saturday

function formatTime(hour: number, minute: number): string {
  const period = hour >= 12 ? 'pm' : 'am';
  let displayHour = hour % 12;
  if (displayHour === 0) displayHour = 12;
  return `${displayHour}:${String(minute).padStart(2, '0')}${period}`;
}

// Every currently-active placement, grouped by day and exact time, with
// every sponsor sharing a slot listed together rather than duplicated.
export async function getWeeklyOverview(): Promise<WeeklyOverview> {
  const rows = await sql`
    SELECT s.playlist_name, s.audio_file_name, c.sponsor_name
    FROM schedules s
    LEFT JOIN campaigns c ON c.id = s.campaign_id
    WHERE s.is_active = true
  `;

  const overview: WeeklyOverview = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  const slotsByKey = new Map<string, OverviewSlot>(); // "day-minuteOfDay" -> slot

  for (const row of rows as any[]) {
    const day = parseBreakDay(row.playlist_name);
    const time = parseBreakTime(row.playlist_name);
    if (day === null || !time) continue;
    const label = row.sponsor_name || row.audio_file_name || 'Unknown';
    const minuteOfDay = time.hour * 60 + time.minute;
    const key = `${day}-${minuteOfDay}`;

    let slot = slotsByKey.get(key);
    if (!slot) {
      slot = { time: formatTime(time.hour, time.minute), minuteOfDay, sponsors: [] };
      slotsByKey.set(key, slot);
      overview[day].push(slot);
    }
    if (!slot.sponsors.includes(label)) slot.sponsors.push(label);
  }

  for (const day of Object.keys(overview)) {
    overview[Number(day)].sort((a, b) => a.minuteOfDay - b.minuteOfDay);
  }

  return overview;
}
