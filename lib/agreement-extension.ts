// Renewals: when a client who already has ONE running campaign signs a new agreement for the same
// number of spots per week and a later end date, the Traffic System moves that campaign's end date
// instead of making a second campaign beside it. Anything else (no running campaign, more than one
// campaign, a different number of spots, an ongoing campaign, or an end date that is not later)
// falls back to the normal behaviour: a new pending campaign that someone sets up by hand.
//
// The decision is a pure function so it can be tested without a database. applyExtension() does the
// work, and is the single place that keeps the campaign, its placements and its per-file expiry dates
// in step. Moving campaigns.end_date alone would NOT be enough: what actually removes audio from the
// playlists is each placement's expires_at, so those are moved too.

import { melbourneWallTimeToUTC } from '@/lib/break-time';

export type ClientCampaign = {
  id: number;
  status: string;
  spots_per_week: number;
  end_date: string | null;
  sponsor_name?: string;
};

export type ExtensionDecision =
  | { extend: true; campaign: ClientCampaign }
  | { extend: false; reason: string };

export function decideExtension(
  campaigns: ClientCampaign[],
  agreement: { spotsPerWeek: number; endDate: string | null },
): ExtensionDecision {
  const live = campaigns.filter((c) => ['active', 'pending', 'paused'].includes(c.status));
  if (live.length === 0) return { extend: false, reason: 'the client has no running campaign' };
  if (live.length > 1) return { extend: false, reason: `the client has ${live.length} campaigns, so it is not clear which to extend` };
  const c = live[0];
  if (c.status !== 'active') return { extend: false, reason: `the client's campaign is ${c.status}, not running` };
  if (!agreement.endDate) return { extend: false, reason: 'the new agreement has no end date' };
  if (!c.end_date) return { extend: false, reason: 'the running campaign is already ongoing' };
  if (agreement.endDate <= c.end_date) return { extend: false, reason: `the new end date (${agreement.endDate}) is not later than the campaign's (${c.end_date})` };
  if (Number(c.spots_per_week) !== agreement.spotsPerWeek) {
    return { extend: false, reason: `spots per week differ (campaign ${c.spots_per_week}, agreement ${agreement.spotsPerWeek})` };
  }
  return { extend: true, campaign: c };
}

/** The moment a campaign with this end date and expiry time stops airing, as a UTC ISO string. */
export function endInstant(endDate: string, expiryTime: string | null | undefined): string {
  const [y, m, d] = endDate.split('-').map(Number);
  const [eh, em] = (expiryTime || '22:00').split(':').map(Number);
  return melbourneWallTimeToUTC(y, m, d, eh, em || 0).toISOString();
}

type Sql = (strings: TemplateStringsArray, ...values: any[]) => Promise<any[]>;

/**
 * Moves one campaign to a later end date. Returns what was changed.
 *  - campaigns.end_date, and the renewal reminders start again for the new date
 *  - every active placement's expires_at moves to the new end moment
 *  - an audio file whose own expiry was the campaign's old end moves with it; files with a different,
 *    earlier expiry of their own are left alone and counted so the log can say so
 */
export async function applyExtension(
  sql: Sql,
  campaignId: number,
  newEndDate: string,
  by: string | null, // who or what asked, e.g. 'agreement SA-0042' or 'the Approval Portal'
): Promise<{ oldEnd: string | null; newEnd: string; placements: number; filesMoved: number; filesLeft: number }> {
  const rows = await sql`SELECT id, end_date, expiry_time, audio_files, booking_details FROM campaigns WHERE id = ${campaignId}`;
  const c: any = rows[0];
  if (!c) throw new Error('Campaign not found');

  const oldEnd: string | null = c.end_date ?? null;
  const oldInstant = c.end_date ? endInstant(c.end_date, c.expiry_time) : null;
  const newInstant = endInstant(newEndDate, c.expiry_time);

  let files: any[] = [];
  try {
    files = Array.isArray(c.audio_files) ? c.audio_files : JSON.parse(c.audio_files || '[]');
  } catch {
    files = [];
  }
  let filesMoved = 0;
  let filesLeft = 0;
  const newFiles = files.map((f) => {
    if (!f || typeof f.expiresAt !== 'string' || !f.expiresAt) return f;
    if (oldInstant && new Date(f.expiresAt).getTime() === new Date(oldInstant).getTime()) {
      filesMoved++;
      return { ...f, expiresAt: newInstant };
    }
    filesLeft++;
    return f;
  });

  const note = `Extended to ${newEndDate}${by ? ` by ${by}` : ''}`;
  const details = c.booking_details ? `${c.booking_details} | ${note}` : note;

  await sql`
    UPDATE campaigns SET
      end_date = ${newEndDate},
      reminders_sent = ${'[]'}::jsonb,
      audio_files = ${JSON.stringify(newFiles)}::jsonb,
      booking_details = ${details}
    WHERE id = ${campaignId}
  `;
  const moved = await sql`
    UPDATE schedules SET expires_at = ${newInstant}
    WHERE campaign_id = ${campaignId} AND is_active = true
    RETURNING id
  `;

  return { oldEnd, newEnd: newEndDate, placements: moved.length, filesMoved, filesLeft };
}
