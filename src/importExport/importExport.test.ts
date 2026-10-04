import { expect, it } from "vitest";
import { createTestDatabase } from "../storage/testDatabase";
import { createSession } from "../data";
import { createBackup, validateBackup, restoreBackup } from "./backup";
import { exportSessionsCsv, previewCsv, importCsvPreview, parseCsv, escapeCsv } from "./csv";
import { logicalBackup } from "./backupFormat";
import { readNormalized } from "../storage/migration";
async function seeded() {
  const test = createTestDatabase();
  const year = { id: "", name: "Year", archived: false };
  await test.database.academicYears.add(year);
  const subject = { id: "", name: "Subject", academicYearId: year.id, color: "#ff7eb6", archived: false };
  await test.database.subjects.add(subject);
  const session = await createSession(
    { academicYear: year, subject, startTime: 1000, endTime: 6000, note: 'A "quoted", note\nSecond line' },
    test.database,
  );
  await test.database.settings.put({ key: "defaultSubjectId", value: subject.id });
  return { ...test, year, subject, session };
}
it("exports normalized backups and remaps all IDs/defaults into an existing database", async () => {
  const source = await seeded(),
    target = await seeded();
  await target.database.academicYears.update(target.year.id, { name: "Unrelated" });
  const backup = validateBackup(await createBackup(source.database));
  expect(backup.formatVersion).toBe(2);
  expect(backup.data.subjects[0]).toMatchObject({ id: 1, academicYearId: 1, colorId: 5 });
  expect(backup.data.sessions[0]).toMatchObject({ id: 1, subjectId: 1, startedAt: 1, elapsedSeconds: 5, pauses: [] });
  for (const key of [
    "endTime",
    "focusedDurationSeconds",
    "subjectName",
    "academicYearId",
    "archived",
    "focusIntervals",
  ])
    expect(backup.data.sessions[0]).not.toHaveProperty(key);
  await restoreBackup(backup, "merge", "use-imported", target.database);
  const data = await readNormalized(target.database);
  expect(data.academicYears).toHaveLength(2);
  expect(data.sessions).toHaveLength(2);
  const imported = data.sessions.find((row) => row.sourceIdentity === backup.data.sessions[0].sourceIdentity)!;
  expect(imported.subjectId).not.toBe(1);
  expect((await target.database.settings.get("defaultSubjectId"))?.value).toBe(String(imported.subjectId));
  const repeat = await restoreBackup(backup, "merge", "keep-existing", target.database);
  expect(repeat.sessionsImported).toBe(0);
  expect(await target.database.sessions.count()).toBe(2);
  source.sqlite.close();
  target.sqlite.close();
});
it("imports legacy backup relationships, palette colors, archive intent and precise intervals", async () => {
  const backup = validateBackup({
    format: "focus-backup",
    formatVersion: 1,
    exportedAt: "2026-01-01",
    appVersion: "old",
    data: {
      academicYears: [{ id: "y", name: "Year", archived: true }],
      subjects: [
        {
          id: "s",
          name: "Subject",
          academicYearId: "y",
          color: "#ff7eb6",
          archived: true,
          archivedBeforeParent: false,
        },
      ],
      sessions: [
        {
          id: "f",
          subjectId: "s",
          startTime: 1000,
          endTime: 6000,
          focusedDurationSeconds: 3,
          focusIntervals: [
            { startTime: 1000, endTime: 2000 },
            { startTime: 4000, endTime: 6000 },
          ],
          note: "Note",
        },
      ],
      settings: [{ key: "defaultSubjectId", value: "s" }],
    },
  });
  const { database, sqlite } = createTestDatabase();
  await restoreBackup(backup, "replace", "use-imported", database);
  const data = await readNormalized(database);
  expect(data.subjects[0]).toMatchObject({ archived: false, colorId: 5 });
  expect(data.sessions[0].pauses).toEqual([{ offsetSeconds: 1, durationSeconds: 2 }]);
  expect((await database.sessions.toArray())[0].archived).toBe(true);
  sqlite.close();
});
it("rejects corrupt backups and rolls back a failed replace", async () => {
  const source = await seeded(),
    backup = validateBackup(await createBackup(source.database));
  expect(() => validateBackup({ format: "shunhen-backup", formatVersion: 99 })).toThrow("Unsupported");
  expect(() =>
    validateBackup({ ...logicalBackup(backup), sessions: [{ ...logicalBackup(backup).sessions[0], subjectId: 999 }] }),
  ).toThrow("relationship");
  source.sqlite.exec("CREATE TRIGGER fail_subject BEFORE INSERT ON subjects BEGIN SELECT RAISE(ABORT,'failed'); END");
  await expect(restoreBackup(backup, "replace", "use-imported", source.database)).rejects.toThrow("failed");
  expect(await source.database.sessions.count()).toBe(1);
  source.sqlite.close();
});
it("round-trips normalized CSV, including notes, and uses source identities for duplicate detection", async () => {
  const source = await seeded(),
    { database, sqlite } = createTestDatabase();
  const csv = exportSessionsCsv(await source.database.sessions.toArray());
  const preview = await previewCsv(csv, undefined, undefined, database);
  expect(preview.recognizedFocusCsv).toBe(true);
  expect(preview.rows[0].errors).toEqual([]);
  expect((await importCsvPreview(preview, database)).sessionsImported).toBe(1);
  expect((await database.sessions.toArray())[0].note).toBe(source.session.note);
  expect(
    (await importCsvPreview(await previewCsv(csv, undefined, undefined, database), database)).duplicatesSkipped,
  ).toBe(1);
  source.sqlite.close();
  sqlite.close();
});
it("retains distinct source sessions at identical second-level timing", async () => {
  const source = await seeded(),
    { database, sqlite } = createTestDatabase();
  const row = (await source.database.sessions.toArray())[0];
  const csv = exportSessionsCsv([row, { ...row, id: "2", sourceIdentity: "session:different-source:2" }]);
  expect(
    (await importCsvPreview(await previewCsv(csv, undefined, undefined, database), database)).sessionsImported,
  ).toBe(2);
  expect(await database.sessions.count()).toBe(2);
  source.sqlite.close();
  sqlite.close();
});
it("keeps legacy Shunhen CSV and mapped generic CSV importable", async () => {
  const { database, sqlite } = createTestDatabase();
  const csv =
    "Session ID,Academic Year,Subject,Start Date,Start Time,End Date,End Time,Focused Minutes,Archived,Note\nf_old,Year,Subject,2026-01-01,23:30,2026-01-02,01:30,60,false,Old";
  const preview = await previewCsv(csv, undefined, undefined, database);
  expect(preview.rows[0].errors).toEqual([]);
  await importCsvPreview(preview, database);
  expect((await database.sessions.toArray())[0].focusedDurationSeconds).toBe(3600);
  const generic = "Year,Subject,Start,End,Notes\nYear,Subject,2026-01-02T12:00:00,2026-01-02T12:01:00,Generic";
  expect(
    (await importCsvPreview(await previewCsv(generic, undefined, undefined, database), database)).sessionsImported,
  ).toBe(1);
  expect(parseCsv('A,B\n"quoted, value",B').records[0].A).toBe("quoted, value");
  expect(escapeCsv('a"b')).toBe('"a""b"');
  sqlite.close();
});

