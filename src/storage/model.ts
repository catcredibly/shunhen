import type { AcademicYear, FocusSession, Subject, AppSetting } from "../types";
import { isSourceIdentity } from "./identity";
import { normalizeNote, noteMetrics } from "../notes";

// Append new palette entries; never reorder or reuse these persisted IDs.
export const COLOR_PALETTE = [
  "#4da3ff",
  "#ff4d57",
  "#ffad3b",
  "#4dd39a",
  "#a879ff",
  "#ff7eb6",
  "#45d9e8",
  "#a8d94f",
  "#f4d64e",
  "#6672e5",
  "#2cb7a9",
  "#d95fe8",
] as const;
export type StoredYear = { id: number; name: string; startDate?: string; endDate?: string; archived: boolean };
export type StoredSubject = { id: number; academicYearId: number; name: string; colorId: number; archived: boolean };
export type Pause = { offsetSeconds: number; durationSeconds: number };
export type StoredSession = {
  id: number;
  subjectId: number;
  startedAt: number;
  elapsedSeconds: number;
  note?: string;
  manual: boolean;
  pauses: Pause[];
  sourceIdentity: string;
};
export type NormalizedData = {
  academicYears: StoredYear[];
  subjects: StoredSubject[];
  sessions: StoredSession[];
  settings: AppSetting[];
};
export type LegacyData = {
  academicYears: AcademicYear[];
  subjects: (Subject & { archivedBeforeParent?: boolean })[];
  sessions: FocusSession[];
  settings: AppSetting[];
};

export function colorId(color: string) {
  const id = COLOR_PALETTE.indexOf(color.toLowerCase() as (typeof COLOR_PALETTE)[number]);
  if (id < 0) throw new Error(`Unsupported Subject color: ${color}`);
  return id;
}
/** Half-second ties go towards positive infinity, including pre-epoch dates. */
export function nearestSecond(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1000 + 0.5);
  if (!Number.isSafeInteger(seconds) || !Number.isFinite(new Date(milliseconds).getTime()))
    throw new Error("Invalid Session boundary.");
  return seconds;
}

export function validateTiming(startedAt: number, elapsedSeconds: number, pauses: Pause[]) {
  if (
    !Number.isSafeInteger(startedAt) ||
    !Number.isFinite(new Date(startedAt * 1000).getTime()) ||
    !Number.isSafeInteger(elapsedSeconds) ||
    elapsedSeconds <= 0 ||
    !Number.isFinite(new Date((startedAt + elapsedSeconds) * 1000).getTime())
  )
    throw new Error("Invalid Session timing.");
  let end = 0;
  for (const pause of pauses) {
    if (
      !pause ||
      !Number.isSafeInteger(pause.offsetSeconds) ||
      !Number.isSafeInteger(pause.durationSeconds) ||
      pause.offsetSeconds < end ||
      pause.durationSeconds <= 0 ||
      pause.offsetSeconds + pause.durationSeconds > elapsedSeconds
    )
      throw new Error("Invalid Session pauses.");
    end = pause.offsetSeconds + pause.durationSeconds;
  }
  if (pauses.reduce((sum, pause) => sum + pause.durationSeconds, 0) >= elapsedSeconds)
    throw new Error("Session has no Focus Time.");
}

