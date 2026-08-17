import { getSetting, setSetting } from '@/lib/app-settings';

export type BlockedWindow = { day: number; startTime: string; endTime: string; label?: string };

export async function getBlockedWindows(): Promise<BlockedWindow[]> {
  const raw = await getSetting('blocked_time_windows');
  try {
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function setBlockedWindows(windows: BlockedWindow[]): Promise<void> {
  await setSetting('blocked_time_windows', JSON.stringify(windows));
}

function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + (m || 0);
}

// endTime is inclusive — a window "18:00" to "18:45" covers exactly the
// four 15-minute breaks at 18:00/18:15/18:30/18:45, matching how someone
// would naturally describe a show's on-air time slot (the show's last
// break IS 18:45, not 19:00).
export function isBreakBlocked(day: number | null, minuteOfDay: number | null, windows: BlockedWindow[]): boolean {
  if (day === null || minuteOfDay === null || windows.length === 0) return false;
  return windows.some((w) => {
    if (w.day !== day) return false;
    const start = toMinutes(w.startTime);
    const end = toMinutes(w.endTime);
    return minuteOfDay >= start && minuteOfDay <= end;
  });
}
