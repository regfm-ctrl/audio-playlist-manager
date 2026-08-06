import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { verifyToken } from '@/lib/auth';
import { ensureCampaignCategoryColumns } from '@/lib/campaign-schema';
import { removePathFromPlaylist, addPathToPlaylist } from '@/lib/playlist-ops';

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

// Finds which playlists are off-limits for this campaign because a
// different campaign in the same business category overlaps its date
// range and already has a recurring schedule sitting in that playlist.
async function getCategoryExcludedPlaylistIds(
  businessCategory: string | null | undefined,
  campaignId: number | undefined,
  startDate: string,
  endDate: string | null | undefined
): Promise<Set<string>> {
  const excluded = new Set<string>()
  if (!businessCategory || !businessCategory.trim()) return excluded

  const sameCategory = await sql`
    SELECT id, start_date, end_date FROM campaigns
    WHERE LOWER(business_category) = LOWER(${businessCategory})
      AND id IS DISTINCT FROM ${campaignId ?? -1}
  `

  const newStart = new Date(startDate).getTime()
  const newEnd = endDate ? new Date(endDate).getTime() : Infinity

  const conflictingCampaignIds = sameCategory
    .filter((c: any) => {
      const cStart = new Date(c.start_date).getTime()
      const cEnd = c.end_date ? new Date(c.end_date).getTime() : Infinity
      return cStart <= newEnd && cEnd >= newStart
    })
    .map((c: any) => c.id)

  if (conflictingCampaignIds.length === 0) return excluded

  const conflictSet = new Set(conflictingCampaignIds)
  const scheduleRows = await sql`SELECT playlist_id, campaign_id FROM schedules WHERE campaign_id IS NOT NULL`
  for (const row of scheduleRows as any[]) {
    if (conflictSet.has(row.campaign_id)) excluded.add(row.playlist_id)
  }
  return excluded
}

// If a chosen break is excluded (category conflict), tries another break
// in the same day+hour group before giving up on that slot entirely.
function resolveSlotConflict(
  pl: { id: string; name: string },
  pool: { id: string; name: string }[],
  excluded: Set<string>,
  chosen: Set<string>
): { id: string; name: string } | null {
  if (!excluded.has(pl.id) && !chosen.has(pl.id)) return pl
  const day = parseBreakDay(pl.name)
  const hour = parseBreakHour(pl.name)
  const alt = pool.find(p =>
    p.id !== pl.id &&
    parseBreakDay(p.name) === day &&
    parseBreakHour(p.name) === hour &&
    !excluded.has(p.id) &&
    !chosen.has(p.id)
  )
  return alt || null
}

