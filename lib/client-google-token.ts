// Client-side helper for pages that need a Google Drive access token but
// aren't the main app shell (which keeps one refreshed in React state).
// Pulls a currently-valid token from the server, which refreshes it via the
// stored refresh token as needed — never reads from localStorage, since
// nothing writes a token there anymore.
export async function getGoogleAccessToken(): Promise<string | null> {
  try {
    const res = await fetch('/api/auth/google/token?t=' + Date.now());
    if (!res.ok) return null;
    const data = await res.json();
    return data.accessToken ?? null;
  } catch {
    return null;
  }
}