/** Both the upgrade bridge and legacy imports use this boundary conversion. */
export function normalizeTiming(
  session: Pick<
    FocusSession,
    "startTime" | "endTime" | "focusedDurationSeconds" | "focusIntervals" | "manual" | "legacyContinuous"
  >,
) {
  let endTime = session.endTime;
  const intervals = session.focusIntervals;
  if (!intervals && !session.manual && !session.legacyContinuous) {
    // The old versioned continuous-session migration: absent interval information
    // means a continuous span of recorded focus, never fabricated pause positions.
    if (!Number.isFinite(session.focusedDurationSeconds) || session.focusedDurationSeconds <= 0)
      throw new Error("Invalid legacy Focus Time.");
    endTime = session.startTime + session.focusedDurationSeconds * 1000;
  }
  const startedAt = nearestSecond(session.startTime);
  const elapsedSeconds = nearestSecond(endTime) - startedAt;
  const pauses: Pause[] = [];
  if (intervals !== undefined) {
    if (!Array.isArray(intervals) || !intervals.length) throw new Error("Invalid Focus intervals.");
    let previous = session.startTime;
    let cursor = startedAt;
    let focused = 0;
    for (const interval of intervals) {
      if (
        !interval ||
        !Number.isFinite(interval.startTime) ||
        !Number.isFinite(interval.endTime) ||
        interval.startTime < previous ||
        interval.endTime <= interval.startTime ||
        interval.endTime > endTime
      )
        throw new Error("Invalid Focus intervals.");
      focused += (interval.endTime - interval.startTime) / 1000;
      const start = nearestSecond(interval.startTime),
        end = nearestSecond(interval.endTime);
      if (start > cursor) {
        const last = pauses.at(-1);
        if (last && last.offsetSeconds + last.durationSeconds === cursor - startedAt)
          last.durationSeconds += start - cursor;
        else pauses.push({ offsetSeconds: cursor - startedAt, durationSeconds: start - cursor });
      }
      cursor = end;
      previous = interval.endTime;
    }
    if (Math.abs(focused - session.focusedDurationSeconds) > 1e-6)
      throw new Error("Focus interval total does not match recorded Focus Time.");
    const end = startedAt + elapsedSeconds;
    if (end > cursor) {
      const last = pauses.at(-1);
      if (last && last.offsetSeconds + last.durationSeconds === cursor - startedAt)
        last.durationSeconds += end - cursor;
      else pauses.push({ offsetSeconds: cursor - startedAt, durationSeconds: end - cursor });
    }
  }
  validateTiming(startedAt, elapsedSeconds, pauses);
  return { startedAt, elapsedSeconds, pauses };
}

export function focusIntervals(startedAt: number, elapsedSeconds: number, pauses: Pause[]) {
  let cursor = 0;
  const intervals: { startTime: number; endTime: number }[] = [];
  for (const pause of pauses) {
    if (pause.offsetSeconds > cursor)
      intervals.push({ startTime: (startedAt + cursor) * 1000, endTime: (startedAt + pause.offsetSeconds) * 1000 });
    cursor = pause.offsetSeconds + pause.durationSeconds;
  }
  if (cursor < elapsedSeconds)
    intervals.push({ startTime: (startedAt + cursor) * 1000, endTime: (startedAt + elapsedSeconds) * 1000 });
  return intervals;
}

