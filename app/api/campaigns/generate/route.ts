import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { verifyToken } from '@/lib/auth';

async function getUser(req: NextRequest) {
  const token = req.cookies.get('token')?.value;
  if (!token) return null;
  return verifyToken(token);
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Parse break time from playlist name e.g. "Friday 06.00 - Block 01" -> 6
function parseBreakHour(name: string): number | null {
  const match = name.match(/(\d{2})[\.\:](\d{2})/)
  if (!match) return null
  return parseInt(match[1])
}

// Parse break day from playlist name e.g. "Friday 06.00 - Block 01" -> 5
function parseBreakDay(name: string): number | null {
  const dayMap: Record<string, number> = {
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
    thursday: 4, friday: 5, saturday: 6
  }
  const lower = name.toLowerCase()
  for (const [day, num] of Object.entries(dayMap)) {
    if (lower.startsWith(day)) return num
  }
  return null
}

// POST — generate preview or confirm schedule
export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const {
    campaign,
    playlists, // array of { id, name } from Google Drive
    confirm = false, // if true, actually create schedules
  } = await req.json();

  const {
    audio_file_id, audio_file_name, audio_directory_name, audio_local_path,
    spots_per_week, distribution_type, per_day_counts,
    allowed_days, time_from, time_to, allowed_breaks,
    position, start_date, end_date,
    sponsor_name,
  } = campaign;

  const allowedDayNums = allowed_days ? allowed_days.split(',').map(Number) : [0,1,2,3,4,5,6]
  const timeFromHour = time_from ? parseInt(time_from.split(':')[0]) : 0
  const toHour = time_to ? parseInt(time_to.split(':')[0]) : 23
  const allowedBreakIds = allowed_breaks ? allowed_breaks.split(',') : null

  // Step 1: Filter playlists by constraints
  let matching = playlists.filter((pl: { id: string; name: string }) => {
    // Filter by specific breaks if set
    if (allowedBreakIds && !allowedBreakIds.includes(pl.id)) return false

    // Filter by day
    const day = parseBreakDay(pl.name)
    if (day !== null && !allowedDayNums.includes(day)) return false

    // Filter by time
    const hour = parseBreakHour(pl.name)
    if (hour !== null && (hour < timeFromHour || hour > toHour)) return false

    return true
  })

  if (matching.length === 0) {
    return NextResponse.json({ error: 'No breaks match your constraints' }, { status: 400 })
  }

  // Step 2: Distribute spots
  let selectedSlots: { id: string; name: string; day: number; scheduledFor: string }[] = []

  if (distribution_type === 'even') {
    // Spread evenly — pick breaks spread across the week
    const totalNeeded = spots_per_week
    const step = Math.max(1, Math.floor(matching.length / totalNeeded))
    for (let i = 0; i < totalNeeded && i * step < matching.length; i++) {
      const pl = matching[i * step]
      selectedSlots.push({ ...pl, day: parseBreakDay(pl.name) ?? 0, scheduledFor: '' })
    }
  } else if (distribution_type === 'random') {
    // Random selection
    const shuffled = [...matching].sort(() => Math.random() - 0.5)
    selectedSlots = shuffled.slice(0, Math.min(spots_per_week, shuffled.length))
      .map(pl => ({ ...pl, day: parseBreakDay(pl.name) ?? 0, scheduledFor: '' }))
  } else if (distribution_type === 'per_day') {
    // Per day distribution
    const counts = per_day_counts || {}
    for (const [dayStr, count] of Object.entries(counts)) {
      const dayNum = parseInt(dayStr)
      const dayBreaks = matching.filter((pl: { id: string; name: string }) => parseBreakDay(pl.name) === dayNum)
      const step = Math.max(1, Math.floor(dayBreaks.length / (count as number)))
      for (let i = 0; i < (count as number) && i * step < dayBreaks.length; i++) {
        selectedSlots.push({ ...dayBreaks[i * step], day: dayNum, scheduledFor: '' })
      }
    }
  }

  // Step 3: Calculate scheduled dates starting from start_date
  const startDate = new Date(start_date)
  const endDate = end_date ? new Date(end_date) : null

  // For each slot, find the next occurrence of that day from start_date
  const slotsWithDates = selectedSlots.map(slot => {
    const targetDay = slot.day
    const d = new Date(startDate)
    // Find next occurrence of this day
    while (d.getDay() !== targetDay) {
      d.setDate(d.getDate() + 1)
    }
    const hour = parseBreakHour(slot.name) ?? 9
    d.setHours(hour, 0, 0, 0)
    return { ...slot, scheduledFor: d.toISOString() }
  }).filter(slot => !endDate || new Date(slot.scheduledFor) <= endDate)

  // Sort by scheduled date
  slotsWithDates.sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime())

  if (!confirm) {
    // Return preview only
    return NextResponse.json({ preview: slotsWithDates, total: slotsWithDates.length })
  }

  // Step 4: Confirm — create recurring schedules for each selected break
  let created = 0
  const weeklyEndDate = endDate ? endDate.toISOString() : null

  for (const slot of slotsWithDates) {
    // Create a recurring weekly schedule for this break
    const dayOfWeek = slot.day.toString()
    const hour = parseBreakHour(slot.name) ?? 9
    const timeOfDay = `${String(hour).padStart(2, '0')}:00`

    // Calculate next_run_at
    const nextRun = new Date(slot.scheduledFor)

    await sql`
      INSERT INTO schedules (
        audio_file_id, audio_file_name, audio_directory_name, audio_local_path,
        playlist_id, playlist_name, position,
        schedule_type, days_of_week, specific_dates, time_of_day,
        next_run_at, expires_at, created_by
      ) VALUES (
        ${audio_file_id}, ${audio_file_name}, ${audio_directory_name}, ${audio_local_path},
        ${slot.id}, ${slot.name}, ${position ?? -1},
        'recurring', ${dayOfWeek}, null, ${timeOfDay},
        ${nextRun.toISOString()}, ${weeklyEndDate}, ${user.username}
      )
    `
    created++
  }

  // Update campaign status to active
  if (campaign.id) {
    await sql`UPDATE campaigns SET status = 'active' WHERE id = ${campaign.id}`
  }

  return NextResponse.json({ ok: true, created, slots: slotsWithDates })
}
