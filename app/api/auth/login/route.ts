import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { verifyPassword, createToken } from '@/lib/auth';
import { logActivity } from '@/lib/activity';

export async function POST(req: NextRequest) {
  const { username, password } = await req.json();

  const rows = await sql`SELECT * FROM users WHERE username = ${username}`;
  const user = rows[0];

  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const token = await createToken({
    userId: user.id,
    username: user.username,
    role: user.role,
  });

  await logActivity(user.id, user.username, 'LOGIN', '/login');

  const res = NextResponse.json({ ok: true, role: user.role });
  res.cookies.set('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 8, // 8 hours
    path: '/',
  });

  return res;
}
