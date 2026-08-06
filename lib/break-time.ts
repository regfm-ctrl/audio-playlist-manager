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
