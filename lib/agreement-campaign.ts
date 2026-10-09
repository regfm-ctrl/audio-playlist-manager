// Validation for the "agreement signed" payload the Approval Portal sends
// to /api/portal/agreement-signed. Kept as a pure function (no database, no
// request objects) so it can be tested on its own and the route stays thin.
// See AGREEMENT_WEBHOOK_CONTRACT.md for the shape the Portal side sends.

export type AgreementPayload = {
  agreementId: string;
  agreementNumber: string | null;
  clientId: string;
  clientName: string;
  clientUrl: string | null;
  spotsPerWeek: number;
  startDate: string; // YYYY-MM-DD
  endDate: string | null; // YYYY-MM-DD, or null = ongoing
  notes: string | null;
};

export type ValidationResult =
  | { ok: true; value: AgreementPayload }
  | { ok: false; errors: string[] };

function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function textOrNull(v: unknown, max: number, field: string, errors: string[]): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' && typeof v !== 'number') {
    errors.push(`${field} must be text`);
    return null;
  }
  const s = String(v).trim();
  if (s.length > max) {
    errors.push(`${field} is too long (max ${max} characters)`);
    return null;
  }
  return s || null;
}

export function validateAgreementPayload(body: any): ValidationResult {
  const errors: string[] = [];
  if (!body || typeof body !== 'object') return { ok: false, errors: ['Request body must be a JSON object'] };

  const agreementId = textOrNull(body.agreement_id, 100, 'agreement_id', errors);
  if (!agreementId) errors.push('agreement_id is required');

  const clientId = textOrNull(body.client_id, 100, 'client_id', errors);
  if (!clientId) errors.push('client_id is required');

  const clientName = textOrNull(body.client_name, 200, 'client_name', errors);
  if (!clientName) errors.push('client_name is required');

  const agreementNumber = textOrNull(body.agreement_number, 100, 'agreement_number', errors);
  const notes = textOrNull(body.notes, 1000, 'notes', errors);

  const clientUrl = textOrNull(body.client_url, 500, 'client_url', errors);
  if (clientUrl && !/^https?:\/\//i.test(clientUrl)) errors.push('client_url must start with http:// or https://');

  const spots = typeof body.spots_per_week === 'string' && body.spots_per_week.trim() !== ''
    ? Number(body.spots_per_week)
    : body.spots_per_week;
  if (typeof spots !== 'number' || !Number.isInteger(spots) || spots < 1 || spots > 200) {
    errors.push('spots_per_week must be a whole number between 1 and 200');
  }

  const startDate = typeof body.start_date === 'string' ? body.start_date.trim() : '';
  if (!isRealDate(startDate)) errors.push('start_date must be a real date in YYYY-MM-DD format');

  let endDate: string | null = null;
  if (body.end_date !== undefined && body.end_date !== null && body.end_date !== '') {
    const e = typeof body.end_date === 'string' ? body.end_date.trim() : '';
    if (!isRealDate(e)) errors.push('end_date must be a real date in YYYY-MM-DD format (or null for ongoing)');
    else if (isRealDate(startDate) && e < startDate) errors.push('end_date cannot be before start_date');
    else endDate = e;
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      agreementId: agreementId!,
      agreementNumber,
      clientId: clientId!,
      clientName: clientName!,
      clientUrl,
      spotsPerWeek: spots as number,
      startDate,
      endDate,
      notes,
    },
  };
}
