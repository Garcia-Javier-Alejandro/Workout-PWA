-- Cloudflare D1 schema for Workout PWA.
-- D1 is the source of truth for the workout history.
-- All ids are client-generated UUID v4 values and are declared as PRIMARY KEY
-- so that idempotent inserts (INSERT OR IGNORE) never produce duplicates.

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  started_at   TEXT NOT NULL,
  completed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sets (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL,
  exercise_id TEXT NOT NULL,
  set_number  INTEGER NOT NULL,
  reps        INTEGER NOT NULL,
  weight      REAL NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

-- Indexes to support future performance-analysis queries.
CREATE INDEX IF NOT EXISTS idx_sets_session_id  ON sets(session_id);
CREATE INDEX IF NOT EXISTS idx_sets_exercise_id ON sets(exercise_id);
CREATE INDEX IF NOT EXISTS idx_sessions_completed_at ON sessions(completed_at);
