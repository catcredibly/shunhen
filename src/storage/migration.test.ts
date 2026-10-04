import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { createTestDatabase } from "./testDatabase";
import { initializeStorage, readNormalized } from "./migration";
import { readLegacy, deleteLegacy } from "./legacy";
import { normalizeLegacy, nearestSecond, normalizeTiming, COLOR_PALETTE, type LegacyData } from "./model";
import { setAcademicYearArchived, moveSessions, deleteAcademicYearCascade, saveAcademicYearEdit } from "../management";
import { saveFocusSession } from "../saveFocusSession";
import { ACTIVE_TIMER_STORAGE_KEY } from "../timerState";

function legacy(): LegacyData {
  return {
    academicYears: [{ id: "y", name: "Year", startDate: "2026-01-01", endDate: "2026-12-31", archived: true }],
    subjects: [
      {
        id: "s",
        academicYearId: "y",
        name: "Subject",
        color: COLOR_PALETTE[7],
        archived: true,
        archivedBeforeParent: false,
      },
    ],
    sessions: [
      {
        id: "f",
        subjectId: "s",
        academicYearId: "stale",
        academicYearName: "Old",
        subjectName: "Old",
        archived: false,
        startTime: 100_420,
        endTime: 200_810,
        focusedDurationSeconds: 79.64,
        focusIntervals: [
          { startTime: 100_420, endTime: 125_610 },
          { startTime: 146_360, endTime: 200_810 },
        ],
        note: "Saved note",
      },
    ],
    settings: [
      { key: "defaultSubjectId", value: "s" },
      { key: "lastSubjectId", value: "s" },
      { key: "dailyGoalSeconds", value: "7200" },
      { key: "goalCompletion.daily", value: "100000" },
    ],
  };
}
async function fixture(name: string, data = legacy()) {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name, 6);
    request.onupgradeneeded = () => {
      for (const table of ["academicYears", "subjects", "sessions", "settings"] as const) {
        request.result.createObjectStore(table, { keyPath: table === "settings" ? "key" : "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const tables = ["academicYears", "subjects", "sessions", "settings"] as const;
      const transaction = database.transaction([...tables], "readwrite");
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error);
      for (const table of tables) {
        for (const row of data[table]) transaction.objectStore(table).add(row);
      }
    });
  } finally {
    database.close();
  }
}
describe("SQLite upgrade", () => {
  it("rounds absolute boundaries with deterministic ties and converts Focus gaps", () => {
    expect([nearestSecond(500), nearestSecond(-500), nearestSecond(1499), nearestSecond(-501)]).toEqual([1, 0, 1, -1]);
    const data = normalizeLegacy(legacy()).data;
    expect(data.sessions[0]).toMatchObject({
      startedAt: 100,
      elapsedSeconds: 101,
      pauses: [{ offsetSeconds: 26, durationSeconds: 20 }],
    });
    expect(data.subjects[0]).toMatchObject({ colorId: 7, archived: false, academicYearId: 1 });
    expect(data.settings.find((row) => row.key === "defaultSubjectId")?.value).toBe("1");
    expect(
      normalizeTiming({
        startTime: 0,
        endTime: 3000,
        focusedDurationSeconds: 2.8,
        focusIntervals: [
          { startTime: 0, endTime: 1400 },
          { startTime: 1600, endTime: 3000 },
        ],
      }).pauses,
    ).toEqual([{ offsetSeconds: 1, durationSeconds: 1 }]);
    expect(
      normalizeTiming({
        startTime: 0,
        endTime: 3000,
        focusedDurationSeconds: 2.8,
        focusIntervals: [
          { startTime: 0, endTime: 1100 },
          { startTime: 1300, endTime: 3000 },
        ],
      }).pauses,
    ).toEqual([]);
    expect(normalizeTiming({ startTime: 0, endTime: 5000, focusedDurationSeconds: 2 }).pauses).toEqual([]);
    expect(normalizeTiming({ startTime: 0, endTime: 5000, focusedDurationSeconds: 2 }).elapsedSeconds).toBe(2);
  });
  it("migrates all values, validates before cleanup, discards only the old timer", async () => {
    const name = `legacy-${crypto.randomUUID()}`;
    await fixture(name);
    const { database, sqlite } = createTestDatabase(name);
    const removed: string[] = [];
    await initializeStorage(
      database,
      readLegacy,
      async (name) => {
        expect(sqlite.prepare("SELECT * FROM sessions").all()).toHaveLength(1);
        await deleteLegacy(name);
      },
      {
        removeItem: (key) => {
          removed.push(key);
        },
      },
    );
    expect(removed).toEqual([ACTIVE_TIMER_STORAGE_KEY]);
    const saved = await database.sessions.get("legacy-session:f");
    expect(saved).toMatchObject({
      id: "1",
      subjectId: "1",
      subjectName: "Subject",
      academicYearId: "1",
      academicYearName: "Year",
      archived: true,
      focusedDurationSeconds: 81,
      note: "Saved note",
    });
    expect(sqlite.prepare("SELECT * FROM sessions").get()).not.toHaveProperty("endTime");
    expect(await readLegacy(name)).toBeUndefined();
    sqlite.close();
  });
  it("leaves IndexedDB intact and retries after validation or insertion failures", async () => {
    const name = `rollback-${crypto.randomUUID()}`;
    await fixture(name);
    const { database, sqlite } = createTestDatabase(name);
    sqlite.exec("CREATE TRIGGER fail_import BEFORE INSERT ON settings BEGIN SELECT RAISE(ABORT,'failed'); END");
    await expect(initializeStorage(database)).rejects.toThrow("failed");
    expect((await readNormalized(database)).academicYears).toHaveLength(0);
    expect(sqlite.prepare("SELECT * FROM storage_metadata").all()).toEqual([]);
    const source = await readLegacy(name);
    expect(source!.data.sessions).toHaveLength(1);
    source!.close();
    sqlite.exec("DROP TRIGGER fail_import");
    await initializeStorage(database);
    expect((await readNormalized(database)).sessions).toHaveLength(1);
    sqlite.close();
  });
  it("retries cleanup without reimporting or discarding a new timer", async () => {
    const name = `cleanup-${crypto.randomUUID()}`;
    await fixture(name);
    const { database, sqlite } = createTestDatabase(name);
    const removed: string[] = [];
    await initializeStorage(
      database,
      readLegacy,
      async () => {
        throw new Error("Blocked");
      },
      {
        removeItem: (key) => {
          removed.push(key);
        },
      },
    );
    await initializeStorage(
      database,
      async () => {
        throw new Error("Must not reimport");
      },
      deleteLegacy,
      {
        removeItem: (key) => {
          removed.push(key);
        },
      },
    );
    expect(removed).toHaveLength(1);
    expect((await readNormalized(database)).sessions).toHaveLength(1);
    sqlite.close();
  });
  it("creates a fresh SQLite store without opening or leaving an IndexedDB database", async () => {
    const name = `fresh-${crypto.randomUUID()}`,
      { database, sqlite } = createTestDatabase(name);
    await initializeStorage(database);
    expect((await indexedDB.databases()).some((row) => row.name === name)).toBe(false);
    expect((await readNormalized(database)).sessions).toEqual([]);
    sqlite.close();
  });
  it("rejects missing relationships before touching either database", async () => {
    const name = `orphan-${crypto.randomUUID()}`,
      data = legacy();
    data.sessions[0].subjectId = "missing";
    await fixture(name, data);
    const { database, sqlite } = createTestDatabase(name);
    await expect(initializeStorage(database)).rejects.toThrow("relationship");
    const source = await readLegacy(name);
    expect(source).toBeDefined();
    source!.close();
    expect((await readNormalized(database)).sessions).toEqual([]);
    await deleteLegacy(name);
    sqlite.close();
  });
  it("derives renames, archives and moves and enforces cascades", async () => {
    const { database, sqlite } = createTestDatabase();
    const year = { id: "", name: "Year", archived: false };
    await database.academicYears.add(year);
    const subject = { id: "", academicYearId: year.id, name: "Subject", color: COLOR_PALETTE[0], archived: false };
    await database.subjects.add(subject);
    const input = { ...legacy().sessions[0], id: "timer-identity", subjectId: subject.id };
    input.id = await database.sessions.add(input);
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
    sqlite.close();
  });
  it("claims a live timer save once across concurrent callers", async () => {
    const { database, sqlite } = createTestDatabase();
    const year = { id: "", name: "Year", archived: false };
    await database.academicYears.add(year);
    const subject = { id: "", academicYearId: year.id, name: "Subject", color: COLOR_PALETTE[0], archived: false };
    await database.subjects.add(subject);
    const input = { ...legacy().sessions[0], id: "timer-token", subjectId: subject.id };
    await Promise.all([
      saveFocusSession({ ...input }, false, database),
      saveFocusSession({ ...input }, false, database),
    ]);
    expect(await database.sessions.count()).toBe(1);
    sqlite.close();
  });
});
