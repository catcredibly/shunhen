import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createTestDatabase } from "../storage/testDatabase";
import { readNormalized } from "../storage/migration";
import { createBackup, validateBackup, restoreBackup, APP_VERSION } from "./backup";
import type { FocusBackup } from "./types";

function portable(): FocusBackup {
  return {
    format: "shunhen-backup",
    formatVersion: 2,
    appVersion: APP_VERSION,
    academicYears: [{ id: 4, name: "Year", startDate: "2026-02-01", endDate: "2026-12-15", archived: true }],
    subjects: [{ id: 9, academicYearId: 4, name: "Physics", colorId: 11, archived: false }],
    sessions: [
      {
        id: 20,
        sourceIdentity: "session:paused",
        subjectId: 9,
        startedAt: 1791180000,
        elapsedSeconds: 7200,
        manual: false,
        note: "Saved\nNote",
        pauses: [{ offsetSeconds: 1800, durationSeconds: 300 }],
      },
      {
        id: 21,
        sourceIdentity: "session:continuous",
        subjectId: 9,
        startedAt: 1791180000,
        elapsedSeconds: 7200,
        manual: true,
        pauses: [],
      },
    ],
    settings: {
      defaultSubjectId: "9",
      lastSubjectId: "9",
      currentAcademicYearId: "4",
      dailyGoalSeconds: "7200",
      "goalCompletion.daily": "1791180000",
      customPreference: "preserved",
    },
  };
}

it("exports only the logical v2 model, with nested pauses and an object of Settings", async () => {
  const { database, sqlite } = createTestDatabase();
  try {
    await restoreBackup(validateBackup(portable()), "replace", "use-imported", database);
    const exported = JSON.parse(JSON.stringify(await createBackup(database)));
    expect(exported).toMatchObject({ format: "shunhen-backup", formatVersion: 2, appVersion: APP_VERSION });
    for (const field of ["data", "sessionPauses", "sessionTimingVersion", "storage_metadata", "session_sources"])
      expect(exported).not.toHaveProperty(field);
    expect(Array.isArray(exported.settings)).toBe(false);
    const paused = exported.sessions.find((row: { note?: string }) => row.note === "Saved\nNote");
    expect(Object.keys(paused).sort()).toEqual(
      ["id", "sourceIdentity", "subjectId", "startedAt", "elapsedSeconds", "manual", "note", "pauses"].sort(),
    );
    expect(paused.pauses).toEqual([{ offsetSeconds: 1800, durationSeconds: 300 }]);
    expect(exported.sessions.find((row: { manual: boolean }) => row.manual).pauses).toEqual([]);
    expect(exported.subjects[0]).toMatchObject({ colorId: 11, archived: false });
    expect(exported.subjects[0]).not.toHaveProperty("color");
    expect(exported.academicYears[0].startDate).toBe("2026-02-01");
    expect(validateBackup(exported).data.sessions).toHaveLength(2);
  } finally {
    sqlite.close();
  }
});

it("round-trips relationships, pauses, notes, archives, defaults and goals with different local IDs", async () => {
  const source = createTestDatabase(),
    target = createTestDatabase();
  try {
    await restoreBackup(validateBackup(portable()), "replace", "use-imported", source.database);
    const dummyYear = { id: "", name: "Unrelated", archived: false };
    await target.database.academicYears.add(dummyYear);
    await target.database.subjects.add({
      id: "",
      academicYearId: dummyYear.id,
      name: "Unrelated",
      color: "#4da3ff",
      archived: false,
    });
    await restoreBackup(validateBackup(await createBackup(source.database)), "merge", "use-imported", target.database);
    const result = await readNormalized(target.database);
    const year = result.academicYears.find((row) => row.name === "Year")!;
    const subject = result.subjects.find((row) => row.name === "Physics")!;
    expect(year.id).not.toBe(1);
    expect(subject).toMatchObject({ academicYearId: year.id, colorId: 11, archived: false });
    expect(result.sessions.every((row) => row.subjectId === subject.id)).toBe(true);
    expect(result.sessions.find((row) => row.note)?.pauses).toEqual(portable().sessions[0].pauses);
    const settings = Object.fromEntries(result.settings.map((row) => [row.key, row.value]));
    expect(settings).toMatchObject({
      defaultSubjectId: String(subject.id),
      lastSubjectId: String(subject.id),
      currentAcademicYearId: String(year.id),
      dailyGoalSeconds: "7200",
      "goalCompletion.daily": "1791180000",
      customPreference: "preserved",
    });
    expect((await target.database.sessions.toArray()).every((row) => row.archived)).toBe(true);
  } finally {
    source.sqlite.close();
    target.sqlite.close();
  }
});

