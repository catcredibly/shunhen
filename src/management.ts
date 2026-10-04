import { readSessionsForYear } from "./storage/queries";
import { sessionInvalidReason, newlyInvalidCount } from "./sessionValidity";
import { noteMetrics } from "./notes";
import { db, type FocusDatabase } from "./db";
import type { AcademicYear, FocusSession, Subject } from "./types";
import { sessionEditTiming } from "./sessionDuration";

export function isSessionEffectivelyArchived(session: FocusSession, subjects: Subject[], years: AcademicYear[]) {
  const subject = subjects.find((item) => item.id === session.subjectId);
  const year = years.find((item) => item.id === subject?.academicYearId);
  return Boolean(subject?.archived || year?.archived);
}

export async function setAcademicYearArchived(id: string, archived: boolean, database: FocusDatabase = db) {
  await database.academicYears.update(id, { archived });
}

export async function setSubjectArchived(id: string, archived: boolean, database: FocusDatabase = db) {
  await database.transaction("rw", async (database) => {
    const subject = await database.subjects.get(id);
    if (!subject) return;
    const parent = await database.academicYears.get(subject.academicYearId);
    if (parent?.archived && !archived) return;
    await database.subjects.update(id, { archived });
  });
}

export async function saveSubject(subject: Subject, database: FocusDatabase = db) {
  await database.subjects.put(subject);
}

export async function deleteSubjectCascade(id: string, database: FocusDatabase = db) {
  await database.subjects.delete(id);
}

export async function deleteAcademicYearCascade(id: string, database: FocusDatabase = db) {
  await database.academicYears.delete(id);
}

export async function deleteSession(id: string, database: FocusDatabase = db) {
  await database.sessions.delete(id);
}

export async function deleteSessions(ids: string[], database: FocusDatabase = db) {
  await database.transaction("rw", (database) => database.sessions.bulkDelete(ids));
}

export async function moveSessions(ids: string[], subjectId: string, database: FocusDatabase = db) {
  await database.transaction("rw", async (database) => {
    const subject = await database.subjects.get(subjectId);
    if (!subject || subject.archived) throw new Error("Choose an active Subject.");
    const academicYear = await database.academicYears.get(subject.academicYearId);
    if (!academicYear || academicYear.archived) throw new Error("Choose a Subject in an active Academic Year.");
    for (const id of ids) await database.sessions.update(id, { subjectId: subject.id });
  });
}

export async function updateSessionDetails(
  id: string,
  input: {
    academicYearId: string;
    subjectId: string;
    startTime: number;
    endTime: number;
    note?: string;
  },
  database: FocusDatabase = db,
) {
  await database.transaction("rw", async (database) => {
    const session = await database.sessions.get(id);
    const subject = await database.subjects.get(input.subjectId);
    const academicYear = await database.academicYears.get(input.academicYearId);
    if (!noteMetrics(input.note ?? "").valid) throw new Error("Note exceeds the allowed limits.");
    if (!session) throw new Error("Session not found.");
    if (!subject || !academicYear || subject.academicYearId !== academicYear.id)
      throw new Error("Choose a Subject from the selected Academic Year.");
    const timing = sessionEditTiming(session, input.startTime, input.endTime);
    if (!Number.isFinite(timing.startTime) || !Number.isFinite(timing.endTime) || timing.endTime <= timing.startTime)
      throw new Error("End time must be after start time.");
    await database.sessions.update(id, {
      subjectId: subject.id,
      ...timing,
      note: input.note?.trim() ? input.note : undefined,
    });
  });
}

export function canDeleteManagedRecord(archived: boolean, allowDirectActiveDeletion: boolean) {
  return archived || allowDirectActiveDeletion;
}

/** Warning results never mutate data. Only explicit acknowledgements allow the save to proceed. */
export async function saveSessionEdit(
  id: string,
  input: Parameters<typeof updateSessionDetails>[1],
  confirmed: { invalid?: boolean } = {},
  database: FocusDatabase = db,
) {
  return database.transaction("rw", async (database) => {
    const original = await database.sessions.get(id);
    if (!original) throw new Error("Session not found.");
    const next = sessionEditTiming(original, input.startTime, input.endTime);
    const reason = sessionInvalidReason(next, await database.academicYears.get(input.academicYearId));
    const previousReason = sessionInvalidReason(original, await database.academicYears.get(original.academicYearId));
    if (reason && reason !== previousReason && !confirmed.invalid) return "invalid" as const;
    await updateSessionDetails(id, input, database);
    return "saved" as const;
  });
}

export async function saveAcademicYearEdit(next: AcademicYear, confirmed = false, database: FocusDatabase = db) {
  return database.transaction("rw", async (database) => {
    const previous = await database.academicYears.get(next.id);
    const count = previous ? newlyInvalidCount(await readSessionsForYear(database, next.id), previous, next) : 0;
    if (count && !confirmed) return count;
    await database.academicYears.put(next);
    return 0;
  });
}
