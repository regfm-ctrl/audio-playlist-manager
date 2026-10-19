import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { sql } from '@/lib/db';
import { ensureCampaignCategoryColumns } from '@/lib/campaign-schema';
import { applyExtension } from '@/lib/agreement-extension';
import { logActivity } from '@/lib/activity';

// Called server-to-server by the Approval Portal when someone moves a campaign's
// end date later from the client's page. Same effect as an agreement being
// extended: the campaign, its active placements' expiry and any audio file expiry
// that matched the old end all move together.
//
// The campaign must belong to the stated Portal client. Extending only: an earlier
// date is refused, an expired campaign is refused, the same date changes nothing.
//
// Auth: Authorization: Bearer <PORTAL_API_SECRET>.

function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
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

  const campaignId = Number(body?.campaign_id);
  const clientId = body?.client_id !== undefined && body?.client_id !== null ? String(body.client_id).trim() : '';
  const newEnd = typeof body?.new_end_date === 'string' ? body.new_end_date.trim() : '';
  const who = typeof body?.requested_by === 'string' ? body.requested_by.trim().slice(0, 100) : '';
  const errors: string[] = [];
  if (!Number.isInteger(campaignId) || campaignId < 1) errors.push('campaign_id is required');
  if (!clientId) errors.push('client_id is required');
  if (!isRealDate(newEnd)) errors.push('new_end_date must be a real date in YYYY-MM-DD format');
  if (errors.length > 0) return NextResponse.json({ error: 'Invalid data', details: errors }, { status: 400 });

  try {
    await ensureCampaignCategoryColumns();
    const found = await sql`SELECT id, sponsor_name, status, end_date, portal_client_id FROM campaigns WHERE id = ${campaignId}`;
    const c: any = found[0];
    if (!c || String(c.portal_client_id ?? '') !== clientId) {
      return NextResponse.json({ error: 'That campaign was not found for this client.' }, { status: 404 });
    }
    if (c.status === 'expired') {
      return NextResponse.json({
        error: `The campaign "${c.sponsor_name}" has already expired (its audio is out of the playlists). Make a new campaign for the extra period instead.`,
      }, { status: 409 });
    }
    if (!c.end_date) {
      return NextResponse.json({ ok: true, unchanged: true, campaign_id: c.id, status: c.status, new_end_date: null, note: 'The campaign is ongoing already.' });
    }
    if (newEnd === c.end_date) {
      return NextResponse.json({ ok: true, unchanged: true, campaign_id: c.id, status: c.status, new_end_date: c.end_date });
    }
    if (newEnd < c.end_date) {
      return NextResponse.json({ error: `The campaign already runs to ${c.end_date}, which is later than ${newEnd}. Only extending is supported.` }, { status: 409 });
    }

    const r = await applyExtension(sql as any, c.id, newEnd, who ? `${who} in the Approval Portal` : 'the Approval Portal');
    await logActivity(0, 'Approval Portal', 'CAMPAIGN_EXTENDED_FROM_PORTAL', '/api/portal/campaign-extended',
      `"${c.sponsor_name}" — end date ${r.oldEnd ?? 'ongoing'} → ${r.newEnd}${who ? ` (asked by ${who})` : ''}; ` +
      `${r.placements} placement(s) moved` + (r.filesMoved ? `, ${r.filesMoved} audio file expiry moved` : '') +
      (r.filesLeft ? `, ${r.filesLeft} audio file(s) have their own expiry, unchanged — CHECK` : ''));

    return NextResponse.json({
      ok: true, unchanged: false, campaign_id: c.id, status: c.status,
      previous_end_date: r.oldEnd, new_end_date: r.newEnd, placements_moved: r.placements, audio_files_with_own_expiry: r.filesLeft,
    });
  } catch (err: any) {
    console.error('[campaign-extended] Failed:', err);
    return NextResponse.json({ error: `Could not extend the campaign: ${err.message ?? String(err)}` }, { status: 500 });
  }
}