it("preserves distinct parents with identical names and explicit numeric source identities", async () => {
  const source = await seeded(),
    backup = validateBackup(await createBackup(source.database)),
    { database, sqlite } = createTestDatabase();
  backup.data.academicYears.push({ ...backup.data.academicYears[0], id: 2 });
  backup.data.subjects.push({ ...backup.data.subjects[0], id: 2, academicYearId: 2 });
  backup.data.sessions.push({ ...backup.data.sessions[0], id: 2, subjectId: 2, sourceIdentity: "session:123" });
  const summary = await restoreBackup(backup, "replace", "use-imported", database);
  expect(summary.academicYearsCreated).toBe(2);
  expect(summary.subjectsCreated).toBe(2);
  expect(await database.sessions.count()).toBe(2);
  const first = await database.sessions.getBySource("session:123");
  expect(first).toBeDefined();
  await expect(restoreBackup(backup, "merge", "keep-existing", database)).rejects.toThrow("Ambiguous Academic Year");
  expect(await database.sessions.count()).toBe(2);
  source.sqlite.close();
  sqlite.close();
});
it("retains pause timing on normalized manual imports and clears deleted Subject defaults", async () => {
  const source = await seeded(),
    backup = validateBackup(await createBackup(source.database)),
    { database, sqlite } = createTestDatabase();
  backup.data.sessions[0].pauses = [{ offsetSeconds: 1, durationSeconds: 2 }];
  await restoreBackup(backup, "replace", "use-imported", database);
  const data = await readNormalized(database);
  expect(data.sessions[0].pauses).toEqual([{ offsetSeconds: 1, durationSeconds: 2 }]);
  await database.settings.put({ key: "lastSubjectId", value: String(data.subjects[0].id) });
  await database.subjects.delete(String(data.subjects[0].id));
  expect((await database.settings.get("defaultSubjectId"))?.value).toBe("");
  expect((await database.settings.get("lastSubjectId"))?.value).toBe("");
  expect((await createBackup(database)).sessions).toEqual([]);
  source.sqlite.close();
  sqlite.close();
});
