CREATE TABLE session_sources_v2 (
  source_key TEXT PRIMARY KEY,
  session_id INTEGER NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE
) WITHOUT ROWID;
INSERT INTO session_sources_v2(source_key,session_id)
SELECT m.value,s.id FROM sessions s JOIN storage_metadata m ON m.key='canonical-source-v2:' || s.id ORDER BY s.id;
DROP TABLE session_sources;
ALTER TABLE session_sources_v2 RENAME TO session_sources;
DELETE FROM storage_metadata WHERE key GLOB 'canonical-source-v2:*';
PRAGMA user_version = 2;
