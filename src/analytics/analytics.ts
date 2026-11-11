import { dailyFocusAllocations, dailyFocusIntervals } from "../sessionAllocation";
import type { AllocationReader } from "./snapshot";
import type { AcademicYear, FocusSession, Subject } from "../types";
import { matchesSelection } from "../selectorOptions";

export type AnalyticsFilters = {
  academicYearId?: string;
  subjectId?: string;
  academicYearIds?: string[];
  subjectIds?: string[];
  start?: number;
  end?: number;
};
export type TimePoint = { key: string; label: string; start: number; seconds: number; sessionCount: number };
const pad = (n: number) => String(n).padStart(2, "0");
export const localDayKey = (stamp: number) => {
  const d = new Date(stamp);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const localMonthKey = (stamp: number) => {
  const d = new Date(stamp);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};
export const startOfLocalDay = (stamp: number) => {
  const d = new Date(stamp);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};
export const startOfLocalWeek = (stamp: number) => {
  const d = new Date(startOfLocalDay(stamp));
  const offset = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - offset);
  return d.getTime();
};
export const filterSessions = (sessions: FocusSession[], filters: AnalyticsFilters = {}) =>
  sessions.filter(
    (s) =>
      s.focusedDurationSeconds > 0 &&
      (!filters.academicYearId || s.academicYearId === filters.academicYearId) &&
      (!filters.subjectId || s.subjectId === filters.subjectId) &&
      matchesSelection(s.academicYearId, filters.academicYearIds ?? []) &&
      matchesSelection(s.subjectId, filters.subjectIds ?? []) &&
      (!filters.start || s.startTime >= filters.start) &&
      (!filters.end || s.startTime < filters.end),
  );
function aggregate(
  sessions: FocusSession[],
  key: (stamp: number) => string,
  start: (stamp: number) => number,
  getDays: AllocationReader = dailyFocusAllocations,
): TimePoint[] {
  const map = new Map<string, TimePoint>();
  for (const s of sessions) {
    const originalKey = key(s.startTime);
    const original = map.get(originalKey) ?? {
      key: originalKey,
      label: originalKey,
      start: start(s.startTime),
      seconds: 0,
      sessionCount: 0,
    };
    original.sessionCount++;
    map.set(originalKey, original);
    for (const day of getDays(s)) {
      const k = key(day.start),
        existing = map.get(k) ?? { key: k, label: k, start: start(day.start), seconds: 0, sessionCount: 0 };
      existing.seconds += day.seconds;
      map.set(k, existing);
    }
  }
  return [...map.values()].sort((a, b) => a.start - b.start);
}
export const dailyTotals = (sessions: FocusSession[], getDays: AllocationReader = dailyFocusAllocations) =>
  aggregate(sessions, localDayKey, startOfLocalDay, getDays);
export const weeklyTotals = (sessions: FocusSession[]) =>
  aggregate(sessions, (stamp) => localDayKey(startOfLocalWeek(stamp)), startOfLocalWeek);
export const monthlyTotals = (sessions: FocusSession[]) =>
  aggregate(sessions, localMonthKey, (stamp) => {
    const d = new Date(stamp);
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  });
export function calendarMonthlySeries(sessions: FocusSession[]) {
  const points = monthlyTotals(sessions);
  if (!points.length) return [];
  const totals = new Map(points.map((point) => [point.key, point])),
    result: TimePoint[] = [];
  const end = new Date(points.at(-1)!.start);
  for (const date = new Date(points[0].start); date <= end; date.setMonth(date.getMonth() + 1)) {
    const start = date.getTime(),
      key = localMonthKey(start);
    result.push(totals.get(key) ?? { key, label: key, start, seconds: 0, sessionCount: 0 });
  }
  return result;
}
export const totalFocusedSeconds = (sessions: FocusSession[]) =>
  sessions.reduce((sum, s) => sum + s.focusedDurationSeconds, 0);
export const activeDayCount = (sessions: FocusSession[]) =>
  dailyTotals(sessions).filter((day) => day.seconds > 0).length;
