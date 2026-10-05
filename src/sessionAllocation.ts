import type { FocusSession } from "./types";

export function exactFocusIntervals(session: FocusSession) {
  const intervals = session.focusIntervals;
  if (
    Array.isArray(intervals) &&
    intervals.length &&
    intervals.every(
      (interval, index) =>
        interval &&
        typeof interval === "object" &&
        Number.isFinite(interval.startTime) &&
        Number.isFinite(interval.endTime) &&
        interval.startTime >= session.startTime &&
        interval.endTime <= session.endTime &&
        interval.endTime > interval.startTime &&
        (!index || interval.startTime >= intervals[index - 1].endTime),
    )
  ) {
    const recorded = intervals.reduce((sum, interval) => sum + (interval.endTime - interval.startTime) / 1000, 0);
    if (recorded > 0 && Math.abs(recorded - session.focusedDurationSeconds) < 1e-7) return intervals;
  }
  return undefined;
}

export function allocationIntervals(session: FocusSession) {
  const exact = exactFocusIntervals(session);
  if (exact) return exact;
  if (
    session.focusIntervals === undefined &&
    Number.isFinite(session.startTime) &&
    Number.isFinite(session.endTime) &&
    session.endTime > session.startTime &&
    Math.abs((session.endTime - session.startTime) / 1000 - session.focusedDurationSeconds) < 1e-7
  )
    return [{ startTime: session.startTime, endTime: session.endTime }];
  return undefined;
}
export function exactFocusInRange(session: FocusSession, start: number, end: number) {
  if (end <= start) return 0;
  return (allocationIntervals(session) ?? []).reduce(
    (sum, interval) => sum + Math.max(0, Math.min(interval.endTime, end) - Math.max(interval.startTime, start)) / 1000,
    0,
  );
}
export function allocatedFocusInRange(session: FocusSession, start: number, end: number) {
  return exactFocusInRange(session, start, end);
}
/** Split every usable focus interval at local midnights, shared by date and time buckets. */
export function dailyFocusIntervals(session: FocusSession) {
  const segments: { startTime: number; endTime: number; dayStart: number; dayEnd: number }[] = [];
  for (const interval of allocationIntervals(session) ?? []) {
    if (!Number.isFinite(interval.startTime) || !Number.isFinite(interval.endTime)) continue;
    let cursor = interval.startTime;
    while (cursor < interval.endTime) {
      const date = new Date(cursor);
      date.setHours(0, 0, 0, 0);
      const dayStart = date.getTime();
      date.setDate(date.getDate() + 1);
      const dayEnd = date.getTime();
      const endTime = Math.min(dayEnd, interval.endTime);
      if (!(endTime > cursor)) break;
      segments.push({ startTime: cursor, endTime, dayStart, dayEnd });
      cursor = endTime;
    }
  }
  return segments;
}
export function dailyFocusAllocations(session: FocusSession) {
  const days = new Map<number, { start: number; end: number; seconds: number }>();
  for (const segment of dailyFocusIntervals(session)) {
    const part = days.get(segment.dayStart) ?? { start: segment.dayStart, end: segment.dayEnd, seconds: 0 };
    part.seconds += (segment.endTime - segment.startTime) / 1000;
    days.set(segment.dayStart, part);
  }
  return [...days.values()].sort((a, b) => a.start - b.start);
}
