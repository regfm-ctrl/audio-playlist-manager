import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { sql } from '@/lib/db';
import { ensureCampaignCategoryColumns } from '@/lib/campaign-schema';
import { validateAgreementPayload } from '@/lib/agreement-campaign';
import { logActivity } from '@/lib/activity';

// Called server-to-server by the Approval Portal when a client signs a
// Sponsorship Agreement. Creates a campaign in the 'pending' state: it has
// the client, dates and spots-per-week from the agreement, but NO audio
// and NO placements, so nothing can air until someone opens it in
// Campaigns, picks the audio and days/times, and presses Confirm (which
// flips it to 'active' through the normal edit flow).
//
// Safe to retry: agreement_id has a unique index, so re-sending the same
// agreement returns the existing campaign instead of making a second one.
//
// Auth: Authorization: Bearer <PORTAL_API_SECRET> — the same shared secret
// the Scheduler already uses when it calls the Portal. This path is public
// in middleware.ts (no browser cookie), so this check is the only gate.

function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const secret = process.env.PORTAL_API_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'Portal integration not configured (PORTAL_API_SECRET missing)' }, { status: 503 });
  }

  const header = req.headers.get('authorization') || '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!provided || !secretMatches(provided, secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON' }, { status: 400 });
  }

  const result = validateAgreementPayload(body);
  if (!result.ok) {
    return NextResponse.json({ error: 'Invalid agreement data', details: result.errors }, { status: 400 });
  }
  const a = result.value;

  try {
    await ensureCampaignCategoryColumns();

    const bookingDetails = `${a.spotsPerWeek} spots per week${a.notes ? ` — ${a.notes}` : ''}`;

    // ON CONFLICT on the unique agreement_id index makes this atomic: two
    // simultaneous deliveries of the same agreement can't both insert.
    const inserted = await sql`
      INSERT INTO campaigns (
        sponsor_name, business_category, audio_file_id, audio_file_name, audio_directory_name, audio_local_path, audio_files,
        spots_per_week, distribution_type, per_day_counts,
        allowed_days, time_from, time_to, allowed_breaks,
        position, position_type, start_date, end_date, created_by, booking_reference, booking_details, randomize_weekly,
        go_live_time, expiry_time, exclude_from_renewal_reminders,
        portal_client_id, portal_client_name, portal_client_url, agreement_id, status
      ) VALUES (
        ${a.clientName}, ${null}, ${''}, ${''}, ${''}, ${''}, ${'[]'},
        ${a.spotsPerWeek}, ${'even'}, ${null},
        ${null}, ${null}, ${null}, ${null},
        ${-1}, ${'middle'}, ${a.startDate}, ${a.endDate}, ${'Approval Portal'}, ${a.agreementNumber}, ${bookingDetails}, ${false},
        ${'06:00'}, ${'22:00'}, ${false},
        ${a.clientId}, ${a.clientName}, ${a.clientUrl}, ${a.agreementId}, ${'pending'}
      )
      ON CONFLICT (agreement_id) DO NOTHING
      RETURNING id
    `;

    if (inserted.length === 0) {
      const existing = await sql`SELECT id, status FROM campaigns WHERE agreement_id = ${a.agreementId}`;
      return NextResponse.json({
        ok: true,
        duplicate: true,
        campaign_id: existing[0]?.id ?? null,
        status: existing[0]?.status ?? null,
      });
    }

    // Useful context for the renewal case: the same client may already have
    // a running campaign, and this new one would sit alongside it.
    const others = await sql`
      SELECT COUNT(*)::int AS n FROM campaigns
      WHERE portal_client_id = ${a.clientId} AND id <> ${inserted[0].id}
    `;
    const otherCount = others[0]?.n ?? 0;

    await logActivity(0, 'Approval Portal', 'CAMPAIGN_CREATED_FROM_AGREEMENT', '/api/portal/agreement-signed',
      `"${a.clientName}" — agreement ${a.agreementNumber ?? a.agreementId}: ${a.spotsPerWeek} spots/week, ${a.startDate} → ${a.endDate ?? 'ongoing'}` +
      (otherCount > 0 ? ` (client already has ${otherCount} other campaign(s))` : ''));

    return NextResponse.json({
      ok: true,
      duplicate: false,
      campaign_id: inserted[0].id,
      status: 'pending',
      other_campaigns_for_client: otherCount,
    });
  } catch (err: any) {
    console.error('[agreement-signed] Failed to create campaign:', err);
    return NextResponse.json({ error: `Could not create the campaign: ${err.message ?? String(err)}` }, { status: 500 });
  }
}
