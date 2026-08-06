import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { verifyToken } from '@/lib/auth';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { parseBreakDay, parseBreakTime } from '@/lib/break-time';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function formatTime(hour: number, minute: number): string {
  const period = hour >= 12 ? 'pm' : 'am';
  let displayHour = hour % 12;
  if (displayHour === 0) displayHour = 12;
  return `${displayHour}:${String(minute).padStart(2, '0')}${period}`;
}

function formatDMY(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yy = String(date.getFullYear()).slice(-2);
  return `${dd}.${mm}.${yy}`;
}

function formatTimestamp(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  let h = date.getHours();
  const period = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  const min = String(date.getMinutes()).padStart(2, '0');
  const sec = String(date.getSeconds()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${h}:${min}:${sec} ${period}`;
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const token = req.cookies.get('token')?.value;
  const user = token ? await verifyToken(token) : null;
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const campaignId = parseInt(params.id);
  const campaignRows = await sql`SELECT * FROM campaigns WHERE id = ${campaignId}`;
  const campaign = campaignRows[0];
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });

  const schedules = await sql`
    SELECT playlist_name FROM schedules WHERE campaign_id = ${campaignId} AND is_active = true
  `;

  // Group the real broadcast time (parsed from each break's filename, not
  // the DB's hour-rounded time_of_day) by day of week
  const byDay: Record<number, { hour: number; minute: number }[]> = {};
  for (const s of schedules as any[]) {
    const day = parseBreakDay(s.playlist_name);
    const t = parseBreakTime(s.playlist_name);
    const hour = t?.hour ?? null;
    const minute = t?.minute ?? 0;
    if (day === null || hour === null) continue;
    if (!byDay[day]) byDay[day] = [];
    byDay[day].push({ hour, minute });
  }
  for (const day of Object.keys(byDay)) {
    byDay[Number(day)].sort((a, b) => (a.hour - b.hour) || (a.minute - b.minute));
  }

  // ── Build the PDF ──────────────────────────────────────────────────────
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // A4
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const marginX = 50;
  const pageWidth = 595.28;
  const black = rgb(0.1, 0.1, 0.1);
  const gray = rgb(0.45, 0.45, 0.45);

  let y = 800;
  const now = new Date();

  const timestamp = formatTimestamp(now);
  const tsWidth = font.widthOfTextAtSize(timestamp, 9);
  page.drawText(timestamp, { x: pageWidth - marginX - tsWidth, y, size: 9, font, color: gray });
  y -= 26;

  page.drawText('Radio East Gippsland Inc', { x: marginX, y, size: 16, font: fontBold, color: black });
  y -= 20;
  page.drawText('Broadcast Schedule', { x: marginX, y, size: 13, font: fontBold, color: black });
  y -= 17;
  page.drawText('Play of Station', { x: marginX, y, size: 11, font, color: black });
  y -= 28;

  const detailLine = (label: string, value: string) => {
    page.drawText(`${label}: ${value}`, { x: marginX, y, size: 11, font, color: black });
    y -= 18;
  };

  detailLine('Client', campaign.sponsor_name);
  if (campaign.booking_reference) detailLine('Booking Reference', campaign.booking_reference);
  detailLine('Booking Details', campaign.booking_details || `${campaign.spots_per_week} spots per week`);
  detailLine('Date Prepared', formatDMY(now));
  detailLine('Broadcast Start', formatDMY(new Date(campaign.start_date)));
  if (campaign.end_date) detailLine('Broadcast End', formatDMY(new Date(campaign.end_date)));

  y -= 12;
  page.drawText('Play of Station Spots', { x: marginX, y, size: 12, font: fontBold, color: black });
  y -= 22;

  const dayColX = marginX;
  const timesColX = marginX + 110;
  const timesColWidth = pageWidth - marginX - timesColX;

  page.drawText('Day', { x: dayColX, y, size: 10, font: fontBold, color: black });
  page.drawText('Broadcast Times (Approximate Only)', { x: timesColX, y, size: 10, font: fontBold, color: black });
  y -= 6;
  page.drawLine({ start: { x: marginX, y }, end: { x: pageWidth - marginX, y }, thickness: 0.75, color: gray });
  y -= 16;

  for (let day = 0; day <= 6; day++) {
    const times = byDay[day];
    if (!times || times.length === 0) continue;

    const timeStrings = times.map(t => formatTime(t.hour, t.minute));

    // Wrap onto multiple lines if the list of times is too wide for the column
    const lines: string[] = [];
    let current = '';
    for (const t of timeStrings) {
      const candidate = current ? `${current}, ${t}` : t;
      if (font.widthOfTextAtSize(candidate, 10) > timesColWidth && current) {
        lines.push(current);
        current = t;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);

    page.drawText(DAY_NAMES[day], { x: dayColX, y, size: 10, font, color: black });
    for (const line of lines) {
      page.drawText(line, { x: timesColX, y, size: 10, font, color: black });
      y -= 15;
    }
    y -= 3;

    if (y < 60) break; // simple safety margin, sponsors' weekly spot counts are small
  }

  const pdfBytes = await pdfDoc.save();
  const safeName = (campaign.sponsor_name as string).replace(/[^a-z0-9]+/gi, '_');

  return new NextResponse(Buffer.from(pdfBytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="Schedule_${safeName}.pdf"`,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}
