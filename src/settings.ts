import { synchronizeStartup } from "./autostart";
import { defaultEdgeForCorner } from "./popoutPlacement";
import { db, type FocusDatabase } from "./db";
import { ACTIVE_TIMER_STORAGE_KEY, LAST_TIMER_DURATION_KEY, type TimerState } from "./timerState";

export type AccentColour = "coral" | "orange" | "pink" | "miku" | "green" | "cappuccino";
export type Theme = "dark" | "light";
export type UiScale = "small" | "medium" | "large" | "extra-large";
export type SubjectPickerMode = "remember" | "fixed";
export type PopoutSize = "small" | "medium" | "large";
export type TimerDurationMode = "remember" | "fixed";
export type PopoutAutoHide = "500" | "1000" | "2000" | "never";
export type AutoHideTabSize = "small" | "medium" | "large";
export type Locale = "en" | "zh-CN" | "zh-TW" | "ja";
export type DockCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
export type DockEdge = "top" | "right" | "bottom" | "left";
export type DockMonitor = "current" | `display:${number}`;
export type CompletionSound = "soft-chime" | "bell" | "digital" | "gentle" | "bright";
export type DateFormat = "full" | "standard" | "compact" | "numeric";
export const DEFAULT_SIDEBAR_SUBTITLE = "\u2606*:.\uff61.o(\u2267\u25bd\u2266)o.\uff61.:*\u2606";
export type WeekdayStyle = "full" | "short";
export type ClockFormat = "system" | "12-hour" | "24-hour";

export type FocusSettings = {
  displayName: string;
  sidebarSubtitle: string;
  language: Locale;
  theme: Theme;
  startMaximized: boolean;
  launchAtStartup: boolean;
  checkForUpdatesOnLaunch: boolean;
  timerDurationMode: TimerDurationMode;
  lastTimerDurationSeconds: number;
  fixedTimerDurationSeconds: number;
  subjectPickerMode: SubjectPickerMode;
  defaultSubjectId: string;
  lastSubjectId: string;
  showDate: boolean;
  dateFormat: DateFormat;
  showWeekday: boolean;
  weekdayStyle: WeekdayStyle;
  showClock: boolean;
  clockFormat: ClockFormat;
  dailyGoalEnabled: boolean;
  dailyGoalSeconds: number;
  weeklyGoalEnabled: boolean;
  weeklyGoalSeconds: number;
  completionSound: boolean;
  completionSoundChoice: CompletionSound;
  completionSoundVolume: number;
  completionNotification: boolean;
  popoutAlwaysOnTop: boolean;
  popoutRememberPosition: boolean;
  popoutShowSubject: boolean;
  popoutShowClock: boolean;
  popoutLayout: "regular" | "compact";
  popoutSize: PopoutSize;
  popoutHideControls: boolean;
  popoutAutoHide: PopoutAutoHide;
  popoutAutoOpen: boolean;
  popoutShowInTaskbar: boolean;
  popoutTransparency: number;
  popoutPositionX: number | null;
  popoutPositionY: number | null;
  popoutFloatingWidth: number | null;
  popoutFloatingHeight: number | null;
  popoutDockingEnabled: boolean;
  popoutDockCorner: DockCorner;
  popoutDockMonitor: DockMonitor;
  popoutDocked: boolean;
  popoutDockAutoHide: boolean;
  popoutShortcutEnabled: boolean;
  popoutRevealShortcut: string;
  popoutRevealTimeoutSeconds: number;
  popoutBorderOpacity: number;
  historyPageSize: 10 | 25 | 50;
  popoutRevealShortcutIntent: "default" | "custom" | "cleared";
  popoutAutoHideDelaySeconds: number;
  popoutAutoHideTabSize: AutoHideTabSize;
  popoutAutoHideShowAccent: boolean;
  popoutAutoHideEdge: DockEdge;
  popoutAutoHideOffset: number;
  accentColour: AccentColour;
  uiScale: UiScale;
  lastBackupAt: string | null;
  allowDirectActiveDeletion: boolean;
};

