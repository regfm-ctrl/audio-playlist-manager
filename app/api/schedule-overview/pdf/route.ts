import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { getWeeklyOverview, DAY_NAMES } from '@/lib/schedule-overview';

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

export async function GET(req: NextRequest) {
  const token = req.cookies.get('token')?.value;
  const user = token ? await verifyToken(token) : null;
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const overview = await getWeeklyOverview();

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([841.89, 595.28]); // A4 landscape
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const pageWidth = 841.89;
  const pageHeight = 595.28;
  const marginX = 30;
  const black = rgb(0.1, 0.1, 0.1);
  const gray = rgb(0.45, 0.45, 0.45);
  const lightGray = rgb(0.75, 0.75, 0.75);

  let y = pageHeight - 30;
  const now = new Date();
  const timestamp = formatTimestamp(now);
  const tsWidth = font.widthOfTextAtSize(timestamp, 9);
  page.drawText(timestamp, { x: pageWidth - marginX - tsWidth, y, size: 9, font, color: gray });

  page.drawText('Radio East Gippsland Inc', { x: marginX, y, size: 15, font: fontBold, color: black });
  y -= 18;
  page.drawText('Weekly Sponsorship Schedule — All Campaigns', { x: marginX, y, size: 11, font, color: gray });
  y -= 20;

  const headerBottom = y;
  const columnGap = 8;
  const columnWidth = (pageWidth - marginX * 2 - columnGap * 6) / 7;
  const bottomMargin = 20;
  const availableHeight = headerBottom - bottomMargin - 20; // minus day heading space

  // Pick a font size that keeps every day's content within the available
  // column height, so the whole week fits on this one page regardless of
  // how busy things are.
  function estimateLines(fontSize: number): number {
    let maxLines = 0;
    for (let day = 0; day <= 6; day++) {
      let lines = 0;
      for (const slot of overview[day]) {
        const sponsorText = slot.sponsors.join(', ');
        const full = `${slot.time}  ${sponsorText}`;
        const width = font.widthOfTextAtSize(full, fontSize);
        lines += Math.max(1, Math.ceil(width / (columnWidth - 4)));
      }
      maxLines = Math.max(maxLines, lines);
    }
    return maxLines;
  }

  let fontSize = 8.5;
  const lineHeight = () => fontSize * 1.55;
  while (fontSize > 5.5) {
    const linesNeeded = estimateLines(fontSize);
    if (linesNeeded * lineHeight() <= availableHeight) break;
    fontSize -= 0.5;
  }

  for (let day = 0; day <= 6; day++) {
    const colX = marginX + day * (columnWidth + columnGap);
    let colY = headerBottom;

    page.drawText(DAY_NAMES[day], { x: colX, y: colY, size: 10, font: fontBold, color: black });
    colY -= 4;
    page.drawLine({ start: { x: colX, y: colY }, end: { x: colX + columnWidth, y: colY }, thickness: 0.5, color: lightGray });
    colY -= lineHeight();

    const slots = overview[day];
    if (slots.length === 0) {
      page.drawText('—', { x: colX, y: colY, size: fontSize, font, color: gray });
      continue;
    }

    for (const slot of slots) {
      const sponsorText = slot.sponsors.join(', ');
      const full = `${slot.time}  ${sponsorText}`;
      const words = full.split(' ');
      let line = '';
      const lines: string[] = [];
      for (const word of words) {
        const candidate = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(candidate, fontSize) > columnWidth - 4 && line) {
          lines.push(line);
          line = word;
        } else {
          line = candidate;
        }
      }
      if (line) lines.push(line);

      for (let i = 0; i < lines.length; i++) {
        const isFirstLine = i === 0;
        page.drawText(lines[i], {
          x: colX,
          y: colY,
          size: fontSize,
          font: isFirstLine ? fontBold : font,
          color: isFirstLine ? black : gray,
        });
        colY -= lineHeight();
      }
    }
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