it.each([
  [
    "missing year",
    (value: FocusBackup) => {
      value.subjects[0].academicYearId = 999;
    },
  ],
  [
    "missing Subject",
    (value: FocusBackup) => {
      value.sessions[0].subjectId = 999;
    },
  ],
  [
    "duplicate ID",
    (value: FocusBackup) => {
      value.sessions[1].id = value.sessions[0].id;
    },
  ],
  [
    "fractional start",
    (value: FocusBackup) => {
      value.sessions[0].startedAt += 0.5;
    },
  ],
  [
    "millisecond start",
    (value: FocusBackup) => {
      value.sessions[0].startedAt = 1e14;
    },
  ],
  [
    "invalid duration",
    (value: FocusBackup) => {
      value.sessions[0].elapsedSeconds = 0;
    },
  ],
  [
    "negative pause",
    (value: FocusBackup) => {
      value.sessions[0].pauses[0].offsetSeconds = -1;
    },
  ],
  [
    "zero pause",
    (value: FocusBackup) => {
      value.sessions[0].pauses[0].durationSeconds = 0;
    },
  ],
  [
    "overlapping pauses",
    (value: FocusBackup) => {
      value.sessions[0].pauses.push({ offsetSeconds: 1900, durationSeconds: 300 });
    },
  ],
  [
    "unordered pauses",
    (value: FocusBackup) => {
      value.sessions[0].pauses.push({ offsetSeconds: 1000, durationSeconds: 300 });
    },
  ],
  [
    "out-of-range pause",
    (value: FocusBackup) => {
      value.sessions[0].pauses[0].durationSeconds = 7200;
    },
  ],
  [
    "invalid color",
    (value: FocusBackup) => {
      value.subjects[0].colorId = 12;
    },
  ],
  [
    "invalid date",
    (value: FocusBackup) => {
      value.academicYears[0].startDate = "2026-02-30";
    },
  ],
  [
    "reversed dates",
    (value: FocusBackup) => {
      value.academicYears[0].endDate = "2026-01-01";
    },
  ],
  [
    "stale default",
    (value: FocusBackup) => {
      value.settings.defaultSubjectId = "999";
    },
  ],
  [
    "stale year setting",
    (value: FocusBackup) => {
      value.settings.currentAcademicYearId = "999";
    },
  ],
] as const)("rejects %s before any mutation", async (_label, corrupt) => {
  const { database, sqlite } = createTestDatabase();
  try {
    await database.settings.put({ key: "existing", value: "intact" });
    const before = await readNormalized(database);
    const value = portable();
    corrupt(value);
    await expect(
      Promise.resolve().then(() => restoreBackup(validateBackup(value), "replace", "use-imported", database)),
    ).rejects.toThrow();
    expect(await readNormalized(database)).toEqual(before);
  } finally {
    sqlite.close();
  }
});

it("rolls back parents, Sessions, pauses and Settings after a failed Session write", async () => {
  const { database, sqlite } = createTestDatabase();
  try {
    await database.settings.put({ key: "existing", value: "intact" });
    const before = await readNormalized(database);
    sqlite.exec(
      "CREATE TRIGGER fail_pause BEFORE INSERT ON session_pauses BEGIN SELECT RAISE(ABORT,'pause failure'); END",
    );
    await expect(restoreBackup(validateBackup(portable()), "replace", "use-imported", database)).rejects.toThrow(
      "pause failure",
    );
    expect(await readNormalized(database)).toEqual(before);
  } finally {
    sqlite.close();
  }
});

it("preserves identical-second Sessions without explicit identities and skips only repeated backup identities", async () => {
  const { database, sqlite } = createTestDatabase();
  try {
    const value = portable();
    for (const session of value.sessions) delete session.sourceIdentity;
    value.sessions[1] = { ...value.sessions[0], id: 21, pauses: structuredClone(value.sessions[0].pauses) };
    const parsed = validateBackup(value);
    expect((await restoreBackup(parsed, "merge", "use-imported", database)).sessionsImported).toBe(2);
    expect((await restoreBackup(parsed, "merge", "keep-existing", database)).sessionsImported).toBe(0);
    expect(await database.sessions.count()).toBe(2);
  } finally {
    sqlite.close();
  }
});

it("uses explicit separate legacy and v2 parsers", () => {
  const value = portable();
  expect(() => validateBackup({ ...value, formatVersion: 1 })).toThrow("legacy");
  expect(() => validateBackup({ ...value, data: {}, sessionTimingVersion: 1 })).toThrow("Unexpected");
  expect(() => validateBackup({ ...value, sessions: [{ ...value.sessions[0], endTime: 1000 }] })).toThrow("Unexpected");
  const legacy = validateBackup({
    format: "focus-backup",
    formatVersion: 1,
    appVersion: "old",
    data: {
      academicYears: [{ id: "y", name: "Year", archived: false }],
      subjects: [{ id: "s", academicYearId: "y", name: "Subject", color: "#4da3ff", archived: false }],
      sessions: [
        {
          id: "a",
          subjectId: "s",
          startTime: 100420,
          endTime: 200810,
          focusedDurationSeconds: 79.64,
          focusIntervals: [
            { startTime: 100420, endTime: 125610 },
            { startTime: 146360, endTime: 200810 },
          ],
        },
        { id: "b", subjectId: "s", startTime: 100420, endTime: 200810, focusedDurationSeconds: 20 },
      ],
      settings: [{ key: "defaultSubjectId", value: "s" }],
    },
  });
  expect(legacy.data.sessions[0]).toMatchObject({
    startedAt: 100,
    elapsedSeconds: 101,
    pauses: [{ offsetSeconds: 26, durationSeconds: 20 }],
  });
  expect(legacy.data.sessions[1]).toMatchObject({ startedAt: 100, elapsedSeconds: 20, pauses: [] });
});

it("ships a valid demo in the logical v2 format", () => {
  const demo = JSON.parse(readFileSync(new URL("../../docs/demo/shunhen-demo.json", import.meta.url), "utf8"));
  expect(demo).toMatchObject({ format: "shunhen-backup", formatVersion: 2, appVersion: APP_VERSION });
  expect(demo).not.toHaveProperty("data");
  expect(demo).not.toHaveProperty("sessionTimingVersion");
  const parsed = validateBackup(demo);
  expect(parsed.data.sessions.length).toBeGreaterThan(0);
  expect(parsed.data.sessions.some((row) => row.pauses.length)).toBe(true);
});
