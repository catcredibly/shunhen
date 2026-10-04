import { createTestDatabase } from "./storage/testDatabase";
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { FocusDatabase } from "./db";
import { ACTIVE_TIMER_STORAGE_KEY } from "./timerState";
import {
  resetAllSettings,
  clearAllFocusData,
  DEFAULT_SETTINGS,
  GOAL_MAX_HOURS,
  formatLastBackup,
  greeting,
  hasActiveTimer,
  loadSettings,
  normaliseDuration,
  normalizeGoalSeconds,
  normalizeGoalPart,
  goalDurationSeconds,
  saveSetting,
  timerDefaultDuration,
} from "./settings";

const opened: { delete(): Promise<void> }[] = [];
const database = () => {
  const value = createTestDatabase(`focus-settings-test-${crypto.randomUUID()}`).database;
  opened.push(value);
  return value;
};
const storage = (timer: unknown = null) => {
  const values = new Map<string, string>();
  if (timer) values.set(ACTIVE_TIMER_STORAGE_KEY, JSON.stringify(timer));
  return { getItem: (key: string) => values.get(key) ?? null, removeItem: (key: string) => void values.delete(key) };
};

afterEach(async () => {
  await Promise.all(opened.splice(0).map((value) => value.delete()));
});

describe("application settings", () => {
  it("provides one complete set of defaults when keys are absent", async () => {
    expect(await loadSettings(database())).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.accentColour).toBe("orange");
    expect(DEFAULT_SETTINGS.popoutDockingEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.popoutDocked).toBe(false);
    expect(DEFAULT_SETTINGS.popoutAutoHideDelaySeconds).toBe(0.4);
    expect(DEFAULT_SETTINGS.popoutAutoHideTabSize).toBe("medium");
    expect(DEFAULT_SETTINGS.popoutAutoHideShowAccent).toBe(true);
  });

  it("persists typed preferences and falls back from invalid enum values", async () => {
    const testDb = database();
    await saveSetting("displayName", "Alex", testDb);
    await saveSetting("accentColour", "miku", testDb);
    await saveSetting("popoutAlwaysOnTop", false, testDb);
    await saveSetting("popoutTransparency", 0, testDb);
    await testDb.settings.put({ key: "uiScale", value: "enormous" });
    await testDb.settings.put({ key: "popoutAutoHideDelaySeconds", value: "-2" });
    const settings = await loadSettings(testDb);
    expect(settings.displayName).toBe("Alex");
    expect(settings.accentColour).toBe("miku");
    expect(settings.popoutAlwaysOnTop).toBe(false);
    expect(settings.popoutTransparency).toBe(0);
    expect(settings.uiScale).toBe("medium");
    expect(settings.allowDirectActiveDeletion).toBe(false);
    expect(settings.popoutAutoHideDelaySeconds).toBe(0);
    await saveSetting("allowDirectActiveDeletion", true, testDb);
    expect((await loadSettings(testDb)).allowDirectActiveDeletion).toBe(true);
  });

  it("formats contextual greetings without dangling punctuation", () => {
    expect(greeting("Alex", 8)).toBe("Good morning, Alex");
    expect(greeting("  ", 14)).toBe("Good afternoon");
    expect(greeting("Daniel", 20)).toBe("Good evening, Daniel");
  });

  it("selects remembered or fixed defaults without changing the remembered base", () => {
    const remembered = { ...DEFAULT_SETTINGS, lastTimerDurationSeconds: 45 * 60 };
    expect(timerDefaultDuration(remembered)).toBe(45 * 60);
    expect(
      timerDefaultDuration({ ...remembered, timerDurationMode: "fixed", fixedTimerDurationSeconds: 25 * 60 }),
    ).toBe(25 * 60);
    expect(normaliseDuration(0, 75, 90)).toEqual({ total: 4590, hours: 1, minutes: 16, seconds: 30 });
  });

  it("detects active and expired unfinished timers", () => {
    expect(hasActiveTimer(storage())).toBe(false);
    expect(hasActiveTimer(storage({ running: true }))).toBe(true);
    expect(hasActiveTimer(storage({ running: false, paused: false, sessionId: "session", startedAt: 1 }))).toBe(true);
  });

  it("blocks clear-all during a timer and otherwise removes every persistent table", async () => {
    const testDb = database();
    await testDb.academicYears.add({ id: "1", name: "IB", archived: false });
    await testDb.subjects.add({
      id: "1",
      academicYearId: "1",
      name: "Physics",
      color: "#ffad3b",
      archived: false,
    });
    await testDb.sessions.add({
      id: "session",
      subjectId: "1",
      subjectName: "Physics",
      academicYearId: "1",
      academicYearName: "IB",
      startTime: 1000,
      endTime: 2000,
      focusedDurationSeconds: 1,
      archived: false,
    });
    await saveSetting("displayName", "Alex", testDb);
    await expect(clearAllFocusData(testDb, storage({ paused: true }))).rejects.toThrow("Finish or stop");
    expect(await testDb.sessions.count()).toBe(1);
    await clearAllFocusData(testDb, storage());
    expect(
      await Promise.all([
        testDb.academicYears.count(),
        testDb.subjects.count(),
        testDb.sessions.count(),
        testDb.settings.count(),
      ]),
    ).toEqual([0, 0, 0, 0]);
  });

  it("formats the last backup setting defensively", () => {
    expect(formatLastBackup(null)).toBe("Never");
    expect(formatLastBackup("not-a-date")).toBe("Never");
    expect(formatLastBackup("2026-09-22T07:45:00.000Z", "en-NZ")).toContain("2026");
  });
});