export const averageActiveDaySeconds = (sessions: FocusSession[]) => {
  const days = activeDayCount(sessions);
  return days ? totalFocusedSeconds(sessions) / days : 0;
};
export function longestStreak(sessions: FocusSession[]) {
  const days = dailyTotals(sessions).map((d) => d.start);
  let longest = 0,
    current = 0,
    previous: Date | undefined;
  for (const stamp of days) {
    const day = new Date(stamp),
      expected = previous ? new Date(previous) : undefined;
    if (expected) expected.setDate(expected.getDate() + 1);
    current = expected && localDayKey(expected.getTime()) === localDayKey(stamp) ? current + 1 : 1;
    longest = Math.max(longest, current);
    previous = day;
  }
  return longest;
}
function percentile(values: number[], p: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * p,
    lower = Math.floor(index),
    fraction = index - lower;
  return sorted[lower] + ((sorted[lower + 1] ?? sorted[lower]) - sorted[lower]) * fraction;
}
export function cleanHeatmapStep(p90Seconds: number) {
  const raw = p90Seconds / 4,
    increment = raw < 1800 ? 300 : 900;
  return Math.max(increment, Math.round(raw / increment) * increment);
}
export function heatmapScale(sessions: FocusSession[], daily = dailyTotals(sessions)) {
  const values = daily.map((d) => d.seconds).filter((v) => v > 0),
    p90 = percentile(values, 0.9),
    step = cleanHeatmapStep(p90);
  return { p90, step, thresholds: [step, step * 2, step * 3, step * 4] };
}
export function heatmapLevel(seconds: number, step: number) {
  if (seconds <= 0) return 0;
  return Math.min(4, Math.ceil(seconds / step));
}
export function subjectTotals(
  sessions: FocusSession[],
  subjects: Subject[],
  getDays: AllocationReader = dailyFocusAllocations,
) {
  const subjectsById = new Map(subjects.map((subject) => [subject.id, subject])),
    map = new Map<
      string,
      {
        subjectId: string;
        name: string;
        academicYearId: string;
        color: string;
        seconds: number;
        sessions: number;
        activeDays: Set<string>;
        first: number;
        last: number;
      }
    >();
  for (const s of sessions) {
    const subject = subjectsById.get(s.subjectId);
    const item = map.get(s.subjectId) ?? {
      subjectId: s.subjectId,
      name: s.subjectName,
      academicYearId: s.academicYearId,
      color: subject?.color ?? "#7890a4",
      seconds: 0,
      sessions: 0,
      activeDays: new Set(),
      first: s.startTime,
      last: s.startTime,
    };
    item.seconds += s.focusedDurationSeconds;
    item.sessions++;
    for (const day of getDays(s)) item.activeDays.add(localDayKey(day.start));
    item.first = Math.min(item.first, s.startTime);
    item.last = Math.max(item.last, s.startTime);
    map.set(s.subjectId, item);
  }
  return [...map.values()]
    .map((x) => ({ ...x, activeDayCount: x.activeDays.size, averageSessionSeconds: x.seconds / x.sessions }))
    .sort((a, b) => b.seconds - a.seconds);
}
export function academicYearTotals(
  sessions: FocusSession[],
  years: AcademicYear[],
  subjects: Subject[],
  getDays: AllocationReader = dailyFocusAllocations,
) {
  return years
    .map((year) => {
      const rows = sessions.filter((s) => s.academicYearId === year.id),
        daily = dailyTotals(rows, getDays),
        activeDays = daily.filter((day) => day.seconds > 0).length,
        seconds = totalFocusedSeconds(rows),
        scale = heatmapScale(rows, daily);
      return {
        academicYearId: year.id,
        name: year.name,
        seconds,
        sessions: rows.length,
        averageSessionSeconds: rows.length ? seconds / rows.length : 0,
        activeDays,
        averageActiveDaySeconds: activeDays ? seconds / activeDays : 0,
        subjects: subjects.filter((s) => s.academicYearId === year.id).length,
        p90: scale.p90,
        step: scale.step,
      };
    })
    .filter((x) => x.sessions)
    .sort((a, b) => b.seconds - a.seconds);
}
export function cumulativeTotals(points: TimePoint[]) {
  let total = 0;
  return points.map((p) => ({ ...p, cumulativeSeconds: (total += p.seconds) }));
}
export function calendarDailySeries(
  sessions: FocusSession[],
  start: number,
  end: number,
  daily = dailyTotals(sessions),
) {
  const totals = new Map(daily.map((p) => [p.key, p]));
  const result: TimePoint[] = [],
    exclusiveEnd = startOfLocalDay(end);
  for (let stamp = startOfLocalDay(start); stamp < exclusiveEnd;) {
    const key = localDayKey(stamp),
      point = totals.get(key);
    result.push(point ?? { key, label: key, start: stamp, seconds: 0, sessionCount: 0 });
    const d = new Date(stamp);
    d.setDate(d.getDate() + 1);
    stamp = d.getTime();
  }
  return result;
}
export function rollingAverage(points: TimePoint[], window: number) {
  return points.map((p, index) => ({
    ...p,
    averageSeconds:
      points.slice(Math.max(0, index - window + 1), index + 1).reduce((sum, x) => sum + x.seconds, 0) / window,
  }));
}
export function medianSessionSeconds(sessions: FocusSession[]) {
  if (!sessions.length) return 0;
  const values = sessions.map((s) => s.focusedDurationSeconds).sort((a, b) => a - b),
    mid = Math.floor(values.length / 2);
  return values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
}
export function sessionLengthBuckets(sessions: FocusSession[]) {
  const buckets = [
    { label: "<30 min", count: 0 },
    { label: "30–59 min", count: 0 },
    { label: "60–89 min", count: 0 },
    { label: "90–119 min", count: 0 },
    { label: "120–179 min", count: 0 },
    { label: "180+ min", count: 0 },
  ];
  for (const s of sessions) {
    const seconds = s.focusedDurationSeconds;
    buckets[seconds < 1800 ? 0 : seconds < 3600 ? 1 : seconds < 5400 ? 2 : seconds < 7200 ? 3 : seconds < 10800 ? 4 : 5]
      .count++;
  }
  return buckets;
}
export function weekdayTotals(
  sessions: FocusSession[],
  period?: { start: number; end: number },
  getDays: AllocationReader = dailyFocusAllocations,
) {
  const labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    values = labels.map((label) => ({ label, seconds: 0, count: 0, sessionSeconds: 0 }));
  for (const s of sessions) {
    if (!period || (s.startTime >= period.start && s.startTime < period.end)) {
      const row = values[(new Date(s.startTime).getDay() + 6) % 7];
      row.count++;
      row.sessionSeconds += s.focusedDurationSeconds;
    }
    for (const day of getDays(s))
      if (!period || (day.start >= period.start && day.start < period.end))
        values[(new Date(day.start).getDay() + 6) % 7].seconds += day.seconds;
  }
  return values;
}
/** Calendar occurrences include days with no Sessions; the end boundary is exclusive. */
export function weekdayAverages(
  sessions: FocusSession[],
  period: { start: number; end: number },
  getDays: AllocationReader = dailyFocusAllocations,
) {
  const occurrences = Array<number>(7).fill(0);
  const day = new Date(startOfLocalDay(period.start));
  while (day.getTime() < period.end && period.start < period.end) {
    occurrences[(day.getDay() + 6) % 7]++;
    // Advance by local calendar date so daylight-saving changes do not skip a day.
    day.setDate(day.getDate() + 1);
  }
  return weekdayTotals(sessions, period, getDays).map((row, index) => ({
    ...row,
    occurrences: occurrences[index],
    averageFocusSeconds: occurrences[index] ? row.seconds / occurrences[index] : 0,
    averageSessionCount: occurrences[index] ? row.count / occurrences[index] : 0,
    averageSessionSeconds: row.count ? row.sessionSeconds / row.count : null,
  }));
}
export function timeOfDayMatrix(sessions: FocusSession[], period?: { start: number; end: number }) {
  const matrix = Array.from({ length: 7 }, () => Array(8).fill(0) as number[]);
  for (const s of sessions) {
    for (const segment of dailyFocusIntervals(s)) {
      let cursor = Math.max(segment.startTime, period?.start ?? -Infinity);
      while (cursor < Math.min(segment.endTime, period?.end ?? Infinity)) {
        const d = new Date(cursor),
          bucketEnd = new Date(
            d.getFullYear(),
            d.getMonth(),
            d.getDate(),
            (Math.floor(d.getHours() / 3) + 1) * 3,
          ).getTime(),
          end = Math.min(bucketEnd, segment.endTime, period?.end ?? Infinity);
        matrix[(d.getDay() + 6) % 7][Math.floor(d.getHours() / 3)] += (end - cursor) / 1000;
        cursor = end;
      }
    }
  }
  return matrix;
}
