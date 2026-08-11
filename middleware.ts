import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from './lib/auth';

const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/schedules/run', '/api/cron'];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow public paths
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const token = req.cookies.get('token')?.value;
  const user = token ? await verifyToken(token) : null;

  if (!user) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  // Admin-only: the /admin pages, and the diagnostic/maintenance API
  // routes they use (audit, category conflicts, path migration, admin
  // actions). These aren't all under /api/admin, so they need covering
  // explicitly here rather than relying on the path prefix alone.
  const isAdminRestricted = pathname.startsWith('/admin') || pathname.startsWith('/api/audit') || pathname.startsWith('/api/admin');
  if (isAdminRestricted && user.role !== 'admin') {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Forbidden — admin access required' }, { status: 403 });
    }
    return NextResponse.redirect(new URL('/', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|favicon.png).*)'],
};


