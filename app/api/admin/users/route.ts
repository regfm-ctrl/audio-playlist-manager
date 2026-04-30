import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { hashPassword, verifyToken } from '@/lib/auth';

async function getAdmin(req: NextRequest) {
  const token = req.cookies.get('token')?.value;
  if (!token) return null;
  const user = await verifyToken(token);
  return user?.role === 'admin' ? user : null;
}

// GET — list all users
export async function GET(req: NextRequest) {
  if (!(await getAdmin(req)))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { rows } = await sql`
    SELECT id, username, role, created_at FROM users ORDER BY created_at DESC
  `;
  return NextResponse.json(rows);
}

// POST — create a new user
export async function POST(req: NextRequest) {
  if (!(await getAdmin(req)))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { username, password, role } = await req.json();
  const password_hash = await hashPassword(password);

  try {
    await sql`
      INSERT INTO users (username, password_hash, role)
      VALUES (${username}, ${password_hash}, ${role ?? 'user'})
    `;
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: 'Username already exists' },
      { status: 400 }
    );
  }
}

// PATCH — update password
export async function PATCH(req: NextRequest) {
  if (!(await getAdmin(req)))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id, password } = await req.json();
  const password_hash = await hashPassword(password);

  await sql`UPDATE users SET password_hash = ${password_hash} WHERE id = ${id}`;
  return NextResponse.json({ ok: true });
}

// DELETE — remove user
export async function DELETE(req: NextRequest) {
  if (!(await getAdmin(req)))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await req.json();
  await sql`DELETE FROM users WHERE id = ${id}`;
  return NextResponse.json({ ok: true });
}
