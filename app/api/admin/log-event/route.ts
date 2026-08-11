import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';
import { logActivity } from '@/lib/activity';

export async function POST(req: NextRequest) {
  const token = req.cookies.get('token')?.value;
  const user = token ? await verifyToken(token) : null;
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { action, details, path } = await req.json();
  if (!action) return NextResponse.json({ error: 'Missing action' }, { status: 400 });

  await logActivity((user as any).userId ?? 0, user.username, action, path ?? '/admin/audit', details);
  return NextResponse.json({ ok: true });
}
