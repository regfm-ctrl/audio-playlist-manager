import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from './lib/auth';

// /api/portal/agreement-signed, agreement-extended, campaigns and campaign-extended are called server-to-server by the Approval
// Portal (no user cookie) — it authenticates itself with the shared
// PORTAL_API_SECRET inside the route, the same way /api/cron does with
// CRON_SECRET. Only these four paths are opened up, not the rest of /api/portal.
const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/schedules/run', '/api/cron', '/api/portal/agreement-signed', '/api/portal/agreement-extended', '/api/portal/campaigns', '/api/portal/campaign-extended'];

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
    return NextResponse.redirect(new URL('/campaigns', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|favicon.png).*)'],
};


