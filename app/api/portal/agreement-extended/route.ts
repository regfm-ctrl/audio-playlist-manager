import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { sql } from '@/lib/db';
import { ensureCampaignCategoryColumns } from '@/lib/campaign-schema';
import { applyExtension } from '@/lib/agreement-extension';
import { logActivity } from '@/lib/activity';

// Called server-to-server by the Approval Portal when a signed agreement is
// extended to a later finish date. Moves the end date of the campaign that
// agreement made (or extended, for a renewal) — the campaign itself, its
// placements' expiry and any audio file expiry that matched the old end.
//
// Safe to repeat: if the campaign already ends on that date nothing changes.
// It only ever moves an end date LATER; shortening is refused.
//
// Auth: Authorization: Bearer <PORTAL_API_SECRET>, same as agreement-signed.

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

  const agreementId = typeof body?.agreement_id === 'string' || typeof body?.agreement_id === 'number' ? String(body.agreement_id).trim() : '';
  const agreementNumber = typeof body?.agreement_number === 'string' ? body.agreement_number.trim().slice(0, 100) || null : null;
  const newEnd = typeof body?.new_end_date === 'string' ? body.new_end_date.trim() : '';
  const errors: string[] = [];
  if (!agreementId) errors.push('agreement_id is required');
  if (!isRealDate(newEnd)) errors.push('new_end_date must be a real date in YYYY-MM-DD format');
  if (errors.length > 0) return NextResponse.json({ error: 'Invalid data', details: errors }, { status: 400 });

  try {
    await ensureCampaignCategoryColumns();
    await sql`
      CREATE TABLE IF NOT EXISTS portal_agreement_extensions (
        agreement_id TEXT PRIMARY KEY,
        campaign_id INTEGER NOT NULL,
        old_end_date TEXT,
        new_end_date TEXT NOT NULL,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    // The campaign this agreement made, or the one it extended as a renewal.
    let found = await sql`SELECT id, sponsor_name, status, end_date FROM campaigns WHERE agreement_id = ${agreementId}`;
    if (found.length === 0) {
      found = await sql`
        SELECT c.id, c.sponsor_name, c.status, c.end_date
        FROM portal_agreement_extensions e JOIN campaigns c ON c.id = e.campaign_id
        WHERE e.agreement_id = ${agreementId}
      `;
    }
    if (found.length === 0) {
      return NextResponse.json({ error: 'No campaign in the Traffic System came from this agreement. Change the campaign date there by hand.' }, { status: 404 });
    }
    const c: any = found[0];

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

    const r = await applyExtension(sql as any, c.id, newEnd, `agreement ${agreementNumber ?? agreementId}`);
    await logActivity(0, 'Approval Portal', 'CAMPAIGN_EXTENDED_FROM_AGREEMENT', '/api/portal/agreement-extended',
      `"${c.sponsor_name}" — agreement ${agreementNumber ?? agreementId} extended: end date ${r.oldEnd ?? 'ongoing'} → ${r.newEnd}; ` +
      `${r.placements} placement(s) moved` + (r.filesMoved ? `, ${r.filesMoved} audio file expiry moved` : '') +
      (r.filesLeft ? `, ${r.filesLeft} audio file(s) have their own expiry, unchanged — CHECK` : ''));

    return NextResponse.json({
      ok: true, unchanged: false, campaign_id: c.id, status: c.status,
      previous_end_date: r.oldEnd, new_end_date: r.newEnd, placements_moved: r.placements, audio_files_with_own_expiry: r.filesLeft,
    });
  } catch (err: any) {
    console.error('[agreement-extended] Failed:', err);
    return NextResponse.json({ error: `Could not extend the campaign: ${err.message ?? String(err)}` }, { status: 500 });
  }
}
