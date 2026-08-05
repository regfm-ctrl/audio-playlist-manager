import { sql } from '@/lib/db';

export async function getValidAccessToken(): Promise<string | null> {
  try {
    // Get the most recently updated token
    const rows = await sql`
      SELECT * FROM google_tokens
      ORDER BY updated_at DESC
      LIMIT 1
    `;

    if (rows.length === 0) {
      console.log('[google-tokens] No tokens found in database');
      return null;
    }

    const tokenRow = rows[0];

    // Check if access token is still valid (with 5 min buffer)
    const expiresAt = new Date(tokenRow.expires_at).getTime();
    const now = Date.now();
    const fiveMinutes = 5 * 60 * 1000;

    if (expiresAt > now + fiveMinutes) {
      // Token still valid
      return tokenRow.access_token;
    }

    // Token expired — refresh it
    console.log('[google-tokens] Access token expired, refreshing...');
    const refreshed = await refreshAccessToken(tokenRow.refresh_token, tokenRow.user_id);
    return refreshed;

  } catch (err) {
    console.error('[google-tokens] Error getting token:', err);
    return null;
  }
}

async function refreshAccessToken(refreshToken: string, userId: number): Promise<string | null> {
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: refreshToken,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        grant_type: 'refresh_token',
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('[google-tokens] Refresh failed:', err);
      return null;
    }

    const tokens = await res.json();
    const { access_token, expires_in } = tokens;
    const expiresAt = new Date(Date.now() + (expires_in - 300) * 1000).toISOString();

    // Update stored access token
    await sql`
      UPDATE google_tokens
      SET access_token = ${access_token},
          expires_at = ${expiresAt},
          updated_at = NOW()
      WHERE user_id = ${userId}
    `;

    console.log('[google-tokens] Token refreshed successfully');
    return access_token;

  } catch (err) {
    console.error('[google-tokens] Refresh error:', err);
    return null;
  }
}

export async function hasStoredToken(): Promise<boolean> {
  try {
    const rows = await sql`SELECT id FROM google_tokens LIMIT 1`;
    return rows.length > 0;
  } catch {
    return false;
  }
}
