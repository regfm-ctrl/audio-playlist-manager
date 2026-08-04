import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { verifyToken } from '@/lib/auth';

async function getUser(req: NextRequest) {
  const token = req.cookies.get('token')?.value;
  if (!token) return null;
  return verifyToken(token);
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PLAYLIST_FOLDER_ID = process.env.PLAYLIST_FOLDER_ID || '1sPxn5mFxy7DagMtpmGGq4-K1c98BX_-b';

function parseBreakHour(name: string): number | null {
  // Match "06.00" or "06:00" in break names like "Friday 06.00 - Block 01"
  const match = name.match(/(\d{2})[\.\:](\d{2})/)
  if (!match) return null
  return parseInt(match[1])
}

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

export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const {
    campaign,
    playlists: clientPlaylists,
    previewSlots,  // pre-calculated slots from the preview step
    accessToken,
    confirm = false,
  } = await req.json();

  const {
    audio_file_id, audio_file_name, audio_directory_name, audio_local_path,
    spots_per_week, distribution_type, per_day_counts,
    allowed_days, time_from, time_to, allowed_breaks,
    position, start_date, end_date, sponsor_name,
  } = campaign;

  // Fetch playlists server-side using the access token passed from client
  let playlists: { id: string; name: string }[] = clientPlaylists || [];

  if ((!playlists || playlists.length === 0) && accessToken) {
    try {
      const listRes = await fetch(
        `https://www.googleapis.com/drive/v3/files?q='${PLAYLIST_FOLDER_ID}'+in+parents+and+trashed=false&fields=files(id,name)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (listRes.ok) {
        const data = await listRes.json();
        playlists = (data.files || []).filter((f: any) => f.name.endsWith('.m3u8'));
      }
    } catch (err) {
      console.error('[campaigns/generate] Failed to fetch playlists:', err);
    }
  }

  // Debug info
  const debug = {
    playlistCount: playlists.length,
    allowedDays: allowed_days,
    timeFrom: time_from,
    timeTo: time_to,
    spotsPerWeek: spots_per_week,
    distribution: distribution_type,
    samplePlaylists: playlists.slice(0, 3).map((p: any) => p.name),
  };

  const allowedDayNums = allowed_days ? allowed_days.split(',').map(Number) : [0,1,2,3,4,5,6]
  const timeFromHour = time_from ? parseInt(time_from.split(':')[0]) : 0
  const toHour = time_to ? parseInt(time_to.split(':')[0]) : 23
  const allowedBreakIds = allowed_breaks ? allowed_breaks.split(',') : null

  // Filter playlists
  const matching = playlists.filter((pl: { id: string; name: string }) => {
    if (allowedBreakIds && !allowedBreakIds.includes(pl.id)) return false
    const day = parseBreakDay(pl.name)
    if (day !== null && !allowedDayNums.includes(day)) return false
    const hour = parseBreakHour(pl.name)
    if (hour !== null && (hour < timeFromHour || hour > toHour)) return false
    return true
  })

  if (matching.length === 0) {
    return NextResponse.json({
      error: 'No breaks match your constraints',
      debug,
      matchingCount: 0,
    }, { status: 400 })
  }

  // Distribute spots
  let selectedSlots: { id: string; name: string; day: number; scheduledFor: string }[] = []

  if (distribution_type === 'even') {
    const totalNeeded = spots_per_week
    const step = Math.max(1, Math.floor(matching.length / totalNeeded))
    for (let i = 0; i < totalNeeded && i * step < matching.length; i++) {
      const pl = matching[i * step]
      selectedSlots.push({ ...pl, day: parseBreakDay(pl.name) ?? 0, scheduledFor: '' })
    }
  } else if (distribution_type === 'random') {
    const shuffled = [...matching].sort(() => Math.random() - 0.5)
    selectedSlots = shuffled.slice(0, Math.min(spots_per_week, shuffled.length))
      .map(pl => ({ ...pl, day: parseBreakDay(pl.name) ?? 0, scheduledFor: '' }))
  } else if (distribution_type === 'per_day') {
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

  // Calculate dates
  const startDate = new Date(start_date)
  const endDate = end_date ? new Date(end_date) : null
  const isToday = startDate.toDateString() === new Date().toDateString()

  const slotsWithDates = selectedSlots.map(slot => {
    const targetDay = slot.day
    const d = new Date(startDate)
    while (d.getDay() !== targetDay) { d.setDate(d.getDate() + 1) }
    const hour = parseBreakHour(slot.name) ?? 9
    d.setHours(hour, 0, 0, 0)
    return { ...slot, scheduledFor: d.toISOString() }
  }).filter(slot => !endDate || new Date(slot.scheduledFor) <= endDate)

  slotsWithDates.sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime())

  if (!confirm) {
    return NextResponse.json({ preview: slotsWithDates, total: slotsWithDates.length, debug })
  }

  // Confirm — create schedules
  let created = 0
  const errors: string[] = []
  const weeklyEndDate = endDate ? endDate.toISOString() : null

  // If previewSlots were passed directly (from the confirm step), use those instead
  // This avoids re-running the filter which may behave differently
  const finalSlots = (confirm && previewSlots && previewSlots.length > 0)
    ? previewSlots
    : slotsWithDates

  if (finalSlots.length === 0) {
    return NextResponse.json({
      error: 'No slots to schedule — preview returned 0 results',
      debug: { ...debug, slotsWithDatesLength: 0, matchingLength: matching.length }
    }, { status: 400 })
  }

  for (const slot of finalSlots) {
    try {
      const dayOfWeek = slot.day.toString()
      const hour = parseBreakHour(slot.name) ?? 9
      const timeOfDay = `${String(hour).padStart(2, '0')}:00`
      const nextRun = isToday ? new Date() : new Date(slot.scheduledFor)

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
    } catch (err: any) {
      console.error('[campaigns/generate] Insert failed:', err)
      errors.push(`${slot.name}: ${err.message}`)
    }
  }

  if (campaign.id) {
    try {
      await sql`UPDATE campaigns SET status = 'active' WHERE id = ${campaign.id}`
    } catch (err: any) {
      console.error('[campaigns/generate] Status update failed:', err)
    }
  }

  if (created === 0) {
    return NextResponse.json({
      error: `Failed to create any schedules. ${errors.length} errors.`,
      errors,
      debug: { ...debug, slotsWithDatesLength: slotsWithDates.length }
    }, { status: 500 })
  }

  return NextResponse.json({ ok: true, created, total: finalSlots.length, errors, slots: finalSlots, debug })
}