describe("goal duration limits", () => {
  it.each([
    [23, 59, 86340],
    [24, 0, 86400],
    [24, 1, 86400],
    [25, 0, 86400],
    [-1, -1, 0],
    [2, 80, 10740],
  ])("normalizes %i:%i", (hours, minutes, expected) => {
    expect(goalDurationSeconds(hours, minutes)).toBe(expected);
  });
  it("allows weekly goals through 168:00 using the shared normalization", async () => {
    const maximum = GOAL_MAX_HOURS.weeklyGoalSeconds;
    expect(goalDurationSeconds(167, 59, maximum)).toBe(604740);
    for (const [hours, minutes] of [
      [168, 0],
      [168, 1],
      [169, 0],
    ])
      expect(goalDurationSeconds(hours, minutes, maximum)).toBe(604800);
    expect(normalizeGoalPart("hours", 169, maximum)).toBe(168);
    const testDb = database();
    await saveSetting("weeklyGoalSeconds", 100 * 3600, testDb);
    expect((await loadSettings(testDb)).weeklyGoalSeconds).toBe(100 * 3600);
  });
  it("clamps keyboard increments and malformed values", () => {
    expect(normalizeGoalPart("hours", 24 + 1)).toBe(24);
    expect(normalizeGoalPart("hours", 0 - 1)).toBe(0);
    expect(normalizeGoalPart("minutes", 60)).toBe(59);
    expect(normalizeGoalPart("minutes", -1)).toBe(0);
    for (const value of [NaN, Infinity, null, "garbage", ""]) expect(normalizeGoalSeconds(value)).toBe(0);
  });
  it("enforces limits at save and legacy decode boundaries", async () => {
    const testDb = database();
    for (const key of ["dailyGoalSeconds", "weeklyGoalSeconds"] as const) {
      const maximum = GOAL_MAX_HOURS[key] * 3600;
      await saveSetting(key, 999999, testDb);
      expect((await testDb.settings.get(key))?.value).toBe(String(maximum));
      await testDb.settings.put({ key, value: String(maximum + 3600) });
      expect((await loadSettings(testDb))[key]).toBe(maximum);
      for (const value of ["null", "NaN", "garbage", ""]) {
        await testDb.settings.put({ key, value });
        expect((await loadSettings(testDb))[key]).toBe(DEFAULT_SETTINGS[key]);
      }
    }
  });
});

