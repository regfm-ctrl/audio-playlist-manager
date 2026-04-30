import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { verifyToken } from '@/lib/auth';

export async function GET(req: NextRequest) {
  const token = req.cookies.get('token')?.value;
  const user = token ? await verifyToken(token) : null;

  if (user?.role !== 'admin')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { searchParams } = req.nextUrl;
  const limit = parseInt(searchParams.get('limit') ?? '200');
  const username = searchParams.get('username');

  const rows = username
    ? await sql`
        SELECT * FROM activity_logs
        WHERE username = ${username}
        ORDER BY created_at DESC
        LIMIT ${limit}
      `
    : await sql`
        SELECT * FROM activity_logs
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;

  return NextResponse.json(rows);
}
