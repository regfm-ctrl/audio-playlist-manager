import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get('code');
  const state = searchParams.get('state'); // user_id
  const error = searchParams.get('error');

  if (error || !code) {
    return NextResponse.redirect(
      new URL(`/?google_error=${error ?? 'no_code'}`, req.url)
    );
  }

  try {
    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: process.env.GOOGLE_REDIRECT_URI!,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      console.error('[google/callback] Token exchange failed:', err);
      return NextResponse.redirect(new URL('/?google_error=token_exchange', req.url));
    }

    const tokens = await tokenRes.json();
    const { access_token, refresh_token, expires_in } = tokens;

    if (!refresh_token) {
      console.error('[google/callback] No refresh token received');
      return NextResponse.redirect(new URL('/?google_error=no_refresh_token', req.url));
    }

    const expiresAt = new Date(Date.now() + (expires_in - 300) * 1000).toISOString();
    const userId = state ? parseInt(state) : 1;

    // Upsert token in database
    await sql`
      INSERT INTO google_tokens (user_id, access_token, refresh_token, expires_at)
      VALUES (${userId}, ${access_token}, ${refresh_token}, ${expiresAt})
      ON CONFLICT (user_id)
      DO UPDATE SET
        access_token = ${access_token},
        refresh_token = ${refresh_token},
        expires_at = ${expiresAt},
        updated_at = NOW()
    `;

    console.log('[google/callback] Tokens stored for user:', userId);

    // Redirect back to main app with success
    return NextResponse.redirect(new URL('/?google_auth=success', req.url));

  } catch (err) {
    console.error('[google/callback] Error:', err);
    return NextResponse.redirect(new URL('/?google_error=server_error', req.url));
  }
}
