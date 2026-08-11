import { sql } from './db';

export async function logActivity(
  userId: number,
  username: string,
  action: string,
  path?: string,
  details?: string
) {
  try {
    await sql`
      INSERT INTO activity_logs (user_id, username, action, path, details)
      VALUES (${userId}, ${username}, ${action}, ${path ?? null}, ${details ?? null})
    `;
  } catch (err) {
    console.error('Failed to log activity:', err);
  }
}