export const SETTINGS_KEYS: { [K in keyof FocusSettings]: string } = {
  displayName: "displayName",
  sidebarSubtitle: "sidebarSubtitle",
  language: "language",
  theme: "theme",
  startMaximized: "startMaximized",
  launchAtStartup: "launchAtStartup",
  checkForUpdatesOnLaunch: "checkForUpdatesOnLaunch",
  timerDurationMode: "timerDurationMode",
  lastTimerDurationSeconds: LAST_TIMER_DURATION_KEY,
  fixedTimerDurationSeconds: "fixedTimerDurationSeconds",
  subjectPickerMode: "subjectPickerMode",
  defaultSubjectId: "defaultSubjectId",
  lastSubjectId: "lastSubjectId",
  showDate: "showDate",
  dateFormat: "dateFormat",
  showWeekday: "showWeekday",
  weekdayStyle: "weekdayStyle",
  showClock: "showClock",
  clockFormat: "clockFormat",
  dailyGoalEnabled: "dailyGoalEnabled",
  dailyGoalSeconds: "dailyGoalSeconds",
  weeklyGoalEnabled: "weeklyGoalEnabled",
  weeklyGoalSeconds: "weeklyGoalSeconds",
  completionSound: "completionSound",
  completionSoundChoice: "completionSoundChoice",
  completionSoundVolume: "completionSoundVolume",
  completionNotification: "completionNotification",
  popoutAlwaysOnTop: "popoutAlwaysOnTop",
  popoutRememberPosition: "popoutRememberPosition",
  popoutShowSubject: "popoutShowSubject",
  popoutShowClock: "popoutShowClock",
  popoutLayout: "popoutLayout",
  popoutSize: "popoutSize",
  popoutHideControls: "popoutHideControls",
  popoutAutoHide: "popoutAutoHide",
  popoutAutoOpen: "popoutAutoOpen",
  popoutShowInTaskbar: "popoutShowInTaskbar",
  popoutTransparency: "popoutTransparency",
  popoutPositionX: "popoutPositionX",
  popoutPositionY: "popoutPositionY",
  popoutFloatingWidth: "popoutFloatingWidth",
  popoutFloatingHeight: "popoutFloatingHeight",
  popoutDockingEnabled: "popoutDockingEnabled",
  popoutDockCorner: "popoutDockCorner",
  popoutDockMonitor: "popoutDockMonitor",
  popoutDocked: "popoutDocked",
  popoutDockAutoHide: "popoutDockAutoHide",
  popoutShortcutEnabled: "popoutShortcutEnabled",
  popoutRevealShortcut: "popoutRevealShortcut",
  popoutRevealTimeoutSeconds: "popoutRevealTimeoutSeconds",
  popoutBorderOpacity: "popoutBorderOpacity",
  historyPageSize: "historyPageSize",
  popoutRevealShortcutIntent: "popoutRevealShortcutIntent",
  popoutAutoHideDelaySeconds: "popoutAutoHideDelaySeconds",
  popoutAutoHideTabSize: "popoutAutoHideTabSize",
  popoutAutoHideShowAccent: "popoutAutoHideShowAccent",
  popoutAutoHideEdge: "popoutAutoHideEdge",
  popoutAutoHideOffset: "popoutAutoHideOffset",
  accentColour: "accentColour",
  uiScale: "uiScale",
  lastBackupAt: "lastBackupAt",
  allowDirectActiveDeletion: "allowDirectActiveDeletion",
};

export const DEFAULT_SETTINGS: FocusSettings = {
  displayName: "",
  sidebarSubtitle: "",
  language: "en",
  theme: "dark",
  startMaximized: true,
  launchAtStartup: false,
  checkForUpdatesOnLaunch: true,
  timerDurationMode: "remember",
  lastTimerDurationSeconds: 75 * 60,
  fixedTimerDurationSeconds: 75 * 60,
  subjectPickerMode: "remember",
  defaultSubjectId: "",
  lastSubjectId: "",
  showDate: true,
  dateFormat: "standard",
  showWeekday: true,
  weekdayStyle: "short",
  showClock: true,
  clockFormat: "system",
  dailyGoalEnabled: true,
  dailyGoalSeconds: 2 * 60 * 60,
  weeklyGoalEnabled: true,
  weeklyGoalSeconds: 12 * 60 * 60,
  completionSound: true,
  completionSoundChoice: "soft-chime",
  completionSoundVolume: 65,
  completionNotification: true,
  popoutAlwaysOnTop: true,
  popoutRememberPosition: true,
  popoutShowSubject: true,
  popoutShowClock: true,
  popoutLayout: "regular",
  popoutSize: "medium",
  popoutHideControls: true,
  popoutAutoHide: "1000",
  popoutAutoOpen: false,
  popoutShowInTaskbar: false,
  popoutTransparency: 100,
  popoutPositionX: null,
  popoutPositionY: null,
  popoutFloatingWidth: null,
  popoutFloatingHeight: null,
  popoutDockingEnabled: false,
  popoutDockCorner: "top-right",
  popoutDockMonitor: "current",
  popoutDocked: false,
  popoutDockAutoHide: false,
  popoutShortcutEnabled: true,
  popoutRevealShortcut: "Ctrl+Alt+KeyF",
  popoutRevealTimeoutSeconds: 5,
  popoutBorderOpacity: 100,
  historyPageSize: 25,
  popoutRevealShortcutIntent: "default",
  popoutAutoHideDelaySeconds: 0.4,
  popoutAutoHideTabSize: "medium",
  popoutAutoHideShowAccent: true,
  popoutAutoHideEdge: "right",
  popoutAutoHideOffset: 0,
  accentColour: "orange",
  uiScale: "medium",
  lastBackupAt: null,
  allowDirectActiveDeletion: false,
};

