import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { sql } from '@/lib/db';
import { ensureCampaignCategoryColumns } from '@/lib/campaign-schema';

// Read-only. Called server-to-server by the Approval Portal to show each
// linked client's campaigns and their dates. Returns only campaigns that are
// linked to a Portal client. Optional ?client_id= narrows it to one client.
//
// Auth: Authorization: Bearer <PORTAL_API_SECRET>, same as the other Portal routes.

function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  const secret = process.env.PORTAL_API_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'Portal integration not configured (PORTAL_API_SECRET missing)' }, { status: 503 });
  }
  const header = req.headers.get('authorization') || '';
  const provided = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!provided || !secretMatches(provided, secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await ensureCampaignCategoryColumns();
    const clientId = (new URL(req.url).searchParams.get('client_id') || '').trim();
    const rows = clientId
      ? await sql`
          SELECT id, sponsor_name, status, start_date, end_date, portal_client_id, agreement_id, booking_reference
          FROM campaigns WHERE portal_client_id = ${clientId} ORDER BY end_date NULLS LAST, id`
      : await sql`
          SELECT id, sponsor_name, status, start_date, end_date, portal_client_id, agreement_id, booking_reference
          FROM campaigns WHERE portal_client_id IS NOT NULL AND portal_client_id <> '' ORDER BY portal_client_id, end_date NULLS LAST, id`;

    return NextResponse.json({
      ok: true,
      campaigns: (rows as any[]).map((r) => ({
        id: r.id,
        client_id: String(r.portal_client_id),
        name: r.sponsor_name,
        status: r.status,
        start_date: r.start_date ?? null,
        end_date: r.end_date ?? null,
        agreement_id: r.agreement_id ?? null,
        booking_reference: r.booking_reference ?? null,
      })),
    });
  } catch (err: any) {
    console.error('[portal/campaigns] Failed:', err);
    return NextResponse.json({ error: `Could not read campaigns: ${err.message ?? String(err)}` }, { status: 500 });
  }
}