export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await ensureCampaignCategoryColumns();

  const body = await req.json();
  const { campaign, previewSlots, accessToken, confirm = false, isEdit = false } = body;

  const {
    audio_file_id, audio_file_name, audio_directory_name, audio_local_path,
    spots_per_week, distribution_type, per_day_counts,
    allowed_days, time_from, time_to, allowed_breaks,
    position, start_date, end_date,
  } = campaign;

  // ── If confirming with pre-calculated slots ────────────────────────────────
  if (confirm && previewSlots && previewSlots.length > 0) {
    const endDate = end_date ? new Date(end_date) : null
    const weeklyEndDate = endDate ? endDate.toISOString() : null
    const isToday = new Date(start_date).toDateString() === new Date().toDateString()
    let created = 0
    let removed = 0
    let refreshed = 0
    const errors: string[] = []

    const desiredPlaylistIds = new Set(previewSlots.map((s: any) => s.id))

    // Editing an existing campaign: reconcile against what's already
    // placed, rather than blindly inserting everything again.
    if (isEdit && campaign.id) {
      const existingSchedules = await sql`
        SELECT * FROM schedules WHERE campaign_id = ${campaign.id} AND is_active = true
      `
      const currentPlaylistIds = new Set(existingSchedules.map((s: any) => s.playlist_id))

      for (const sched of existingSchedules) {
        const stillWanted = desiredPlaylistIds.has(sched.playlist_id)
        if (!stillWanted) {
          // No longer needed — actually strip it out of the playlist, not
          // just the database row
          try {
            await removePathFromPlaylist(sched.playlist_id, sched.audio_local_path, accessToken)
            await sql`DELETE FROM schedules WHERE id = ${sched.id}`
            removed++
          } catch (err: any) {
            errors.push(`Remove ${sched.playlist_name}: ${err.message ?? String(err)}`)
          }
        } else if (sched.audio_local_path !== audio_local_path) {
          // Same break, but the audio file changed — swap it in place
          try {
            await removePathFromPlaylist(sched.playlist_id, sched.audio_local_path, accessToken)
            await addPathToPlaylist(sched.playlist_id, audio_local_path, position ?? -1, accessToken)
            await sql`
              UPDATE schedules SET
                audio_file_id = ${audio_file_id ?? ''}, audio_file_name = ${audio_file_name},
                audio_directory_name = ${audio_directory_name ?? ''}, audio_local_path = ${audio_local_path},
                position = ${position ?? -1}, expires_at = ${weeklyEndDate}
              WHERE id = ${sched.id}
            `
            refreshed++
          } catch (err: any) {
            errors.push(`Update ${sched.playlist_name}: ${err.message ?? String(err)}`)
          }
        } else {
          // Unchanged placement — just refresh metadata (dates/position),
          // no Drive operation needed since the audio is already there
          try {
            await sql`
              UPDATE schedules SET position = ${position ?? -1}, expires_at = ${weeklyEndDate}
              WHERE id = ${sched.id}
            `
            refreshed++
          } catch (err: any) {
            errors.push(`Refresh ${sched.playlist_name}: ${err.message ?? String(err)}`)
          }
        }
      }

      // Add any genuinely new breaks
      for (const slot of previewSlots) {
        if (currentPlaylistIds.has(slot.id)) continue
        try {
          const hour = parseBreakHour(slot.name) ?? 9
          const timeOfDay = `${String(hour).padStart(2, '0')}:00`
          const dayOfWeek = String(slot.day ?? parseBreakDay(slot.name) ?? 0)
          const nextRun = isToday ? new Date().toISOString() : slot.scheduledFor

          await addPathToPlaylist(slot.id, audio_local_path, position ?? -1, accessToken)
          await sql`
            INSERT INTO schedules (
              audio_file_id, audio_file_name, audio_directory_name, audio_local_path,
              playlist_id, playlist_name, position,
              schedule_type, days_of_week, specific_dates, time_of_day,
              next_run_at, expires_at, created_by, campaign_id
            ) VALUES (
              ${audio_file_id ?? ''}, ${audio_file_name}, ${audio_directory_name ?? ''}, ${audio_local_path},
              ${slot.id}, ${slot.name}, ${position ?? -1},
              'recurring', ${dayOfWeek}, null, ${timeOfDay},
              ${nextRun}, ${weeklyEndDate}, ${user.username}, ${campaign.id}
            )
          `
          created++
        } catch (err: any) {
          errors.push(`Add ${slot.name}: ${err.message ?? String(err)}`)
        }
      }

      return NextResponse.json({
        ok: true,
        created, removed, refreshed,
        errors,
        message: `Updated: ${created} added, ${removed} removed, ${refreshed} unchanged/refreshed${errors.length ? `, ${errors.length} failed` : ''}`
      })
    }

    // ── Brand new campaign — insert everything fresh ──────────────────────
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
            next_run_at, expires_at, created_by, campaign_id
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
            ${user.username},
            ${campaign.id ?? null}
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

  // Which breaks already have a same-category campaign in them, for the
  // full duration this campaign would run
  const excludedPlaylistIds = await getCategoryExcludedPlaylistIds(
    campaign.business_category, campaign.id, start_date, end_date
  )

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

  // Resolve category conflicts: swap for another break in the same hour
  // where possible, otherwise drop the slot and note why.
  const skippedDueToConflict: string[] = []
  if (excludedPlaylistIds.size > 0) {
    const chosenIds = new Set<string>()
    const resolved: typeof selectedSlots = []
    for (const slot of selectedSlots) {
      const alt = resolveSlotConflict(slot, matching, excludedPlaylistIds, chosenIds)
      if (alt) {
        chosenIds.add(alt.id)
        resolved.push({ ...slot, id: alt.id, name: alt.name, day: parseBreakDay(alt.name) ?? slot.day })
      } else {
        skippedDueToConflict.push(slot.name)
      }
    }
    selectedSlots = resolved
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

  // For edits, work out what's actually changing vs what's already placed
  // so the preview can show it clearly before anything is touched.
  let diff: { added: string[]; removed: string[]; unchanged: string[]; audioChanged: boolean } | null = null
  if (isEdit && campaign.id) {
    const existingSchedules = await sql`
      SELECT * FROM schedules WHERE campaign_id = ${campaign.id} AND is_active = true
    `
    const currentByPlaylistId = new Map(existingSchedules.map((s: any) => [s.playlist_id, s]))
    const desiredIds = new Set(slotsWithDates.map(s => s.id))

    const added: string[] = []
    const unchanged: string[] = []
    let audioChanged = false

    for (const slot of slotsWithDates) {
      const existing = currentByPlaylistId.get(slot.id) as any
      if (!existing) {
        added.push(slot.name)
      } else if (existing.audio_local_path !== audio_local_path) {
        added.push(`${slot.name} (audio update)`)
        audioChanged = true
      } else {
        unchanged.push(slot.name)
      }
    }
    const removed = (existingSchedules as any[])
      .filter(s => !desiredIds.has(s.playlist_id))
      .map(s => s.playlist_name.replace(/\.m3u8$/i, ''))

    diff = { added, removed, unchanged, audioChanged }
  }

  return NextResponse.json({ preview: slotsWithDates, total: slotsWithDates.length, skippedDueToConflict, diff })
}
