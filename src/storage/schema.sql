PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS academic_years (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  start_date TEXT CHECK(start_date IS NULL OR (length(start_date)=10 AND date(start_date,'+0 days') IS NOT NULL AND date(start_date,'+0 days')=start_date)),
  end_date TEXT CHECK(end_date IS NULL OR (length(end_date)=10 AND date(end_date,'+0 days') IS NOT NULL AND date(end_date,'+0 days')=end_date)),
  archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)),
  CHECK(start_date IS NULL OR end_date IS NULL OR end_date >= start_date)
);
CREATE TABLE IF NOT EXISTS subjects (
  id INTEGER PRIMARY KEY,
  academic_year_id INTEGER NOT NULL REFERENCES academic_years(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color_id INTEGER NOT NULL CHECK(color_id BETWEEN 0 AND 11),
  archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1))
);
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL CHECK(typeof(started_at)='integer'),
  elapsed_seconds INTEGER NOT NULL CHECK(typeof(elapsed_seconds)='integer' AND elapsed_seconds > 0),
  note TEXT,
  manual INTEGER NOT NULL DEFAULT 0 CHECK(manual IN (0,1))
);
CREATE TABLE IF NOT EXISTS session_pauses (
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  offset_seconds INTEGER NOT NULL CHECK(typeof(offset_seconds)='integer' AND offset_seconds >= 0),
  duration_seconds INTEGER NOT NULL CHECK(typeof(duration_seconds)='integer' AND duration_seconds > 0),
  PRIMARY KEY(session_id, offset_seconds)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
-- Source identities are external import/recovery keys, never local primary keys.
CREATE TABLE IF NOT EXISTS session_sources (
  source_key TEXT PRIMARY KEY,
  session_id INTEGER NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS subjects_year ON subjects(academic_year_id);
CREATE INDEX IF NOT EXISTS sessions_start ON sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS sessions_subject_start ON sessions(subject_id, started_at DESC);
CREATE TRIGGER IF NOT EXISTS pause_insert_bounds BEFORE INSERT ON session_pauses BEGIN
  SELECT CASE WHEN NEW.offset_seconds + NEW.duration_seconds > (SELECT elapsed_seconds FROM sessions WHERE id=NEW.session_id)
    OR EXISTS(SELECT 1 FROM session_pauses WHERE session_id=NEW.session_id
      AND offset_seconds < NEW.offset_seconds + NEW.duration_seconds
      AND offset_seconds + duration_seconds > NEW.offset_seconds)
    THEN RAISE(ABORT, 'Invalid overlapping or out-of-bounds pause') END;
END;
CREATE TRIGGER IF NOT EXISTS pause_update_bounds BEFORE UPDATE ON session_pauses BEGIN
  SELECT RAISE(ABORT, 'Replace pauses transactionally through SessionRepository');
END;
CREATE TRIGGER IF NOT EXISTS session_update_bounds BEFORE UPDATE OF elapsed_seconds ON sessions BEGIN
  SELECT CASE WHEN EXISTS(SELECT 1 FROM session_pauses WHERE session_id=NEW.id
    AND offset_seconds + duration_seconds > NEW.elapsed_seconds)
    THEN RAISE(ABORT, 'Session ends before its pauses') END;
END;
PRAGMA user_version = 3;
