import type { FocusSession } from "../types";
import { focusIntervals, type Pause, type StoredSession } from "./model";
import type { Connection, SqlRow } from "./connection";

export async function readStoredSessions(connection: Connection, id?: number): Promise<StoredSession[]> {
  const [sessions, pauses, sources] = await Promise.all([
    connection.select(
      "SELECT * FROM sessions" + (id === undefined ? " ORDER BY started_at DESC,id DESC" : " WHERE id=?"),
      id === undefined ? [] : [id],
    ),
    connection.select(
      "SELECT * FROM session_pauses" +
        (id === undefined ? " ORDER BY session_id,offset_seconds" : " WHERE session_id=? ORDER BY offset_seconds"),
      id === undefined ? [] : [id],
    ),
    connection.select(
      "SELECT session_id,MIN(source_key) AS source_key FROM session_sources" +
        (id === undefined ? " GROUP BY session_id" : " WHERE session_id=? GROUP BY session_id"),
      id === undefined ? [] : [id],
    ),
  ]);
  const grouped = new Map<number, Pause[]>();
  for (const row of pauses) {
    const id = Number(row.session_id),
      list = grouped.get(id) ?? [];
    list.push({ offsetSeconds: Number(row.offset_seconds), durationSeconds: Number(row.duration_seconds) });
    grouped.set(id, list);
  }
  const identities = new Map(sources.map((row) => [Number(row.session_id), String(row.source_key)]));
  return sessions.map((row) => ({
    id: Number(row.id),
    subjectId: Number(row.subject_id),
    startedAt: Number(row.started_at),
    elapsedSeconds: Number(row.elapsed_seconds),
    note: row.note === null ? undefined : String(row.note),
    manual: Boolean(row.manual),
    pauses: grouped.get(Number(row.id)) ?? [],
    sourceIdentity: identities.get(Number(row.id)) ?? "",
  }));
}

/** Display names, parent and effective archive state are resolved for every read.
 * Millisecond timestamps/intervals are derived UI/allocation values, not columns. */
export async function readSessionViews(connection: Connection, id?: number): Promise<FocusSession[]> {
  const [sessions, relationships] = await Promise.all([
    readStoredSessions(connection, id),
    connection.select(
      "SELECT s.id,s.name,y.id AS year_id,y.name AS year_name,(s.archived OR y.archived) AS archived FROM subjects s JOIN academic_years y ON y.id=s.academic_year_id",
    ),
  ]);
  const subjects = new Map(relationships.map((row) => [Number(row.id), row]));
  return sessions.map((session) => {
    const subject = subjects.get(session.subjectId)!;
    return {
      id: String(session.id),
      subjectId: String(session.subjectId),
      subjectName: String(subject.name),
      academicYearId: String(subject.year_id),
      academicYearName: String(subject.year_name),
      archived: Boolean(subject.archived),
      startTime: session.startedAt * 1000,
      endTime: (session.startedAt + session.elapsedSeconds) * 1000,
      focusedDurationSeconds:
        session.elapsedSeconds - session.pauses.reduce((sum, pause) => sum + pause.durationSeconds, 0),
      manual: session.manual ? true : undefined,
      note: session.note,
      focusIntervals: focusIntervals(session.startedAt, session.elapsedSeconds, session.pauses),
      sourceIdentity: session.sourceIdentity,
    };
  });
}

export function yearView(row: SqlRow) {
  return {
    id: String(row.id),
    name: String(row.name),
    startDate: row.start_date === null ? undefined : String(row.start_date),
    endDate: row.end_date === null ? undefined : String(row.end_date),
    archived: Boolean(row.archived),
  };
}

// Shared consistent snapshots for History and Analytics, outside React components.
export async function readHistorySnapshot(database: import("../db").FocusDatabase) {
  return database.transaction("r", async (database) => {
    const [years, subjects, sessions] = await Promise.all([
      database.academicYears.toArray(),
      database.subjects.toArray(),
      database.sessions.toArray(),
    ]);
    sessions.sort((a, b) => b.startTime - a.startTime || Number(b.id) - Number(a.id));
    return { years, subjects, sessions };
  });
}
export async function readAnalyticsSnapshot(database: import("../db").FocusDatabase) {
  const snapshot = await readHistorySnapshot(database);
  snapshot.sessions.reverse();
  return snapshot;
}

export async function readSessionsForYear(database: import("../db").FocusDatabase, yearId: string) {
  const rows = await database.sessions.toArray();
  return rows.filter((session) => session.academicYearId === yearId);
}
export async function readYearsAlphabetically(database: import("../db").FocusDatabase) {
  return (await database.academicYears.toArray()).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
export async function readSubjectsAlphabetically(database: import("../db").FocusDatabase) {
  return (await database.subjects.toArray()).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
export async function readHistorySessions(database: import("../db").FocusDatabase) {
  return (await readHistorySnapshot(database)).sessions;
}
