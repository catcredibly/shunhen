import { expect, it } from "vitest";
import { createTestDatabase } from "./storage/testDatabase";
import { loadSettings, saveSetting } from "./settings";
import { goalSubjectSelection, matchesGoalScope, refineGoalSubjects } from "./goalScope";
import { createBackup, restoreBackup, validateBackup } from "./importExport/backup";
import { goalScopeSessions } from "./goals";
const fixture = async () => {
  const test = createTestDatabase();
  for (const [id, name] of [
    ["1", "IB"],
    ["2", "Gap Year"],
    ["3", "University"],
  ])
    await test.database.academicYears.add({ id, name, archived: false });
  for (const [id, academicYearId, name] of [
    ["11", "1", "Physics"],
    ["12", "1", "Economics"],
    ["21", "2", "Gap"],
    ["31", "3", "Engineering"],
  ])
    await test.database.subjects.add({ id, academicYearId, name, color: "#4da3ff", archived: false });
  await saveSetting("goalScope", { yearIds: ["1", "3"], subjectIds: ["11", "31"] }, test.database);
  return test;
};
it("creation includes a new year without selecting an excluded year or restoring excluded Subjects", async () => {
  const { database, sqlite } = await fixture();
  try {
    const year = { id: "", name: "University 2", archived: false };
    await database.academicYears.add(year);
    await database.subjects.add({
      id: "",
      academicYearId: year.id,
      name: "Programming",
      color: "#4da3ff",
      archived: false,
    });
    const scope = (await loadSettings(database, false)).goalScope,
      subjects = await database.subjects.toArray();
    expect(scope.yearIds).toEqual(["1", "3", year.id]);
    expect(scope.yearIds).not.toContain("2");
    expect(
      matchesGoalScope(
        scope,
        subjects.find((row) => row.name === "Programming")!,
      ),
    ).toBe(true);
    expect(
      matchesGoalScope(
        scope,
        subjects.find((row) => row.name === "Economics")!,
      ),
    ).toBe(false);
    expect(
      matchesGoalScope(
        scope,
        subjects.find((row) => row.name === "Gap")!,
      ),
    ).toBe(false);
    expect(JSON.parse((await database.settings.get("goalScope"))!.value)).toEqual(scope);
    expect((await loadSettings(database, false)).goalScope).toEqual(scope);
  } finally {
    sqlite.close();
  }
});
it("reactivation includes even an excluded year, without resetting other refinements", async () => {
  const { database, sqlite } = await fixture();
  try {
    await database.academicYears.update("2", { archived: true });
    await database.academicYears.update("2", { archived: false });
    const scope = (await loadSettings(database, false)).goalScope,
      subjects = await database.subjects.toArray();
    expect(scope.yearIds).toEqual(["1", "3", "2"]);
    expect(
      matchesGoalScope(
        scope,
        subjects.find((row) => row.id === "21")!,
      ),
    ).toBe(true);
    expect(
      matchesGoalScope(
        scope,
        subjects.find((row) => row.id === "12")!,
      ),
    ).toBe(false);
    await database.academicYears.update("2", { archived: true });
    const startTime = Date.now();
    const session = {
      id: "1",
      subjectId: "21",
      academicYearId: "2",
      subjectName: "Gap",
      academicYearName: "Gap Year",
      startTime,
      endTime: startTime + 60000,
      focusedDurationSeconds: 60,
      archived: false,
    };
    expect(goalScopeSessions([session], await database.academicYears.toArray(), subjects, scope)).toEqual([]);
    await database.academicYears.update("2", { archived: false });
    expect(
      goalScopeSessions(
        [session],
        await database.academicYears.toArray(),
        subjects,
        (await loadSettings(database, false)).goalScope,
      ),
    ).toHaveLength(1);
  } finally {
    sqlite.close();
  }
});
it("newly active Subjects in an automatic year join dynamically, while preserving other Subject exceptions", async () => {
  const { database, sqlite } = await fixture();
  try {
    await database.academicYears.update("2", { archived: true });
    await database.academicYears.update("2", { archived: false });
    const added = { id: "", academicYearId: "2", name: "New", color: "#4da3ff", archived: false };
    await database.subjects.add(added);
    let scope = (await loadSettings(database, false)).goalScope;
    expect(matchesGoalScope(scope, added)).toBe(true);
    await database.subjects.update(added.id, { archived: true });
    await database.subjects.update(added.id, { archived: false });
    expect(matchesGoalScope(scope, (await database.subjects.get(added.id))!)).toBe(true);
    const subjects = await database.subjects.toArray();
    const selected = goalSubjectSelection(scope, subjects);
    expect(selected).toContain(added.id);
    scope = refineGoalSubjects(
      scope,
      { yearIds: scope.yearIds, subjectIds: selected.filter((id) => id !== "21") },
      subjects,
    );
    expect(
      matchesGoalScope(
        scope,
        subjects.find((row) => row.id === "21")!,
      ),
    ).toBe(false);
    const later = { id: "", academicYearId: "2", name: "Later", color: "#4da3ff", archived: false };
    await database.subjects.add(later);
    expect(matchesGoalScope(scope, later)).toBe(true);
    await saveSetting("goalScope", scope, database);
    await database.subjects.update("21", { archived: true });
    await database.subjects.update("21", { archived: false });
    const reactivated = (await loadSettings(database, false)).goalScope;
    expect(matchesGoalScope(reactivated, (await database.subjects.get("21"))!)).toBe(true);
    expect(matchesGoalScope(reactivated, (await database.subjects.get("12"))!)).toBe(false);
  } finally {
    sqlite.close();
  }
});
it("All years with custom Subjects also include new-year Subjects, and renames do not undo exclusions", async () => {
  const { database, sqlite } = await fixture();
  try {
    await saveSetting("goalScope", { yearIds: [], subjectIds: ["11"] }, database);
    await database.academicYears.update("2", { name: "Renamed" });
    expect((await loadSettings(database, false)).goalScope.automaticYearIds).toBeUndefined();
    const year = { id: "", name: "New", archived: false };
    await database.academicYears.add(year);
    const subject = { id: "", academicYearId: year.id, name: "New Subject", color: "#4da3ff", archived: false };
    await database.subjects.add(subject);
    const scope = (await loadSettings(database, false)).goalScope;
    expect(scope.yearIds).toEqual([]);
    expect(matchesGoalScope(scope, subject)).toBe(true);
    expect(matchesGoalScope(scope, (await database.subjects.get("12"))!)).toBe(false);
  } finally {
    sqlite.close();
  }
});
it("automatic metadata survives backup remapping and an aborted transaction imports nothing", async () => {
  const { database, sqlite } = await fixture();
  try {
    await expect(
      database.transaction("rw", async (tx) => {
        await tx.academicYears.add({ id: "", name: "Failed", archived: false });
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");
    expect((await database.academicYears.toArray()).some((row) => row.name === "Failed")).toBe(false);
    expect((await loadSettings(database, false)).goalScope).toEqual({ yearIds: ["1", "3"], subjectIds: ["11", "31"] });
    const year = { id: "", name: "Automatic", archived: false };
    await database.academicYears.add(year);
    const subject = { id: "", academicYearId: year.id, name: "Automatic Subject", color: "#4da3ff", archived: false };
    await database.subjects.add(subject);
    const configured = (await loadSettings(database, false)).goalScope;
    await saveSetting(
      "goalScope",
      refineGoalSubjects(
        configured,
        { yearIds: configured.yearIds, subjectIds: configured.subjectIds },
        await database.subjects.toArray(),
      ),
      database,
    );
    const backup = await createBackup(database),
      target = createTestDatabase();
    try {
      await target.database.academicYears.add({ id: "", name: "Existing", archived: false });
      await restoreBackup(validateBackup(backup), "merge", "use-imported", target.database);
      const restoredYear = (await target.database.academicYears.toArray()).find((row) => row.name === "Automatic")!;
      expect((await loadSettings(target.database, false)).goalScope.automaticYearIds).toContain(restoredYear.id);
      expect(restoredYear.id).not.toBe(year.id);
      const restoredSubject = (await target.database.subjects.toArray()).find(
        (row) => row.name === "Automatic Subject",
      )!;
      expect((await loadSettings(target.database, false)).goalScope.excludedAutomaticSubjectIds).toContain(
        restoredSubject.id,
      );
    } finally {
      target.sqlite.close();
    }
  } finally {
    sqlite.close();
  }
});

it.each(["archive", "delete"])(
  "%s of the final included active year recovers to All years and Subjects",
  async (action) => {
    const { database, sqlite } = await fixture();
    try {
      await saveSetting("goalScope", { yearIds: ["1"], subjectIds: ["11"] }, database);
      if (action === "archive") await database.academicYears.update("1", { archived: true });
      else await database.academicYears.delete("1");
      expect((await loadSettings(database, false)).goalScope).toEqual({ yearIds: [], subjectIds: [] });
      expect(JSON.parse((await database.settings.get("goalScope"))!.value)).toEqual({ yearIds: [], subjectIds: [] });
    } finally {
      sqlite.close();
    }
  },
);
it("no active years temporarily means no eligible Sessions, and reactivation includes its Subjects", async () => {
  const { database, sqlite } = await fixture();
  try {
    await database.academicYears.update("2", { archived: true });
    await database.academicYears.update("3", { archived: true });
    await saveSetting("goalScope", { yearIds: ["1"], subjectIds: ["11"] }, database);
    await database.academicYears.update("1", { archived: true });
    const scope = (await loadSettings(database, false)).goalScope;
    expect(
      goalScopeSessions([], await database.academicYears.toArray(), await database.subjects.toArray(), scope),
    ).toEqual([]);
    await database.academicYears.update("2", { archived: false });
    const recovered = (await loadSettings(database, false)).goalScope;
    expect(matchesGoalScope(recovered, (await database.subjects.get("21"))!)).toBe(true);
  } finally {
    sqlite.close();
  }
});
it("an exhausted custom Subject selection recovers to All Subjects without choosing an arbitrary Subject", async () => {
  const { database, sqlite } = await fixture();
  try {
    await saveSetting("goalScope", { yearIds: ["1"], subjectIds: ["11"] }, database);
    await database.subjects.update("11", { archived: true });
    expect((await loadSettings(database, false)).goalScope).toEqual({ yearIds: ["1"], subjectIds: [] });
  } finally {
    sqlite.close();
  }
});
