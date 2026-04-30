import { NextRequest, NextResponse } from 'next/server';
import { verifyToken } from './lib/auth';

const PUBLIC_PATHS = ['/login', '/api/auth/login'];

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

  // Only admins can access /admin routes
  if (pathname.startsWith('/admin') && user.role !== 'admin') {
    return NextResponse.redirect(new URL('/', req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|favicon.png).*)'],
};