it("applies new defaults only to missing values and preserves saved preferences", async () => {
  const testDb = database();
  expect(await loadSettings(testDb)).toMatchObject({
    dailyGoalEnabled: true,
    dailyGoalSeconds: 7200,
    weeklyGoalEnabled: true,
    weeklyGoalSeconds: 43200,
    popoutRevealShortcut: "Ctrl+Alt+KeyF",
    weekdayStyle: "short",
  });
  for (const key of ["dailyGoalEnabled", "weeklyGoalEnabled"] as const) await saveSetting(key, false, testDb);
  await saveSetting("popoutRevealShortcut", "Ctrl+Alt+KeyF", testDb);
  await saveSetting("weekdayStyle", "full", testDb);
  await saveSetting("showWeekday", false, testDb);
  await saveSetting("dateFormat", "numeric", testDb);
  expect(await loadSettings(testDb)).toMatchObject({
    dailyGoalEnabled: false,
    weeklyGoalEnabled: false,
    popoutRevealShortcut: "Ctrl+Alt+KeyF",
    weekdayStyle: "full",
  });
});

it.each(["F12", "Ctrl+F8", "Alt+Shift+F11", "Alt+`", "Alt+Backquote"])(
  "persistently migrates legacy %s",
  async (shortcut) => {
    const testDb = database();
    await testDb.settings.put({ key: "popoutRevealShortcut", value: shortcut });
    expect((await loadSettings(testDb)).popoutRevealShortcut).toBe("Ctrl+Alt+KeyF");
    expect((await testDb.settings.get("popoutRevealShortcut"))?.value).toBe("Ctrl+Alt+KeyF");
    expect((await loadSettings(testDb)).popoutRevealShortcut).toBe("Ctrl+Alt+KeyF");
  },
);
it.each(["", "Ctrl+KeyF", "Alt+Slash"])("preserves supported or cleared shortcut %s", async (shortcut) => {
  const testDb = database();
  await testDb.settings.bulkPut([
    { key: "popoutRevealShortcut", value: shortcut },
    { key: "popoutDockAutoHide", value: "true" },
  ]);
  expect(await loadSettings(testDb)).toMatchObject({ popoutRevealShortcut: shortcut, popoutDockAutoHide: true });
});
it("resets only preferences and preserves backup metadata and study/runtime records", async () => {
  const testDb = database();
  await testDb.academicYears.put({ id: "1", name: "Year", archived: false });
  await testDb.subjects.put({
    id: "1",
    name: "Subject",
    academicYearId: "1",
    color: "#ffad3b",
    archived: false,
  });
  await testDb.settings.bulkPut([
    { key: "lastBackupAt", value: "2026-09-26" },
    { key: "activeTimer", value: "running" },
    { key: "language", value: "ja" },
    { key: "popoutDockAutoHide", value: "true" },
    { key: "popoutRevealShortcut", value: "Ctrl+KeyF" },
  ]);
  await testDb.sessions.put({
    id: "session",
    subjectId: "1",
    subjectName: "Subject",
    academicYearId: "1",
    academicYearName: "Year",
    startTime: 1000,
    endTime: 61000,
    focusedDurationSeconds: 60,
    archived: false,
  });
  const years = await testDb.academicYears.toArray(),
    subjects = await testDb.subjects.toArray(),
    sessions = await testDb.sessions.toArray();
  await resetAllSettings(testDb);
  expect(await loadSettings(testDb)).toEqual({ ...DEFAULT_SETTINGS, lastBackupAt: "2026-09-26" });
  expect(await testDb.academicYears.toArray()).toEqual(years);
  expect(await testDb.subjects.toArray()).toEqual(subjects);
  expect(await testDb.sessions.toArray()).toEqual(sessions);
  expect((await testDb.settings.get("activeTimer"))?.value).toBe("running");
  expect(DEFAULT_SETTINGS.popoutDockAutoHide).toBe(false);
});

it("supports read-only settings consumption after migration", async () => {
  const testDb = database();
  await testDb.settings.put({ key: "popoutRevealShortcut", value: "F12" });
  await loadSettings(testDb);
  const settings = await testDb.transaction("r", (testDb) => loadSettings(testDb, false));
  expect(settings.popoutRevealShortcut).toBe("Ctrl+Alt+KeyF");
});

