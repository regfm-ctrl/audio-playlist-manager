# Auth Setup Guide

## What was added

- **User login** — all pages now require sign-in (except `/login`)
- **Admin dashboard** at `/admin` — create/delete users, change passwords, view activity logs
- **Activity logging** — login events are recorded; you can log more actions manually

## New files

| File | Purpose |
|------|---------|
| `middleware.ts` | Protects all routes, redirects to `/login` if not authenticated |
| `lib/auth.ts` | Password hashing (bcrypt) and JWT token helpers |
| `lib/db.ts` | Vercel Postgres client |
| `lib/activity.ts` | Activity logging helper |
| `app/login/page.tsx` | Login page UI |
| `app/admin/page.tsx` | Admin dashboard (users + logs) |
| `app/api/auth/login/route.ts` | Login API |
| `app/api/auth/logout/route.ts` | Logout API |
| `app/api/admin/users/route.ts` | User management API (GET/POST/PATCH/DELETE) |
| `app/api/admin/logs/route.ts` | Activity log API |
| `SETUP-AUTH.sql` | SQL to run once in Vercel Postgres |

## Setup steps

### 1. Install dependencies
```bash
pnpm add @vercel/postgres bcryptjs jose
pnpm add -D @types/bcryptjs
```

### 2. Add environment variables
In Vercel dashboard → Settings → Environment Variables, and in your local `.env.local`:
```
POSTGRES_URL=your-vercel-postgres-connection-string
JWT_SECRET=a-long-random-secret-string-at-least-32-chars
```

### 3. Run the SQL
Open your Vercel Postgres console and run the contents of `SETUP-AUTH.sql`.

### 4. Deploy and log in
- Go to `/login`
- Username: `admin` | Password: `changeme`
- Immediately go to `/admin` and change the admin password

## Logging custom activity

In any API route, add activity logging like this:

```typescript
import { logActivity } from '@/lib/activity';
import { verifyToken } from '@/lib/auth';

// Inside your route handler:
const token = req.cookies.get('token')?.value;
const user = token ? await verifyToken(token) : null;
if (user) {
  await logActivity(user.userId, user.username, 'PLAYED_TRACK', req.nextUrl.pathname);
}
```
