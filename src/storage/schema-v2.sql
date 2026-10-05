CREATE TABLE session_sources_v2 (
  source_key TEXT PRIMARY KEY,
  session_id INTEGER NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE
) WITHOUT ROWID;
INSERT INTO session_sources_v2(source_key,session_id)
SELECT m.source_key,s.id FROM sessions s JOIN canonical_source_assignments m ON m.session_id=s.id ORDER BY s.id;
DROP TABLE session_sources;
ALTER TABLE session_sources_v2 RENAME TO session_sources;
DROP TABLE canonical_source_assignments;
PRAGMA user_version = 2;
