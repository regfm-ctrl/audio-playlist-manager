import { NextRequest, NextResponse } from 'next/server';
import { generateWeeklyOverviewPdfBytes } from '@/lib/weekly-overview-pdf';
import { logActivity } from '@/lib/activity';

const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const pdfBytes = await generateWeeklyOverviewPdfBytes();
  await logActivity(0, 'scheduler', 'WEEKLY_OVERVIEW_PDF_GENERATED', '/api/cron/weekly-overview-pdf', 'Generated for upload to regfm.com.au');

  return new NextResponse(Buffer.from(pdfBytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="Weekly_Sponsorship_Schedule.pdf"`,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}
