import type { FocusDatabase } from "../db";
import { ACTIVE_TIMER_STORAGE_KEY } from "../timerState";
import { withStorageLock } from "./connection";
import { readLegacy, deleteLegacy } from "./legacy";
import { normalizeLegacy, validateData, type NormalizedData, type StoredYear, type StoredSubject } from "./model";
import { readStoredSessions } from "./queries";

export async function readNormalized(database: FocusDatabase): Promise<NormalizedData> {
  return database.access(async (connection) => {
    const [years, subjects, sessions, settings] = await Promise.all([
      connection.select("SELECT * FROM academic_years ORDER BY id"),
      connection.select("SELECT * FROM subjects ORDER BY id"),
      readStoredSessions(connection),
      connection.select<{ key: string; value: string }>("SELECT key,value FROM settings ORDER BY key"),
    ]);
    const academicYears: StoredYear[] = years.map((row) => ({
      id: Number(row.id),
      name: String(row.name),
      startDate: row.start_date === null ? undefined : String(row.start_date),
      endDate: row.end_date === null ? undefined : String(row.end_date),
      archived: Boolean(row.archived),
    }));
    const subjectRows: StoredSubject[] = subjects.map((row) => ({
      id: Number(row.id),
      academicYearId: Number(row.academic_year_id),
      name: String(row.name),
      colorId: Number(row.color_id),
      archived: Boolean(row.archived),
    }));
    return { academicYears, subjects: subjectRows, sessions, settings };
  });
}

export async function insertNormalized(database: FocusDatabase, data: NormalizedData) {
  validateData(data);
  const connection = database.connection;
  for (const row of data.academicYears)
    await connection.execute("INSERT INTO academic_years(id,name,start_date,end_date,archived) VALUES(?,?,?,?,?)", [
      row.id,
      row.name,
      row.startDate ?? null,
      row.endDate ?? null,
      row.archived,
    ]);
  for (const row of data.subjects)
    await connection.execute("INSERT INTO subjects(id,academic_year_id,name,color_id,archived) VALUES(?,?,?,?,?)", [
      row.id,
      row.academicYearId,
      row.name,
      row.colorId,
      row.archived,
    ]);
  for (const row of data.sessions) {
    await connection.execute(
      "INSERT INTO sessions(id,subject_id,started_at,elapsed_seconds,note,manual) VALUES(?,?,?,?,?,?)",
      [row.id, row.subjectId, row.startedAt, row.elapsedSeconds, row.note ?? null, row.manual],
    );
    for (const pause of row.pauses)
      await connection.execute("INSERT INTO session_pauses(session_id,offset_seconds,duration_seconds) VALUES(?,?,?)", [
        row.id,
        pause.offsetSeconds,
        pause.durationSeconds,
      ]);
    await connection.execute("INSERT INTO session_sources(source_key,session_id) VALUES(?,?)", [
      row.sourceIdentity,
      row.id,
    ]);
  }
  for (const row of data.settings) await database.settings.put(row);
}

export async function validateDatabase(database: FocusDatabase, expected?: NormalizedData) {
  if ((await database.connection.select("PRAGMA foreign_key_check")).length)
    throw new Error("SQLite foreign key validation failed.");
  const actual = await readNormalized(database);
  validateData(actual);
  if (expected) {
    const canonical = (data: NormalizedData) =>
      JSON.stringify({
        academicYears: data.academicYears
          .map((row) => [row.id, row.name, row.startDate ?? null, row.endDate ?? null, row.archived])
          .sort((a, b) => Number(a[0]) - Number(b[0])),
        subjects: data.subjects
          .map((row) => [row.id, row.academicYearId, row.name, row.colorId, row.archived])
          .sort((a, b) => Number(a[0]) - Number(b[0])),
        sessions: data.sessions
          .map((row) => [
            row.id,
            row.subjectId,
            row.startedAt,
            row.elapsedSeconds,
            row.note ?? null,
            row.manual,
            row.pauses,
            row.sourceIdentity,
          ])
          .sort((a, b) => Number(a[0]) - Number(b[0])),
        settings: data.settings.map((row) => [row.key, row.value]).sort((a, b) => a[0].localeCompare(b[0])),
      });
    if (canonical(actual) !== canonical(expected))
      throw new Error("SQLite migration validation failed: imported values or counts differ.");
  }
}

export async function initializeStorage(
  database: FocusDatabase,
  source = readLegacy,
  cleanup = deleteLegacy,
  storage: Pick<Storage, "removeItem"> | undefined = typeof localStorage === "undefined" ? undefined : localStorage,
) {
  await withStorageLock(async () => {
    const connection = database.connection;
    const completed = (
      await connection.select("SELECT value FROM storage_metadata WHERE key='indexeddb-migration-v1'")
    )[0];
    if (!completed) {
      const legacy = await source(database.name);
      try {
        const data = legacy
          ? normalizeLegacy(legacy.data).data
          : { academicYears: [], subjects: [], sessions: [], settings: [] };
        await database.runTransaction(async (database) => {
          // SQLite cannot contain unmarked study data: never silently overwrite it.
          const existing = await readNormalized(database);
          if (
            existing.academicYears.length ||
            existing.subjects.length ||
            existing.sessions.length ||
            existing.settings.length
          )
            throw new Error("Unmarked SQLite data exists.");
          await insertNormalized(database, data);
          await validateDatabase(database, data);
          await database.connection.execute(
            "INSERT INTO storage_metadata(key,value) VALUES('indexeddb-migration-v1','complete')",
          );
          if (legacy) {
            await database.connection.execute(
              "INSERT INTO storage_metadata(key,value) VALUES('indexeddb-cleanup-pending','true')",
            );
            await database.connection.execute(
              "INSERT INTO storage_metadata(key,value) VALUES('legacy-timer-discard-pending','true')",
            );
          }
        });
      } finally {
        legacy?.close();
      }
    }
    const discard = (
      await connection.select("SELECT value FROM storage_metadata WHERE key='legacy-timer-discard-pending'")
    )[0];
    if (discard && storage) {
      storage.removeItem(ACTIVE_TIMER_STORAGE_KEY);
      await connection.execute("DELETE FROM storage_metadata WHERE key='legacy-timer-discard-pending'");
    }
    if ((await connection.select("SELECT value FROM storage_metadata WHERE key='indexeddb-cleanup-pending'"))[0]) {
      try {
        await cleanup(database.name);
        await connection.execute("DELETE FROM storage_metadata WHERE key='indexeddb-cleanup-pending'");
      } catch (error) {
        // SQLite is authoritative once committed. Cleanup alone retries next launch.
        console.warn("Legacy IndexedDB cleanup will retry next launch.", error);
      }
    }
  });
}
