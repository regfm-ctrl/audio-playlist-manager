import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { verifyToken } from '@/lib/auth';
import { ensureCampaignCategoryColumns } from '@/lib/campaign-schema';
import { removePathFromPlaylist, addPathToPlaylist } from '@/lib/playlist-ops';
import { parseBreakDay, parseBreakHour, parseBreakMinuteOfDay, parseBreakTime, melbourneWallTimeToUTC } from '@/lib/break-time';
import { PLAYLIST_FOLDER_ID } from '@/lib/folder-config';

export const maxDuration = 60;

async function getUser(req: NextRequest) {
  const token = req.cookies.get('token')?.value;
  if (!token) return null;
  return verifyToken(token);
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
    let created = 0
    let removed = 0
    let refreshed = 0
    const errors: string[] = []

    // Drive writes are the slow part (each is a fetch + a save). Process
    // in parallel batches rather than one slot at a time, or a campaign
    // with more than a handful of spots takes far too long to confirm.
    const BATCH_SIZE = 15
    async function processInBatches<T, R>(items: T[], worker: (item: T) => Promise<R>): Promise<R[]> {
      const results: R[] = []
      for (let i = 0; i < items.length; i += BATCH_SIZE) {
        const batch = items.slice(i, i + BATCH_SIZE)
        results.push(...await Promise.all(batch.map(worker)))
      }
      return results
    }

    const desiredPlaylistIds = new Set(previewSlots.map((s: any) => s.id))

    // Editing an existing campaign: reconcile against what's already
    // placed, rather than blindly inserting everything again.
    if (isEdit && campaign.id) {
      const existingSchedules = await sql`
        SELECT * FROM schedules WHERE campaign_id = ${campaign.id} AND is_active = true
      `
      const currentPlaylistIds = new Set(existingSchedules.map((s: any) => s.playlist_id))

      const reconcileResults = await processInBatches(existingSchedules, async (sched: any) => {
        const stillWanted = desiredPlaylistIds.has(sched.playlist_id)
        if (!stillWanted) {
          // No longer needed — actually strip it out of the playlist, not
          // just the database row
          try {
            await removePathFromPlaylist(sched.playlist_id, sched.audio_local_path, accessToken)
            await sql`DELETE FROM schedules WHERE id = ${sched.id}`
            return { type: 'removed' as const }
          } catch (err: any) {
            return { type: 'error' as const, message: `Remove ${sched.playlist_name}: ${err.message ?? String(err)}` }
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
            return { type: 'refreshed' as const }
          } catch (err: any) {
            return { type: 'error' as const, message: `Update ${sched.playlist_name}: ${err.message ?? String(err)}` }
          }
        } else {
          // Unchanged placement — just refresh metadata (dates/position),
          // no Drive operation needed since the audio is already there
          try {
            await sql`
              UPDATE schedules SET position = ${position ?? -1}, expires_at = ${weeklyEndDate}
              WHERE id = ${sched.id}
            `
            return { type: 'refreshed' as const }
          } catch (err: any) {
            return { type: 'error' as const, message: `Refresh ${sched.playlist_name}: ${err.message ?? String(err)}` }
          }
        }
      })
      for (const r of reconcileResults) {
        if (r.type === 'removed') removed++
        else if (r.type === 'refreshed') refreshed++
        else errors.push(r.message)
      }

      // Add any genuinely new breaks
      const newSlots = previewSlots.filter((slot: any) => !currentPlaylistIds.has(slot.id))
      const addResults = await processInBatches(newSlots, async (slot: any) => {
        try {
          const hour = parseBreakHour(slot.name) ?? 9
          const timeOfDay = `${String(hour).padStart(2, '0')}:00`
          const dayOfWeek = String(slot.day ?? parseBreakDay(slot.name) ?? 0)
          const nextRun = slot.scheduledFor

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
          return { ok: true as const }
        } catch (err: any) {
          return { ok: false as const, message: `Add ${slot.name}: ${err.message ?? String(err)}` }
        }
      })
      for (const r of addResults) {
        if (r.ok) created++
        else errors.push(r.message)
      }

      return NextResponse.json({
        ok: true,
        created, removed, refreshed,
        errors,
        message: `Updated: ${created} added, ${removed} removed, ${refreshed} unchanged/refreshed${errors.length ? `, ${errors.length} failed` : ''}`
      })
    }

    // ── Brand new campaign — write to Drive immediately + insert schedules ──
    const createResults = await processInBatches(previewSlots, async (slot: any) => {
      try {
        const hour = parseBreakHour(slot.name) ?? 9
        const timeOfDay = `${String(hour).padStart(2, '0')}:00`
        const dayOfWeek = String(slot.day ?? parseBreakDay(slot.name) ?? 0)
        const nextRun = slot.scheduledFor

        // Apply to Drive right away, same as an edit does. If this fails
        // (e.g. a transient Drive error) the schedule row is still created
        // with next_run_at due, so the normal scheduler run will retry it.
        const outcome = await addPathToPlaylist(slot.id, audio_local_path, position ?? -1, accessToken)
        const driveError = outcome === 'failed'
          ? `${slot.name}: failed to write to Drive, will retry on next scheduler run`
          : null

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
        return { ok: true as const, driveError }
      } catch (err: any) {
        console.error('[campaigns/generate] Insert error:', err)
        return { ok: false as const, message: `${slot.name}: ${err.message ?? String(err)}` }
      }
    })
    for (const r of createResults) {
      if (r.ok) { created++; if (r.driveError) errors.push(r.driveError) }
      else errors.push(r.message)
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

  // Existing active placements for this campaign (edit mode only). These
  // are kept exactly where they are if still valid — the distribution
  // algorithm only runs to fill the *gap* between what's already placed
  // and the new target count, instead of recalculating everything from
  // scratch (which previously reshuffled the whole set whenever
  // spots_per_week changed, since the step size depends on the count).
  let existingSchedules: any[] = []
  if (isEdit && campaign.id) {
    existingSchedules = await sql`SELECT * FROM schedules WHERE campaign_id = ${campaign.id} AND is_active = true`
  }
  const existingIds = new Set(existingSchedules.map((s: any) => s.playlist_id))

  let anchorPool = matching
    .filter(pl => existingIds.has(pl.id) && !excludedPlaylistIds.has(pl.id))
    .map(pl => ({ ...pl, day: parseBreakDay(pl.name) ?? 0, scheduledFor: '' }))
    .sort((a, b) => (a.day - b.day) || ((parseBreakHour(a.name) ?? 0) - (parseBreakHour(b.name) ?? 0)))

  // When there are more anchors than the new target, drop duplicate-time
  // ones first (keep at most one anchor per distinct day+time) before
  // falling back to trimming by chronological order. Otherwise two spots
  // that happen to land at the exact same time (different blocks with the
  // same minute) can both survive a trim while a genuinely different time
  // gets dropped.
  function dedupeByTimeFirst<T extends { day: number; name: string }>(items: T[]): T[] {
    const seen = new Set<string>()
    const unique: T[] = []
    const dupes: T[] = []
    for (const item of items) {
      const key = `${item.day}-${parseBreakMinuteOfDay(item.name)}`
      if (!seen.has(key)) { seen.add(key); unique.push(item) } else { dupes.push(item) }
    }
    return [...unique, ...dupes]
  }
  anchorPool = dedupeByTimeFirst(anchorPool)

  const anchorIds = new Set(anchorPool.map(a => a.id))
  const remainingPool = matching.filter(pl => !anchorIds.has(pl.id))

  // Spreads picks across distinct day+time combinations first (the actual
  // intent of "even"/"random" distribution), only reusing an exact time —
  // with a different block — if there aren't enough distinct times to hit
  // the target count.
  function spreadAcrossHours(pool: { id: string; name: string }[], count: number, shuffle: boolean): { id: string; name: string }[] {
    if (count <= 0 || pool.length === 0) return []
    const groups = new Map<string, { id: string; name: string }[]>()
    for (const pl of pool) {
      const day = parseBreakDay(pl.name) ?? 0
      const minuteOfDay = parseBreakMinuteOfDay(pl.name) ?? 0
      const key = `${day}-${minuteOfDay}`
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(pl)
    }
    let groupKeys = Array.from(groups.keys())
    groupKeys = shuffle
      ? groupKeys.sort(() => Math.random() - 0.5)
      : groupKeys.sort((a, b) => {
          const [dayA, minA] = a.split('-').map(Number)
          const [dayB, minB] = b.split('-').map(Number)
          return (dayA - dayB) || (minA - minB)
        })

    const picked: { id: string; name: string }[] = []
    const pickedIds = new Set<string>()

    // Phase 1: one pick per distinct hour, stepped evenly across the list
    // of distinct hours (or shuffled, for random)
    const step = Math.max(1, Math.floor(groupKeys.length / count))
    for (let i = 0; i < count && i * step < groupKeys.length; i++) {
      const candidates = groups.get(groupKeys[i * step])!
      const pick = candidates[0]
      picked.push(pick)
      pickedIds.add(pick.id)
    }

    // Phase 2: not enough distinct hours to reach count — reuse hours,
    // preferring a different block within that hour over an exact repeat
    while (picked.length < count) {
      let added = false
      for (const key of groupKeys) {
        const candidate = groups.get(key)!.find(c => !pickedIds.has(c.id))
        if (candidate) {
          picked.push(candidate)
          pickedIds.add(candidate.id)
          added = true
          if (picked.length >= count) break
        }
      }
      if (!added) break // pool fully exhausted
    }

    return picked
  }

  let selectedSlots: { id: string; name: string; day: number; scheduledFor: string }[] = []

  if (distribution_type === 'per_day') {
    const counts = per_day_counts || {}
    for (const [dayStr, count] of Object.entries(counts)) {
      const dayNum = parseInt(dayStr)
      const target = count as number
      const dayAnchors = anchorPool.filter(a => a.day === dayNum).slice(0, target)
      selectedSlots.push(...dayAnchors)
      const needed = Math.max(0, target - dayAnchors.length)
      const dayRemainingPool = remainingPool.filter(pl => parseBreakDay(pl.name) === dayNum)
      const picked = spreadAcrossHours(dayRemainingPool, needed, false).map(pl => ({ ...pl, day: dayNum, scheduledFor: '' }))
      selectedSlots.push(...picked)
    }
  } else {
    const target = spots_per_week
    const keptAnchors = anchorPool.slice(0, target)
    selectedSlots.push(...keptAnchors)
    const needed = Math.max(0, target - keptAnchors.length)
    const picked = spreadAcrossHours(remainingPool, needed, distribution_type === 'random')
      .map(pl => ({ ...pl, day: parseBreakDay(pl.name) ?? 0, scheduledFor: '' }))
    selectedSlots.push(...picked)
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
    while (d.getUTCDay() !== slot.day) { d.setUTCDate(d.getUTCDate() + 1) }
    const time = parseBreakTime(slot.name)
    const hour = time?.hour ?? 9
    const minute = time?.minute ?? 0
    const scheduledUTC = melbourneWallTimeToUTC(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), hour, minute)
    return { ...slot, scheduledFor: scheduledUTC.toISOString() }
  }).filter(slot => !endDate || new Date(slot.scheduledFor) <= endDate)
    .sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime())

  // For edits, work out what's actually changing vs what's already placed
  // so the preview can show it clearly before anything is touched.
  let diff: { added: string[]; removed: string[]; unchanged: string[]; audioChanged: boolean } | null = null
  if (isEdit && campaign.id) {
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
