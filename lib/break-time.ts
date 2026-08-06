// Parses the day and time out of a break/playlist filename like
// "Friday 06.00am - Block 01" or the older 24-hour "Friday 18.00 Sponsorship
// Break". Handles both so renaming your Drive files to AM/PM format doesn't
// require renaming everything at once — old and new names both parse
// correctly.

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function parseBreakDay(name: string): number | null {
  const lower = name.toLowerCase();
  for (let i = 0; i < DAY_NAMES.length; i++) {
    if (lower.startsWith(DAY_NAMES[i].toLowerCase())) return i;
  }
  return null;
}

// Returns { hour: 0-23, minute: 0-59 } or null if no time found in the name.
// Understands an optional am/pm suffix; without one, the digits are taken
// as already being 24-hour (backwards compatible with existing filenames).
export function parseBreakTime(name: string): { hour: number; minute: number } | null {
  const match = name.match(/(\d{1,2})[.:](\d{2})\s*(am|pm)?/i);
  if (!match) return null;
  let hour = parseInt(match[1]);
  const minute = parseInt(match[2]);
  const meridiem = match[3]?.toLowerCase();
  if (meridiem === 'pm' && hour !== 12) hour += 12;
  if (meridiem === 'am' && hour === 12) hour = 0;
  return { hour, minute };
}

export function parseBreakHour(name: string): number | null {
  return parseBreakTime(name)?.hour ?? null;
}

export function parseBreakMinute(name: string): number {
  return parseBreakTime(name)?.minute ?? 0;
}

// Minutes since midnight — used to tell breaks apart by their real time
// (not just their hour), so distinct-minute blocks within the same hour
// are treated as genuinely different slots rather than duplicates.
export function parseBreakMinuteOfDay(name: string): number | null {
  const t = parseBreakTime(name);
  return t ? t.hour * 60 + t.minute : null;
}

// Converts a Melbourne wall-clock date+time (what a break's name actually
// means — "6pm" means 6pm in Melbourne, not 6pm UTC) into the correct UTC
// instant, automatically handling AEST/AEDT. Needed because server
// functions run in UTC, so naively using Date.setHours() sets the hour in
// UTC and silently shifts every scheduled time by 10-11 hours.
export function melbourneWallTimeToUTC(year: number, month: number, day: number, hour: number, minute: number): Date {
  // First pass: treat the wall-clock values as if they were already UTC,
  // then find Melbourne's actual UTC offset near that instant and correct
  // for it. A single pass is sufficient except exactly on a DST-transition
  // day, which is an acceptable edge case here.
  const guessUTC = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Australia/Melbourne',
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(guessUTC)) parts[p.type] = p.value;
  const melbourneAsUTC = Date.UTC(
    parseInt(parts.year), parseInt(parts.month) - 1, parseInt(parts.day),
    parts.hour === '24' ? 0 : parseInt(parts.hour), parseInt(parts.minute), parseInt(parts.second)
  );
  const offsetMinutes = (melbourneAsUTC - guessUTC.getTime()) / 60000;
  return new Date(guessUTC.getTime() - offsetMinutes * 60000);
}