const booleans = new Set<keyof FocusSettings>([
  "popoutShortcutEnabled",
  "checkForUpdatesOnLaunch",
  "startMaximized",
  "launchAtStartup",
  "showDate",
  "showWeekday",
  "showClock",
  "dailyGoalEnabled",
  "weeklyGoalEnabled",
  "completionSound",
  "completionNotification",
  "popoutAlwaysOnTop",
  "popoutRememberPosition",
  "popoutShowSubject",
  "popoutShowClock",
  "popoutHideControls",
  "popoutAutoOpen",
  "popoutShowInTaskbar",
  "popoutDockingEnabled",
  "popoutDocked",
  "popoutDockAutoHide",
  "popoutAutoHideShowAccent",
  "allowDirectActiveDeletion",
]);
const numbers = new Set<keyof FocusSettings>([
  "lastTimerDurationSeconds",
  "fixedTimerDurationSeconds",
  "dailyGoalSeconds",
  "weeklyGoalSeconds",
  "completionSoundVolume",
  "popoutTransparency",
  "popoutPositionX",
  "popoutPositionY",
  "popoutFloatingWidth",
  "popoutFloatingHeight",
  "popoutAutoHideOffset",
  "popoutAutoHideDelaySeconds",
]);

export const GOAL_MAX_HOURS = { dailyGoalSeconds: 24, weeklyGoalSeconds: 168 } as const;
export function normalizeGoalSeconds(
  value: unknown,
  fallback = 0,
  maxHours: number = GOAL_MAX_HOURS.dailyGoalSeconds,
): number {
  const parsed = typeof value === "number" || (typeof value === "string" && value.trim() !== "") ? Number(value) : NaN;
  return Number.isFinite(parsed) ? Math.min(maxHours * 3600, Math.max(0, Math.floor(parsed))) : fallback;
}
export function normalizeGoalPart(
  part: "hours" | "minutes",
  value: number,
  maxHours: number = GOAL_MAX_HOURS.dailyGoalSeconds,
): number {
  return Math.min(part === "hours" ? maxHours : 59, Math.max(0, Math.floor(Number.isFinite(value) ? value : 0)));
}
export function goalDurationSeconds(
  hours: number,
  minutes: number,
  maxHours: number = GOAL_MAX_HOURS.dailyGoalSeconds,
): number {
  return normalizeGoalSeconds(
    normalizeGoalPart("hours", hours, maxHours) * 3600 + normalizeGoalPart("minutes", minutes) * 60,
    0,
    maxHours,
  );
}

