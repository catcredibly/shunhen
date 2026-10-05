import { describe, expect, it } from "vitest";
import { createTestDatabase } from "./storage/testDatabase";
import { createSession } from "./data";
import {
  canDeleteManagedRecord,
  moveSessions,
  saveAcademicYearEdit,
  saveSessionEdit,
  setAcademicYearArchived,
  setSubjectArchived,
  updateSessionDetails,
  deleteSessions,
  deleteSubjectCascade,
  deleteAcademicYearCascade,
} from "./management";
async function seeded() {
  const test = createTestDatabase();
  const year = { id: "", name: "Year", startDate: "2026-01-01", endDate: "2026-12-31", archived: false };
  await test.database.academicYears.add(year);
  const subject = { id: "", academicYearId: year.id, name: "Subject", color: "#4da3ff", archived: false };
  await test.database.subjects.add(subject);
  const start = new Date(2026, 5, 15, 12).getTime();
  const session = await createSession(
    { academicYear: year, subject, startTime: start, endTime: start + 60000 },
    test.database,
  );
  return { ...test, year, subject, session };
}
describe("SQLite management", () => {
  it("preserves independent Subject archive intent through parent archival", async () => {
    const { database, sqlite, year, subject, session } = await seeded();
    await setAcademicYearArchived(year.id, true, database);
    expect((await database.subjects.get(subject.id))?.archived).toBe(false);
    expect((await database.sessions.get(session.id))?.archived).toBe(true);
    await setSubjectArchived(subject.id, true, database);
    await setAcademicYearArchived(year.id, false, database);
    expect((await database.sessions.get(session.id))?.archived).toBe(true);
    await setSubjectArchived(subject.id, false, database);
    expect((await database.sessions.get(session.id))?.archived).toBe(false);
    sqlite.close();
  });
  it("resolves AY date validity through Subject after moves and protects warning acknowledgements", async () => {
    const { database, sqlite, year, subject, session } = await seeded();
    expect(await saveAcademicYearEdit({ ...year, endDate: "2026-05-01" }, false, database)).toBe(1);
    expect((await database.academicYears.get(year.id))?.endDate).toBe(year.endDate);
    expect(await saveAcademicYearEdit({ ...year, endDate: "2026-05-01" }, true, database)).toBe(0);
    const other = { id: "", name: "Other", startDate: "2026-07-01", archived: false };
    await database.academicYears.add(other);
    await database.subjects.update(subject.id, { academicYearId: other.id });
    expect((await database.sessions.get(session.id))?.academicYearId).toBe(other.id);
    const input = {
      academicYearId: other.id,
      subjectId: subject.id,
      startTime: new Date(2026, 7, 1, 12).getTime(),
      endTime: new Date(2026, 7, 1, 13).getTime(),
    };
    expect(await saveSessionEdit(session.id, input, {}, database)).toBe("saved");
    const invalid = {
      ...input,
      startTime: new Date(2025, 7, 1, 12).getTime(),
      endTime: new Date(2025, 7, 1, 13).getTime(),
    };
    expect(await saveSessionEdit(session.id, invalid, {}, database)).toBe("invalid");
    expect(await saveSessionEdit(session.id, invalid, { invalid: true }, database)).toBe("saved");
    sqlite.close();
  });
  it("updates notes, checks limits and deletes selected Sessions with their pauses", async () => {
    const { database, sqlite, year, subject, session } = await seeded();
    const input = {
      academicYearId: year.id,
      subjectId: subject.id,
      startTime: session.startTime,
      endTime: session.endTime,
      note: "Changed",
    };
    await updateSessionDetails(session.id, input, database);
    expect((await database.sessions.get(session.id))?.note).toBe("Changed");
    await expect(updateSessionDetails(session.id, { ...input, note: "x".repeat(1201) }, database)).rejects.toThrow(
      "limits",
    );
    await deleteSessions([session.id], database);
    expect(await database.sessions.count()).toBe(0);
    expect(sqlite.prepare("SELECT * FROM session_sources").all()).toEqual([]);
    sqlite.close();
  });
  it("moves only the foreign key and cascades Subject deletion", async () => {
    const { database, sqlite, year, subject, session } = await seeded();
    const next = { ...subject, id: "", name: "Next" };
    await database.subjects.add(next);
    const before = sqlite.prepare("SELECT * FROM sessions").get();
    await moveSessions([session.id], next.id, database);
    expect(sqlite.prepare("SELECT * FROM sessions").get()).toEqual({ ...before, subject_id: Number(next.id) });
    await deleteSubjectCascade(next.id, database);
    expect(await database.sessions.count()).toBe(0);
    expect(await database.academicYears.get(year.id)).toBeDefined();
    sqlite.close();
  });
  it("preserves active-deletion preference behavior", () => {
    expect(canDeleteManagedRecord(false, false)).toBe(false);
    expect(canDeleteManagedRecord(true, false)).toBe(true);
    expect(canDeleteManagedRecord(false, true)).toBe(true);
  });
});

it("derives renames, archives and moves and enforces cascades", async () => {
  const { database, sqlite, year, subject, session } = await seeded();
  await database.sessions.update(session.id, {
    endTime: session.startTime + 90000,
    focusedDurationSeconds: 60,
    focusIntervals: [
      { startTime: session.startTime, endTime: session.startTime + 30000 },
      { startTime: session.startTime + 60000, endTime: session.startTime + 90000 },
    ],
  });
  expect(sqlite.prepare("SELECT COUNT(*) AS count FROM session_pauses").get()?.count).toBe(1);
  const input = session;
  await database.subjects.update(subject.id, { name: "Renamed" });
  expect((await database.sessions.get(input.id))?.subjectName).toBe("Renamed");
  await setAcademicYearArchived(year.id, true, database);
  expect((await database.subjects.get(subject.id))?.archived).toBe(false);
  expect((await database.sessions.get(input.id))?.archived).toBe(true);
  await setAcademicYearArchived(year.id, false, database);
  expect((await database.sessions.get(input.id))?.archived).toBe(false);
  const other = { id: "", name: "Other", archived: false };
  await database.academicYears.add(other);
  const destination = { ...subject, id: "", academicYearId: other.id };
  await database.subjects.add(destination);
  await moveSessions([input.id], destination.id, database);
  expect((await database.sessions.get(input.id))?.academicYearId).toBe(other.id);
  await deleteAcademicYearCascade(other.id, database);
  expect(await database.sessions.count()).toBe(0);
  expect(sqlite.prepare("SELECT * FROM session_pauses").all()).toEqual([]);
  expect(sqlite.prepare("SELECT * FROM session_sources").all()).toEqual([]);
  sqlite.close();
});
