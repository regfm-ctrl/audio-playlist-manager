import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const token = req.cookies.get('token')?.value;
  const user = token ? await verifyToken(token) : null;
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const baseUrl = process.env.PORTAL_API_URL;
  const secret = process.env.PORTAL_API_SECRET;
  if (!baseUrl || !secret) {
    return NextResponse.json({ error: 'Portal integration not configured yet (PORTAL_API_URL / PORTAL_API_SECRET)' }, { status: 503 });
  }

  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/clients/${encodeURIComponent(params.id)}/status`, {
      headers: { Authorization: `Bearer ${secret}` },
      cache: 'no-store',
    });
    if (!res.ok) {
      return NextResponse.json({ error: `Portal returned ${res.status}` }, { status: 502 });
    }
    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: any) {
    return NextResponse.json({ error: `Could not reach the Portal: ${err.message ?? String(err)}` }, { status: 502 });
  }
}
