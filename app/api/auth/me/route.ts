import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';

// The session cookie is httpOnly by design (keeps it safe from XSS), which
// means client-side JS can never read it directly via document.cookie —
// every earlier attempt to decode it that way silently failed for every
// user, always leaving role checks at their default. This endpoint reads
// the cookie server-side (where it works fine) and hands back just the
// identity fields a page actually needs to adjust what it shows.
export async function GET(req: NextRequest) {
  const token = req.cookies.get('token')?.value;
  const user = token ? await verifyToken(token) : null;
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  return NextResponse.json({ username: user.username, role: user.role });
}
