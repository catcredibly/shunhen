-- Persist random fallback assignments before the schema transaction. Failed
-- upgrades retain these assignments, so retries choose exactly the same identity.
WITH RECURSIVE control_codes(code) AS (
  VALUES(0) UNION ALL SELECT code+1 FROM control_codes WHERE code<31
), recognized AS (
  SELECT session_id,source_key FROM session_sources
  WHERE NOT EXISTS(SELECT 1 FROM control_codes WHERE instr(source_key,char(code))>0)
    AND instr(source_key,char(127))=0
)
INSERT OR IGNORE INTO storage_metadata(key,value)
SELECT 'canonical-source-v2:' || s.id,
  COALESCE(
    (SELECT source_key FROM recognized WHERE session_id=s.id AND source_key GLOB 'session:?*' ORDER BY source_key COLLATE BINARY LIMIT 1),
    (SELECT source_key FROM recognized WHERE session_id=s.id AND
      (source_key GLOB 'legacy-session:?*' OR source_key GLOB 'csv-session:?*' OR source_key GLOB 'backup-session:?*')
      ORDER BY source_key COLLATE BINARY LIMIT 1),
    'session:' || lower(hex(randomblob(16)))
  )
FROM sessions s ORDER BY s.id;