function validateDate(date: string | undefined) {
  if (
    date !== undefined &&
    (typeof date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(new Date(date + "T00:00:00Z").getTime()) ||
      new Date(date + "T00:00:00Z").toISOString().slice(0, 10) !== date)
  )
    throw new Error("Invalid Academic Year date.");
}
export function validateData(data: NormalizedData) {
  const ids = <T extends { id: number }>(rows: T[]) => {
    const set = new Set<number>();
    for (const row of rows) {
      if (!Number.isSafeInteger(row.id) || row.id <= 0 || set.has(row.id))
        throw new Error("Invalid or duplicate row ID.");
      set.add(row.id);
    }
    return set;
  };
  const years = ids(data.academicYears),
    subjects = ids(data.subjects);
  ids(data.sessions);
  for (const row of data.academicYears) {
    if (typeof row.name !== "string" || typeof row.archived !== "boolean") throw new Error("Invalid Academic Year.");
    validateDate(row.startDate);
    validateDate(row.endDate);
    if (row.startDate && row.endDate && row.endDate < row.startDate)
      throw new Error("Academic Year ends before it starts.");
  }
  for (const row of data.subjects) {
    if (
      !years.has(row.academicYearId) ||
      typeof row.name !== "string" ||
      typeof row.archived !== "boolean" ||
      !Number.isInteger(row.colorId) ||
      row.colorId < 0 ||
      row.colorId >= COLOR_PALETTE.length
    )
      throw new Error("Invalid Subject relationship or color.");
  }
  const sources = new Set<string>();
  for (const row of data.sessions) {
    if (
      !subjects.has(row.subjectId) ||
      typeof row.manual !== "boolean" ||
      !Array.isArray(row.pauses) ||
      !isSourceIdentity(row.sourceIdentity) ||
      sources.has(row.sourceIdentity) ||
      (row.note !== undefined && (typeof row.note !== "string" || !noteMetrics(row.note).valid))
    )
      throw new Error("Invalid Session relationship, note or identity.");
    sources.add(row.sourceIdentity);
    validateTiming(row.startedAt, row.elapsedSeconds, row.pauses);
  }
  const keys = new Set<string>();
  for (const setting of data.settings) {
    if (typeof setting.key !== "string" || typeof setting.value !== "string" || keys.has(setting.key))
      throw new Error("Invalid Setting.");
    keys.add(setting.key);
    if (
      ["defaultSubjectId", "lastSubjectId"].includes(setting.key) &&
      setting.value &&
      !subjects.has(Number(setting.value))
    )
      throw new Error("Setting references missing Subject.");
    if (setting.key === "currentAcademicYearId" && setting.value && !years.has(Number(setting.value)))
      throw new Error("Setting references missing Academic Year.");
  }
}

export function normalizeLegacy(data: LegacyData) {
  const yearMap = new Map<string, number>(),
    subjectMap = new Map<string, number>();
  const mapIds = (rows: { id: string }[], map: Map<string, number>) =>
    rows.forEach((row, index) => {
      if (typeof row.id !== "string" || !row.id || map.has(row.id)) throw new Error("Invalid legacy IDs.");
      map.set(row.id, index + 1);
    });
  mapIds(data.academicYears, yearMap);
  mapIds(data.subjects, subjectMap);
  const sessionIds = new Set<string>();
  const academicYears = data.academicYears.map((row) => ({
    id: yearMap.get(row.id)!,
    name: row.name,
    startDate: row.startDate || undefined,
    endDate: row.endDate || undefined,
    archived: row.archived ?? false,
  }));
  const subjects = data.subjects.map((row) => ({
    id: subjectMap.get(row.id)!,
    academicYearId: yearMap.get(row.academicYearId)!,
    name: row.name,
    colorId: colorId(row.color),
    archived: row.archivedBeforeParent ?? row.archived ?? false,
  }));
  const sessions = data.sessions.map((row, index) => {
    if (typeof row.id !== "string" || !row.id || sessionIds.has(row.id)) throw new Error("Invalid legacy Session ID.");
    sessionIds.add(row.id);
    if (row.note !== undefined && typeof row.note !== "string") throw new Error("Invalid legacy note.");
    const timing = normalizeTiming({
      ...row,
      focusedDurationSeconds: row.focusedDurationSeconds ?? (row.endTime - row.startTime) / 1000,
    });
    return {
      id: index + 1,
      subjectId: subjectMap.get(row.subjectId)!,
      ...timing,
      note: row.note === undefined ? undefined : normalizeNote(row.note),
      manual: row.manual === true,
      sourceIdentity: isSourceIdentity(row.sourceIdentity) ? row.sourceIdentity : `legacy-session:${row.id}`,
    };
  });
  const settings = data.settings.map((row) => {
    if (["defaultSubjectId", "lastSubjectId"].includes(row.key))
      return { ...row, value: row.value ? String(subjectMap.get(row.value) ?? "") : "" };
    if (row.key === "currentAcademicYearId")
      return { ...row, value: row.value ? String(yearMap.get(row.value) ?? "") : "" };
    return { ...row };
  });
  const normalized = { academicYears, subjects, sessions, settings };
  validateData(normalized);
  return { data: normalized, yearMap, subjectMap };
}