function decode<K extends keyof FocusSettings>(key: K, raw: string | undefined): FocusSettings[K] {
  if (key === "popoutRevealTimeoutSeconds")
    return (raw?.trim() && Number.isFinite(Number(raw)) ? Math.max(0, Number(raw)) : 5) as FocusSettings[K];
  if (key === "historyPageSize") return ([10, 25, 50].includes(Number(raw)) ? Number(raw) : 25) as FocusSettings[K];
  if (key === "popoutBorderOpacity")
    return (
      raw?.trim() && Number.isFinite(Number(raw)) ? Math.min(100, Math.max(0, Number(raw))) : 100
    ) as FocusSettings[K];
  if (raw === undefined) return DEFAULT_SETTINGS[key];
  if (key === "dailyGoalSeconds" || key === "weeklyGoalSeconds")
    return normalizeGoalSeconds(
      raw,
      Number(DEFAULT_SETTINGS[key]),
      GOAL_MAX_HOURS[key as keyof typeof GOAL_MAX_HOURS],
    ) as FocusSettings[K];
  if (booleans.has(key)) return (raw === "true") as FocusSettings[K];
  if (numbers.has(key)) {
    if (raw === "null") return null as FocusSettings[K];
    let value = Number(raw);
    if (!Number.isFinite(value)) return DEFAULT_SETTINGS[key];
    if (key === "popoutTransparency") value = Math.min(100, Math.max(0, value));
    if (key === "completionSoundVolume") value = Math.min(100, Math.max(0, value));
    if (key === "popoutAutoHideOffset") value = Math.min(1, Math.max(0, value));
    if (key === "popoutAutoHideDelaySeconds") value = Math.max(0, value);
    if (
      ["lastTimerDurationSeconds", "fixedTimerDurationSeconds", "dailyGoalSeconds", "weeklyGoalSeconds"].includes(key)
    )
      value = Math.max(0, Math.floor(value));
    return value as FocusSettings[K];
  }
  if (key === "lastBackupAt") return (raw && raw !== "null" ? raw : null) as FocusSettings[K];
  const allowed: Partial<Record<keyof FocusSettings, readonly string[]>> = {
    weekdayStyle: ["full", "short"],
    language: ["en", "zh-CN", "zh-TW", "ja"],
    theme: ["dark", "light"],
    timerDurationMode: ["remember", "fixed"],
    subjectPickerMode: ["remember", "fixed"],
    dateFormat: ["full", "standard", "compact", "numeric"],
    clockFormat: ["system", "12-hour", "24-hour"],
    completionSoundChoice: ["soft-chime", "bell", "digital", "gentle", "bright"],
    popoutAutoHide: ["500", "1000", "2000", "never"],
    popoutDockCorner: ["top-left", "top-right", "bottom-left", "bottom-right"],
    popoutAutoHideEdge: ["top", "right", "bottom", "left"],
    popoutRevealShortcutIntent: ["default", "custom", "cleared"],
    popoutLayout: ["regular", "compact"],
    popoutSize: ["small", "medium", "large"],
    popoutAutoHideTabSize: ["small", "medium", "large"],
    accentColour: ["coral", "orange", "pink", "miku", "green", "cappuccino"],
    uiScale: ["small", "medium", "large", "extra-large"],
  };
  if (key === "popoutDockMonitor")
    return (/^(current|display:\d+)$/.test(raw) ? raw : DEFAULT_SETTINGS[key]) as FocusSettings[K];
  return (allowed[key] && !allowed[key]?.includes(raw) ? DEFAULT_SETTINGS[key] : raw) as FocusSettings[K];
}

