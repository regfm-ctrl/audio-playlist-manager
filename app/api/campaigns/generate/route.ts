import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { verifyToken } from '@/lib/auth';

async function getUser(req: NextRequest) {
  const token = req.cookies.get('token')?.value;
  if (!token) return null;
  return verifyToken(token);
}

const PLAYLIST_FOLDER_ID = process.env.PLAYLIST_FOLDER_ID || '1sPxn5mFxy7DagMtpmGGq4-K1c98BX_-b';

function parseBreakHour(name: string): number | null {
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

  const body = await req.json();
  const { campaign, previewSlots, accessToken, confirm = false } = body;

  const {
    audio_file_id, audio_file_name, audio_directory_name, audio_local_path,
    spots_per_week, distribution_type, per_day_counts,
    allowed_days, time_from, time_to, allowed_breaks,
    position, start_date, end_date,
  } = campaign;

  // ── If confirming with pre-calculated slots, insert directly ──────────────
  if (confirm && previewSlots && previewSlots.length > 0) {
    const endDate = end_date ? new Date(end_date) : null
    const weeklyEndDate = endDate ? endDate.toISOString() : null
    const isToday = new Date(start_date).toDateString() === new Date().toDateString()
    let created = 0
    const errors: string[] = []

    for (const slot of previewSlots) {
      try {
        const hour = parseBreakHour(slot.name) ?? 9
        const timeOfDay = `${String(hour).padStart(2, '0')}:00`
        const dayOfWeek = String(slot.day ?? parseBreakDay(slot.name) ?? 0)
        const nextRun = isToday ? new Date().toISOString() : slot.scheduledFor

        await sql`
          INSERT INTO schedules (
            audio_file_id, audio_file_name, audio_directory_name, audio_local_path,
            playlist_id, playlist_name, position,
            schedule_type, days_of_week, specific_dates, time_of_day,
            next_run_at, expires_at, created_by
          ) VALUES (
            ${audio_file_id ?? ''},
            ${audio_file_name},
            ${audio_directory_name ?? ''},
            ${audio_local_path},
            ${slot.id},
            ${slot.name},
            ${position ?? -1},
            'recurring',
            ${dayOfWeek},
            null,
            ${timeOfDay},
            ${nextRun},
            ${weeklyEndDate},
            ${user.username}
          )
        `
        created++
      } catch (err: any) {
        console.error('[campaigns/generate] Insert error:', err)
        errors.push(`${slot.name}: ${err.message ?? String(err)}`)
      }
    }

    if (campaign.id) {
      try {
        await sql`UPDATE campaigns SET status = 'active' WHERE id = ${campaign.id}`
      } catch {}
    }

    return NextResponse.json({
      ok: created > 0,
      created,
      total: previewSlots.length,
      errors,
      message: created > 0
        ? `Created ${created} of ${previewSlots.length} schedules`
        : `Failed to create schedules. Errors: ${errors.join(' | ')}`
    })
  }

  // ── Preview: fetch playlists + filter + distribute ────────────────────────
  let playlists: { id: string; name: string }[] = []

  if (accessToken) {
    try {
      const res = await fetch(
        `https://www.googleapis.com/drive/v3/files?q='${PLAYLIST_FOLDER_ID}'+in+parents+and+trashed=false&fields=files(id,name)&pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      )
      if (res.ok) {
        const data = await res.json()
        playlists = (data.files || []).filter((f: any) => f.name.endsWith('.m3u8'))
      }
    } catch (err) {
      console.error('[campaigns/generate] Playlist fetch error:', err)
    }
  }

  if (playlists.length === 0) {
    return NextResponse.json({ error: 'Could not load playlists from Google Drive. Make sure you are logged in to the main app.' }, { status: 400 })
  }

  const allowedDayNums = allowed_days
    ? (Array.isArray(allowed_days) ? allowed_days.map(Number) : allowed_days.split(',').map(Number))
    : [0,1,2,3,4,5,6]
  const timeFromHour = time_from ? parseInt(time_from.split(':')[0]) : 0
  const toHour = time_to ? parseInt(time_to.split(':')[0]) : 23
  const allowedBreakIds = allowed_breaks
    ? (Array.isArray(allowed_breaks) ? allowed_breaks : allowed_breaks.split(','))
    : null

  const matching = playlists.filter(pl => {
    if (allowedBreakIds && !allowedBreakIds.includes(pl.id)) return false
    const day = parseBreakDay(pl.name)
    if (day !== null && !allowedDayNums.includes(day)) return false
    const hour = parseBreakHour(pl.name)
    if (hour !== null && (hour < timeFromHour || hour > toHour)) return false
    return true
  })

  if (matching.length === 0) {
    return NextResponse.json({
      error: `No breaks match your constraints. ${playlists.length} total playlists checked. Days: ${allowedDayNums}, Hours: ${timeFromHour}-${toHour}. Sample names: ${playlists.slice(0,3).map(p=>p.name).join(', ')}`,
    }, { status: 400 })
  }

  let selectedSlots: { id: string; name: string; day: number; scheduledFor: string }[] = []

  if (distribution_type === 'even') {
    const step = Math.max(1, Math.floor(matching.length / spots_per_week))
    for (let i = 0; i < spots_per_week && i * step < matching.length; i++) {
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
      const dayBreaks = matching.filter(pl => parseBreakDay(pl.name) === dayNum)
      const step = Math.max(1, Math.floor(dayBreaks.length / (count as number)))
      for (let i = 0; i < (count as number) && i * step < dayBreaks.length; i++) {
        selectedSlots.push({ ...dayBreaks[i * step], day: dayNum, scheduledFor: '' })
      }
    }
  }

  const startDate = new Date(start_date)
  const endDate = end_date ? new Date(end_date) : null

  const slotsWithDates = selectedSlots.map(slot => {
    const d = new Date(startDate)
    while (d.getDay() !== slot.day) { d.setDate(d.getDate() + 1) }
    const hour = parseBreakHour(slot.name) ?? 9
    d.setHours(hour, 0, 0, 0)
    return { ...slot, scheduledFor: d.toISOString() }
  }).filter(slot => !endDate || new Date(slot.scheduledFor) <= endDate)
    .sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime())

  return NextResponse.json({ preview: slotsWithDates, total: slotsWithDates.length })
}

