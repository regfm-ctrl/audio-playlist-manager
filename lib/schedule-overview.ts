import { sql } from '@/lib/db';
import { parseBreakDay, parseBreakTime } from '@/lib/break-time';

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export type OverviewSlot = {
  time: string; // "6:00am"
  minuteOfDay: number; // for sorting
  sponsors: string[];
};

export type WeeklyOverview = Record<number, OverviewSlot[]>; // 0=Sunday..6=Saturday

const POSITION_WEIGHT: Record<string, number> = { first: 0, middle: 1, second_last: 2, last: 3 };

function formatTime(hour: number, minute: number): string {
  const period = hour >= 12 ? 'pm' : 'am';
  let displayHour = hour % 12;
  if (displayHour === 0) displayHour = 12;
  return `${displayHour}:${String(minute).padStart(2, '0')}${period}`;
}

// Every currently-active placement, grouped by day and exact time, with
// every sponsor sharing a slot listed together rather than duplicated —
// and sorted by each sponsor's declared position (First/Second Last/Last
// genuinely shown in that order; "Middle" sponsors are grouped correctly
// between them, though their exact order relative to each other isn't
// guaranteed to match the real file — that would need reading Drive live).
export async function getWeeklyOverview(): Promise<WeeklyOverview> {
  const rows = await sql`
    SELECT s.playlist_name, s.audio_file_name, s.position_type, c.sponsor_name
    FROM schedules s
    LEFT JOIN campaigns c ON c.id = s.campaign_id
    WHERE s.is_active = true
  `;

  type SlotBuild = { day: number; time: string; minuteOfDay: number; entries: { label: string; weight: number }[] };
  const slotsByKey = new Map<string, SlotBuild>();

  for (const row of rows as any[]) {
    const day = parseBreakDay(row.playlist_name);
    const time = parseBreakTime(row.playlist_name);
    if (day === null || !time) continue;
    const label = row.sponsor_name || row.audio_file_name || 'Unknown';
    const weight = POSITION_WEIGHT[row.position_type] ?? POSITION_WEIGHT.middle;
    const minuteOfDay = time.hour * 60 + time.minute;
    const key = `${day}-${minuteOfDay}`;

    let slot = slotsByKey.get(key);
    if (!slot) {
      slot = { day, time: formatTime(time.hour, time.minute), minuteOfDay, entries: [] };
      slotsByKey.set(key, slot);
    }
    if (!slot.entries.some((e) => e.label === label)) slot.entries.push({ label, weight });
  }

  const overview: WeeklyOverview = { 0: [], 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  for (const slot of slotsByKey.values()) {
    const sortedLabels = [...slot.entries].sort((a, b) => a.weight - b.weight).map((e) => e.label);
    overview[slot.day].push({ time: slot.time, minuteOfDay: slot.minuteOfDay, sponsors: sortedLabels });
  }

  for (const day of Object.keys(overview)) {
    overview[Number(day)].sort((a, b) => a.minuteOfDay - b.minuteOfDay);
  }

  return overview;
}

