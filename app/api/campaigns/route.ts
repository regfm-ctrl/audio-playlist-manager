import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { verifyToken } from '@/lib/auth';
import { ensureCampaignCategoryColumns } from '@/lib/campaign-schema';
import { getValidAccessToken } from '@/lib/google-tokens';
import { removePathFromPlaylist } from '@/lib/playlist-ops';

async function getUser(req: NextRequest) {
  const token = req.cookies.get('token')?.value;
  if (!token) return null;
  return verifyToken(token);
}

// GET — list all campaigns
export async function GET(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await ensureCampaignCategoryColumns();
  const rows = await sql`SELECT * FROM campaigns ORDER BY created_at DESC`;
  return NextResponse.json(rows);
}

// POST — create campaign
export async function POST(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await ensureCampaignCategoryColumns();

  const {
    sponsor_name, business_category, audio_file_id, audio_file_name, audio_directory_name, audio_local_path,
    spots_per_week, distribution_type, per_day_counts,
    allowed_days, time_from, time_to, allowed_breaks,
    position, start_date, end_date, booking_reference, booking_details,
  } = await req.json();

  const rows = await sql`
    INSERT INTO campaigns (
      sponsor_name, business_category, audio_file_id, audio_file_name, audio_directory_name, audio_local_path,
      spots_per_week, distribution_type, per_day_counts,
      allowed_days, time_from, time_to, allowed_breaks,
      position, start_date, end_date, created_by, booking_reference, booking_details
    ) VALUES (
      ${sponsor_name}, ${business_category || null}, ${audio_file_id}, ${audio_file_name}, ${audio_directory_name}, ${audio_local_path},
      ${spots_per_week}, ${distribution_type}, ${per_day_counts ? JSON.stringify(per_day_counts) : null},
      ${allowed_days ?? null}, ${time_from ?? null}, ${time_to ?? null}, ${allowed_breaks ?? null},
      ${position ?? -1}, ${start_date}, ${end_date ?? null}, ${user.username}, ${booking_reference || null}, ${booking_details || null}
    ) RETURNING *
  `;
  return NextResponse.json(rows[0]);
}

// PATCH — update status, or full campaign details (edit)
export async function PATCH(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await ensureCampaignCategoryColumns();

  const body = await req.json();
  const { id, status } = body;

  // Status-only update (pause/resume) — existing behaviour
  if (status !== undefined && Object.keys(body).length === 2) {
    await sql`UPDATE campaigns SET status = ${status} WHERE id = ${id}`;
    return NextResponse.json({ ok: true });
  }

  // Full edit — update every editable field
  const {
    sponsor_name, business_category, audio_file_id, audio_file_name, audio_directory_name, audio_local_path,
    spots_per_week, distribution_type, per_day_counts,
    allowed_days, time_from, time_to, allowed_breaks,
    position, start_date, end_date, booking_reference, booking_details,
  } = body;

  const rows = await sql`
    UPDATE campaigns SET
      sponsor_name = ${sponsor_name},
      business_category = ${business_category || null},
      audio_file_id = ${audio_file_id},
      audio_file_name = ${audio_file_name},
      audio_directory_name = ${audio_directory_name ?? ''},
      audio_local_path = ${audio_local_path},
      spots_per_week = ${spots_per_week},
      distribution_type = ${distribution_type},
      per_day_counts = ${per_day_counts ? JSON.stringify(per_day_counts) : null},
      allowed_days = ${allowed_days ?? null},
      time_from = ${time_from ?? null},
      time_to = ${time_to ?? null},
      allowed_breaks = ${allowed_breaks ?? null},
      position = ${position ?? -1},
      start_date = ${start_date},
      end_date = ${end_date ?? null},
      booking_reference = ${booking_reference || null},
      booking_details = ${booking_details || null}
    WHERE id = ${id}
    RETURNING *
  `;
  return NextResponse.json(rows[0] ?? { ok: true });
}

// DELETE — remove campaign, optionally also removing its schedules and
// actually stripping the sponsor's audio out of every playlist it's in
// (not just deleting the database rows)
export async function DELETE(req: NextRequest) {
  const user = await getUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id, withSchedules = false, accessToken: providedToken } = await req.json();

  if (withSchedules) {
    const campaignRows = await sql`SELECT * FROM campaigns WHERE id = ${id}`;
    const campaign = campaignRows[0];

    if (campaign) {
      // Match by campaign_id (reliable) and fall back to audio_file_name
      // for any legacy schedule rows created before that link existed.
      const schedulesToClean = await sql`
        SELECT * FROM schedules
        WHERE campaign_id = ${id}
           OR (campaign_id IS NULL AND audio_file_name = ${campaign.audio_file_name})
      `;

      if (schedulesToClean.length > 0) {
        const accessToken = providedToken || await getValidAccessToken();
        for (const sched of schedulesToClean) {
          try {
            if (accessToken) {
              await removePathFromPlaylist(sched.playlist_id, sched.audio_local_path, accessToken);
            }
            await sql`DELETE FROM schedules WHERE id = ${sched.id}`;
          } catch (err) {
            console.error('[campaigns] Failed to clean up schedule during delete:', sched.playlist_name, err);
          }
        }
      }
    }
  }

  await sql`DELETE FROM campaigns WHERE id = ${id}`;
  return NextResponse.json({ ok: true });
}