/** Compatibility with releases that allowed function-key reveal shortcuts. */
export function normalizeLegacyRevealShortcut(value: string): string {
  return /^(?:(?:Ctrl|Alt|Shift)\+)*F(?:[1-9]|1[0-2])$/.test(value)
    ? DEFAULT_SETTINGS.popoutRevealShortcut
    : value.replace(/\+`$/, "+Backquote");
}

/** Defaults may belong to any non-archived Academic Year; history is untouched. */
export async function reconcileDefaultSubject(database: FocusDatabase = db) {
  await database.transaction("rw", async (database) => {
    await database.settings.clearMissingSubjectReferences();
    const configured = (await database.settings.get(SETTINGS_KEYS.defaultSubjectId))?.value;
    if (!configured) return;
    const subject = await database.subjects.get(configured);
    const year = subject ? await database.academicYears.get(subject.academicYearId) : undefined;
    if (!subject || subject.archived || !year || year.archived) {
      await database.settings.bulkPut([
        { key: SETTINGS_KEYS.defaultSubjectId, value: "" },
        { key: SETTINGS_KEYS.subjectPickerMode, value: "remember" },
      ]);
    }
  });
}

export async function loadSettings(database: FocusDatabase = db, migrate = true): Promise<FocusSettings> {
  if (migrate) await reconcileDefaultSubject(database);
  if (migrate)
    await database.transaction("rw", async (database) => {
      const row = await database.settings.get(SETTINGS_KEYS.popoutRevealShortcut);
      const intent = await database.settings.get(SETTINGS_KEYS.popoutRevealShortcutIntent);
      const normalized = row ? normalizeLegacyRevealShortcut(row.value) : DEFAULT_SETTINGS.popoutRevealShortcut;
      // Older releases did not record intent. Treat their old default as untouched;
      // preserve all other supported combinations and deliberately cleared values.
      const value = !intent && normalized === "Alt+Backquote" ? DEFAULT_SETTINGS.popoutRevealShortcut : normalized;
      if (!(await database.settings.get(SETTINGS_KEYS.popoutShortcutEnabled)))
        await database.settings.put({ key: SETTINGS_KEYS.popoutShortcutEnabled, value: String(value !== "") });
      if (row && value !== row.value) await database.settings.put({ ...row, value });
      if (!intent)
        await database.settings.put({
          key: SETTINGS_KEYS.popoutRevealShortcutIntent,
          value:
            value === "" ? "cleared" : !row || value === DEFAULT_SETTINGS.popoutRevealShortcut ? "default" : "custom",
        });
    });
  const rows = new Map((await database.settings.toArray()).map((row) => [row.key, row.value]));
  const settings = Object.fromEntries(
    (Object.keys(DEFAULT_SETTINGS) as (keyof FocusSettings)[]).map((key) => [
      key,
      decode(key, rows.get(SETTINGS_KEYS[key])),
    ]),
  ) as FocusSettings;
  settings.popoutRevealShortcut = normalizeLegacyRevealShortcut(settings.popoutRevealShortcut);
  if (!rows.has(SETTINGS_KEYS.popoutShortcutEnabled))
    settings.popoutShortcutEnabled = settings.popoutRevealShortcut !== "";
  settings.popoutAutoHideEdge = defaultEdgeForCorner(settings.popoutDockCorner, settings.popoutAutoHideEdge);
  return settings;
}

export async function saveSetting<K extends keyof FocusSettings>(
  key: K,
  value: FocusSettings[K],
  database: FocusDatabase = db,
) {
  const normalized =
    key === "popoutRevealTimeoutSeconds" || key === "popoutBorderOpacity" || key === "historyPageSize"
      ? decode(key, String(value))
      : key === "dailyGoalSeconds" || key === "weeklyGoalSeconds"
        ? normalizeGoalSeconds(value, Number(DEFAULT_SETTINGS[key]), GOAL_MAX_HOURS[key as keyof typeof GOAL_MAX_HOURS])
        : value;
  if (key === "popoutRevealShortcut") {
    await database.settings.bulkPut([
      { key: SETTINGS_KEYS[key], value: String(normalized) },
      { key: SETTINGS_KEYS.popoutRevealShortcutIntent, value: normalized === "" ? "cleared" : "custom" },
    ]);
  } else await database.settings.put({ key: SETTINGS_KEYS[key], value: String(normalized) });
}

export async function restoreSettingDefaults(keys: (keyof FocusSettings)[], database: FocusDatabase = db) {
  if (keys.includes("launchAtStartup")) await synchronizeStartup(database, DEFAULT_SETTINGS.launchAtStartup);
  await database.transaction("rw", async (database) => {
    await database.settings.bulkDelete(keys.map((key) => SETTINGS_KEYS[key]));
    if (keys.includes("popoutRevealShortcut")) await database.settings.delete(SETTINGS_KEYS.popoutRevealShortcutIntent);
  });
}

export function greeting(name: string, hour = new Date().getHours()) {
  const part = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const trimmed = name.trim();
  return `Good ${part}${trimmed ? `, ${trimmed}` : ""}`;
}

export function normaliseDuration(hours: number, minutes: number, seconds: number) {
  const total = Math.max(0, Math.floor(hours || 0) * 3600 + Math.floor(minutes || 0) * 60 + Math.floor(seconds || 0));
  return { total, hours: Math.floor(total / 3600), minutes: Math.floor((total % 3600) / 60), seconds: total % 60 };
}

export function timerDefaultDuration(settings: FocusSettings) {
  return settings.timerDurationMode === "fixed"
    ? settings.fixedTimerDurationSeconds
    : settings.lastTimerDurationSeconds;
}

export function hasActiveTimer(storage: Pick<Storage, "getItem"> = localStorage) {
  try {
    const timer = JSON.parse(storage.getItem(ACTIVE_TIMER_STORAGE_KEY) ?? "null") as Partial<TimerState> | null;
    return Boolean(timer?.running || timer?.paused || (timer?.sessionId && timer?.startedAt));
  } catch {
    return false;
  }
}

export async function clearAllFocusData(
  database: FocusDatabase = db,
  storage: Pick<Storage, "getItem" | "removeItem"> = localStorage,
) {
  if (hasActiveTimer(storage)) throw new Error("Finish or stop the current timer before clearing app data.");
  await database.transaction("rw", async (database) => {
    await database.academicYears.clear();
    await database.settings.clear();
  });
  storage.removeItem(ACTIVE_TIMER_STORAGE_KEY);
}

export function formatLastBackup(value: string | null, locale?: string) {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Never"
    : date.toLocaleString(locale, {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}

/** Reset preferences only; unknown/runtime keys and backup metadata are retained. */
export async function resetAllSettings(database: FocusDatabase = db) {
  await restoreSettingDefaults(
    (Object.keys(DEFAULT_SETTINGS) as (keyof FocusSettings)[]).filter((key) => key !== "lastBackupAt"),
    database,
  );
}