it("preserves deliberate old-default choices after migration and cleared intent", async () => {
  const testDb = database();
  await saveSetting("popoutRevealShortcut", "Alt+Backquote", testDb);
  expect(await loadSettings(testDb)).toMatchObject({
    popoutRevealShortcut: "Alt+Backquote",
    popoutRevealShortcutIntent: "custom",
  });
  await saveSetting("popoutRevealShortcut", "", testDb);
  expect(await loadSettings(testDb)).toMatchObject({ popoutRevealShortcut: "", popoutRevealShortcutIntent: "cleared" });
});

it("clears invalid defaults without changing history or a valid disabled selection", async () => {
  const testDb = database();
  await testDb.academicYears.put({ id: "1", name: "Year", archived: false });
  await testDb.subjects.put({ id: "1", academicYearId: "1", name: "Subject", color: "#4da3ff", archived: false });
  await testDb.settings.bulkPut([
    { key: "currentAcademicYearId", value: "1" },
    { key: "defaultSubjectId", value: "1" },
    { key: "subjectPickerMode", value: "remember" },
  ]);
  expect((await loadSettings(testDb)).defaultSubjectId).toBe("1");
  await testDb.subjects.update("1", { archived: true });
  expect(await loadSettings(testDb)).toMatchObject({ subjectPickerMode: "remember", defaultSubjectId: "" });
  await testDb.subjects.update("1", { archived: false });
  await testDb.settings.bulkPut([
    { key: "defaultSubjectId", value: "1" },
    { key: "subjectPickerMode", value: "fixed" },
    { key: "currentAcademicYearId", value: "other" },
  ]);
  expect(await loadSettings(testDb)).toMatchObject({ subjectPickerMode: "fixed", defaultSubjectId: "1" });
  await testDb.academicYears.update("1", { archived: true });
  expect(await loadSettings(testDb)).toMatchObject({ subjectPickerMode: "remember", defaultSubjectId: "" });
});

it("defaults and validates the independent Reveal timeout", async () => {
  const testDb = database();
  expect((await loadSettings(testDb)).popoutRevealTimeoutSeconds).toBe(5);
  for (const value of ["never", "", "bad", "Infinity"]) {
    await testDb.settings.put({ key: "popoutRevealTimeoutSeconds", value });
    expect((await loadSettings(testDb)).popoutRevealTimeoutSeconds).toBe(5);
  }
  await saveSetting("popoutRevealTimeoutSeconds", 0.1, testDb);
  expect((await loadSettings(testDb)).popoutRevealTimeoutSeconds).toBe(0.1);
  await saveSetting("popoutRevealTimeoutSeconds", 4.5, testDb);
  expect((await loadSettings(testDb)).popoutRevealTimeoutSeconds).toBe(4.5);
  await saveSetting("popoutRevealTimeoutSeconds", 15, testDb);
  expect((await loadSettings(testDb)).popoutRevealTimeoutSeconds).toBe(15);
});

it("migrates shortcut enablement without replacing cleared or custom keys", async () => {
  const testDb = database();
  expect((await loadSettings(testDb)).popoutShortcutEnabled).toBe(true);
  await testDb.settings.clear();
  await saveSetting("popoutRevealShortcut", "", testDb);
  expect((await loadSettings(testDb)).popoutShortcutEnabled).toBe(false);
  await saveSetting("popoutShortcutEnabled", true, testDb);
  expect((await loadSettings(testDb)).popoutRevealShortcut).toBe("");
  await saveSetting("popoutRevealShortcut", "Ctrl+Alt+KeyJ", testDb);
  await saveSetting("popoutRevealTimeoutSeconds", 0, testDb);
  await saveSetting("popoutShortcutEnabled", false, testDb);
  expect(await loadSettings(testDb)).toMatchObject({
    popoutShortcutEnabled: false,
    popoutRevealShortcut: "Ctrl+Alt+KeyJ",
    popoutRevealTimeoutSeconds: 0,
  });
  await saveSetting("popoutShortcutEnabled", true, testDb);
  expect(await loadSettings(testDb)).toMatchObject({
    popoutShortcutEnabled: true,
    popoutRevealShortcut: "Ctrl+Alt+KeyJ",
    popoutRevealTimeoutSeconds: 0,
  });
});
