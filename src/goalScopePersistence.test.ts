import { expect, it } from "vitest";
import { createTestDatabase } from "./storage/testDatabase";
import { loadSettings, saveSetting, restoreSettingDefaults, DEFAULT_SETTINGS } from "./settings";
import { ALL_SCOPE } from "./linkedScope";
import { createBackup, restoreBackup, validateBackup } from "./importExport/backup";
const portable = () => ({
  format: "shunhen-backup",
  formatVersion: 2,
  appVersion: "3.1.1",
  academicYears: [
    { id: 1, name: "IB", archived: false },
    { id: 2, name: "University", archived: false },
  ],
  subjects: [
    { id: 11, academicYearId: 1, name: "Physics", colorId: 0, archived: false },
    { id: 21, academicYearId: 2, name: "Engineering", colorId: 1, archived: false },
  ],
  sessions: [],
  settings: { goalScope: JSON.stringify({ yearIds: ["1"], subjectIds: ["11"] }) },
});
it("defaults missing or malformed scope to All and persists structured scope across unrelated changes and reload", async () => {
  const { database, sqlite } = createTestDatabase();
  try {
    expect((await loadSettings(database, false)).goalScope).toEqual(ALL_SCOPE);
    const scope = { yearIds: ["1"], subjectIds: ["11"] };
    await saveSetting("goalScope", scope, database);
    await saveSetting("theme", "light", database);
    expect((await loadSettings(database, false)).goalScope).toEqual(scope);
    expect(JSON.parse((await database.settings.get("goalScope"))!.value)).toEqual(scope);
    await database.settings.put({ key: "goalScope", value: "broken" });
    expect((await loadSettings(database, false)).goalScope).toEqual(DEFAULT_SETTINGS.goalScope);
  } finally {
    sqlite.close();
  }
});
it("exports structured scope and remaps IDs when restoring into an existing database", async () => {
  const { database, sqlite } = createTestDatabase();
  try {
    await database.academicYears.add({ id: "", name: "Existing", archived: false });
    await database.subjects.add({ id: "", academicYearId: "1", name: "Existing", color: "#4da3ff", archived: false });
    await restoreBackup(validateBackup(portable()), "merge", "use-imported", database);
    const years = await database.academicYears.toArray(),
      subjects = await database.subjects.toArray();
    const year = years.find((row) => row.name === "IB")!,
      subject = subjects.find((row) => row.name === "Physics")!;
    expect(year.id).not.toBe("1");
    expect(subject.id).not.toBe("11");
    const settings = await loadSettings(database, false);
    expect(settings.goalScope.yearIds).toEqual([year.id]);
    expect(settings.goalScope.subjectIds).toEqual([subject.id]);
    const backup = await createBackup(database);
    expect(JSON.parse(backup.settings.goalScope)).toEqual(settings.goalScope);
    const second = createTestDatabase();
    try {
      await restoreBackup(validateBackup(backup), "replace", "use-imported", second.database);
      const restored = await loadSettings(second.database, false);
      const restoredSubject = (await second.database.subjects.toArray()).find((row) => row.name === "Physics")!;
      expect(restored.goalScope.subjectIds).toEqual([restoredSubject.id]);
    } finally {
      second.sqlite.close();
    }
  } finally {
    sqlite.close();
  }
});
it("old backups without scope continue using All", async () => {
  const { database, sqlite } = createTestDatabase();
  try {
    const backup = portable();
    backup.settings = {} as typeof backup.settings;
    await restoreBackup(validateBackup(backup), "replace", "use-imported", database);
    expect((await loadSettings(database, false)).goalScope).toEqual(ALL_SCOPE);
  } finally {
    sqlite.close();
  }
});

it("section defaults restore semantic All without enumerating Subjects", async () => {
  const { database, sqlite } = createTestDatabase();
  try {
    await saveSetting("goalScope", { yearIds: ["1"], subjectIds: ["11"] }, database);
    await restoreSettingDefaults(["goalScope"], database);
    expect((await loadSettings(database, false)).goalScope).toEqual(ALL_SCOPE);
    const backup = await createBackup(database);
    expect(JSON.parse(backup.settings.goalScope)).toEqual({ yearIds: [], subjectIds: [] });
  } finally {
    sqlite.close();
  }
});
