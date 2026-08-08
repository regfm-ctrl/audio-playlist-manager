import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { PDFDocument, StandardFonts, rgb, PDFFont, PDFPage } from 'pdf-lib';
import { getWeeklyOverview, DAY_NAMES, type WeeklyOverview } from '@/lib/schedule-overview';

function formatTimestamp(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  let h = date.getHours();
  const period = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${h}:${min} ${period}`;
}

const PAGE_WIDTH = 841.89; // A4 landscape
const PAGE_HEIGHT = 595.28;
const MARGIN_X = 30;
const MARGIN_BOTTOM = 24;
const COLUMN_GAP = 22;
const COLUMNS_PER_PAGE = 2;
const FONT_SIZE = 9;
const LINE_HEIGHT = FONT_SIZE * 1.65;

function wrapLines(font: PDFFont, text: string, fontSize: number, maxWidth: number): string[] {
  const words = text.split(' ');
  let line = '';
  const lines: string[] = [];
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, fontSize) > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function formatTimestampHeader(page: PDFPage, font: PDFFont, fontBold: PDFFont): number {
  const black = rgb(0.1, 0.1, 0.1);
  const gray = rgb(0.45, 0.45, 0.45);
  let y = PAGE_HEIGHT - 30;
  const now = new Date();
  const timestamp = formatTimestamp(now);
  const tsWidth = font.widthOfTextAtSize(timestamp, 9);
  page.drawText(timestamp, { x: PAGE_WIDTH - MARGIN_X - tsWidth, y, size: 9, font, color: gray });

  page.drawText('Radio East Gippsland - REGFM', { x: MARGIN_X, y, size: 15, font: fontBold, color: black });
  y -= 18;
  page.drawText('Weekly Sponsorship Schedule — All Campaigns', { x: MARGIN_X, y, size: 11, font, color: gray });
  y -= 24;
  return y;
}

export async function GET(req: NextRequest) {
  const token = req.cookies.get('token')?.value;
  const user = token ? await verifyToken(token) : null;
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const overview: WeeklyOverview = await getWeeklyOverview();

  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const black = rgb(0.1, 0.1, 0.1);
  const bandColor = rgb(0.96, 0.96, 0.97);
  const sponsorColor = rgb(0.2, 0.2, 0.2);

  const columnWidth = (PAGE_WIDTH - MARGIN_X * 2 - COLUMN_GAP * (COLUMNS_PER_PAGE - 1)) / COLUMNS_PER_PAGE;
  const timeColWidth = font.widthOfTextAtSize('12:45pm', FONT_SIZE + 0.5) + 8;

  let page!: PDFPage;
  let headerBottom = 0;
  let colIndex = 0;
  let colX = 0;
  let colY = 0;

  function newPage() {
    page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    headerBottom = formatTimestampHeader(page, font, fontBold);
    colIndex = 0;
    colX = MARGIN_X;
    colY = headerBottom;
  }

  function nextColumn() {
    colIndex++;
    if (colIndex >= COLUMNS_PER_PAGE) {
      newPage();
    } else {
      colX = MARGIN_X + colIndex * (columnWidth + COLUMN_GAP);
      colY = headerBottom;
    }
  }

  function drawDayHeading(dayName: string, continued: boolean) {
    page.drawText(continued ? `${dayName} (cont.)` : dayName, { x: colX, y: colY, size: 12, font: fontBold, color: black });
    colY -= 5;
    page.drawLine({ start: { x: colX, y: colY }, end: { x: colX + columnWidth, y: colY }, thickness: 0.75, color: black });
    colY -= 15;
  }

  newPage();

  for (let day = 0; day <= 6; day++) {
    const slots = overview[day] || [];

    // Don't start a new day heading right at the very bottom of a column
    // with no room for at least one entry under it
    if (colY - 15 - LINE_HEIGHT < MARGIN_BOTTOM) nextColumn();

    drawDayHeading(DAY_NAMES[day], false);

    if (slots.length === 0) {
      page.drawText('Nothing scheduled', { x: colX, y: colY, size: FONT_SIZE, font, color: rgb(0.55, 0.55, 0.55) });
      colY -= LINE_HEIGHT * 1.4;
      continue;
    }

    let rowIndex = 0;
    for (const slot of slots) {
      const sponsorLines = wrapLines(font, slot.sponsors.join(', '), FONT_SIZE, columnWidth - timeColWidth - 4);
      const rowHeight = Math.max(1, sponsorLines.length) * LINE_HEIGHT;

      if (colY - rowHeight < MARGIN_BOTTOM) {
        nextColumn();
        drawDayHeading(DAY_NAMES[day], true);
        rowIndex = 0;
      }

      // Text is drawn from its baseline, not its top — so the shaded band
      // needs to account for how far glyphs actually extend above (ascent)
      // and below (descent) that baseline, tightly hugging the real text
      // instead of the arbitrary row-height box.
      const ASCENT = FONT_SIZE * 0.75;
      const DESCENT = FONT_SIZE * 0.25;
      const BAND_PAD = 2;
      if (rowIndex % 2 === 1) {
        const rectTop = colY + ASCENT + BAND_PAD;
        const rectBottom = colY - (sponsorLines.length - 1) * LINE_HEIGHT - DESCENT - BAND_PAD;
        page.drawRectangle({
          x: colX - 3, y: rectBottom, width: columnWidth + 6, height: rectTop - rectBottom,
          color: bandColor,
        });
      }

      page.drawText(slot.time, { x: colX, y: colY, size: FONT_SIZE, font: fontBold, color: black });
      for (let i = 0; i < sponsorLines.length; i++) {
        page.drawText(sponsorLines[i], { x: colX + timeColWidth, y: colY - i * LINE_HEIGHT, size: FONT_SIZE, font, color: sponsorColor });
      }
      colY -= rowHeight;
      rowIndex++;
    }

    colY -= LINE_HEIGHT * 0.5; // breathing room before the next day's heading
  }

  const pdfBytes = await pdfDoc.save();
  return new NextResponse(Buffer.from(pdfBytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="Weekly_Sponsorship_Schedule.pdf"`,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}
