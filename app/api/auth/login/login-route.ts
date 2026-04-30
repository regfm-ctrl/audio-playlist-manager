import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { verifyPassword, createToken } from '@/lib/auth';
import { logActivity } from '@/lib/activity';

export async function POST(req: NextRequest) {
  try {
    const { username, password } = await req.json();
    console.log('[auth] Login attempt for:', username);

    let rows;
    try {
      rows = await sql`SELECT * FROM users WHERE username = ${username}`;
      console.log('[auth] DB rows found:', rows.length);
    } catch (err) {
      console.error('[auth] DB error:', err);
      return NextResponse.json({ error: 'Database error', details: String(err) }, { status: 500 });
    }

    const user = rows[0];
    if (!user) {
      console.log('[auth] No user found');
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    let passwordMatch = false;
    try {
      passwordMatch = await verifyPassword(password, user.password_hash);
      console.log('[auth] Password match:', passwordMatch);
    } catch (err) {
      console.error('[auth] bcrypt error:', err);
      return NextResponse.json({ error: 'Bcrypt error', details: String(err) }, { status: 500 });
    }

    if (!passwordMatch) {
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
      maxAge: 60 * 60 * 8,
      path: '/',
    });

    return res;
  } catch (err) {
    console.error('[auth] Unexpected error:', err);
    return NextResponse.json({ error: 'Server error', details: String(err) }, { status: 500 });
  }
}
