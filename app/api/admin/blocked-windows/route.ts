import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { getBlockedWindows, setBlockedWindows, type BlockedWindow } from '@/lib/blocked-windows';

export async function GET(req: NextRequest) {
  const token = req.cookies.get('token')?.value;
  const user = token ? await verifyToken(token) : null;
  if (user?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const windows = await getBlockedWindows();
  return NextResponse.json({ windows });
}

export async function POST(req: NextRequest) {
  const token = req.cookies.get('token')?.value;
  const user = token ? await verifyToken(token) : null;
  if (user?.role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { windows } = await req.json();

  const clean: BlockedWindow[] = (Array.isArray(windows) ? windows : [])
    .filter((w: any) => w && typeof w.day === 'number' && w.day >= 0 && w.day <= 6 && w.startTime && w.endTime)
    .map((w: any) => ({ day: w.day, startTime: w.startTime, endTime: w.endTime, label: w.label || '' }));

  await setBlockedWindows(clean);
  return NextResponse.json({ windows: clean });
}
