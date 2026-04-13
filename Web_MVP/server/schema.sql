-- FlowCube Supabase PostgreSQL Schema
-- Run this in the Supabase SQL editor to set up the database

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username    TEXT NOT NULL,
  email       TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Focus sessions table
CREATE TABLE IF NOT EXISTS focus_sessions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode             TEXT NOT NULL CHECK (mode IN ('study', 'exercise')),
  timer_type       TEXT NOT NULL CHECK (timer_type IN ('forward', 'countdown')),
  planned_duration INTEGER,        -- seconds (for countdown mode)
  actual_duration  INTEGER,        -- seconds (filled on completion)
  status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'abandoned')),
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at     TIMESTAMPTZ,
  triggered_by     TEXT DEFAULT 'manual' CHECK (triggered_by IN ('manual', 'm5stack'))
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON focus_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_completed_at ON focus_sessions(completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_user_status ON focus_sessions(user_id, status);

-- Row-level security (enable when using Supabase Auth directly from client)
-- ALTER TABLE users ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE focus_sessions ENABLE ROW LEVEL SECURITY;
