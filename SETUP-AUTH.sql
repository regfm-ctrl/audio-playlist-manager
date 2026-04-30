-- Run this once in your Vercel Postgres console before deploying

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE activity_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  username TEXT,
  action TEXT NOT NULL,
  path TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Creates initial admin user with password: changeme
-- IMPORTANT: Change this password immediately after first login via /admin
INSERT INTO users (username, password_hash, role)
VALUES (
  'admin',
  '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi',
  'admin'
);

-- Schedules table
CREATE TABLE schedules (
  id SERIAL PRIMARY KEY,
  audio_file_id TEXT NOT NULL,
  audio_file_name TEXT NOT NULL,
  audio_directory_name TEXT NOT NULL,
  audio_local_path TEXT NOT NULL,
  playlist_id TEXT NOT NULL,
  playlist_name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT -1,
  schedule_type TEXT NOT NULL DEFAULT 'recurring',
  days_of_week TEXT,
  specific_dates TEXT,
  time_of_day TEXT NOT NULL DEFAULT '00:00',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_run_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Schedule run log
CREATE TABLE schedule_runs (
  id SERIAL PRIMARY KEY,
  schedule_id INTEGER REFERENCES schedules(id) ON DELETE SET NULL,
  audio_file_name TEXT,
  playlist_name TEXT,
  status TEXT NOT NULL,
  message TEXT,
  ran_at TIMESTAMPTZ DEFAULT NOW()
);
