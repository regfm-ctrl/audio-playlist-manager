import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { generateWeeklyOverviewPdfBytes } from '@/lib/weekly-overview-pdf';

export async function GET(req: NextRequest) {
  const token = req.cookies.get('token')?.value;
  const user = token ? await verifyToken(token) : null;
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const pdfBytes = await generateWeeklyOverviewPdfBytes();
  return new NextResponse(Buffer.from(pdfBytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="Weekly_Sponsorship_Schedule.pdf"`,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}
