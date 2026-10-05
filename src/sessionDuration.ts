import type { FocusSession } from "./types";

export type DurationParts = { hours: number; minutes: number; seconds: number };
export function sessionSpanSeconds(startTime: number, endTime: number) {
  return Math.max(0, (endTime - startTime) / 1000);
}
export function durationParts(totalSeconds: number): DurationParts {
  const total = Math.max(0, Math.round(totalSeconds));
  return {
    hours: Math.floor(total / 3600),
    minutes: Math.floor((total % 3600) / 60),
    seconds: total % 60,
  };
}

/** Resolve the editor's local date/time fields without losing untouched timer precision. */
export function editedSessionTimes(
  date: string,
  start: string,
  end: string,
  original?: Pick<FocusSession, "startTime" | "endTime">,
  offset = manualEndOffset(start, end),
) {
  const localDate = (stamp: number) => {
    const d = new Date(stamp);
    return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
  };
  const time = (stamp: number) => new Date(stamp).toTimeString().slice(0, 5);
  const sameStart = original && date === localDate(original.startTime) && start === time(original.startTime);
  const startTime = sameStart ? original.startTime : new Date(date + "T" + start).getTime();
  const endDate = new Date(date + "T" + end);
  endDate.setDate(endDate.getDate() + offset);
  const endTime =
    sameStart && end === time(original.endTime) && offset === sessionDayOffset(original.startTime, original.endTime)
      ? original.endTime
      : endDate.getTime();
  return { startTime, endTime };
}

export function sessionDayOffset(start: number, end: number) {
  const date = (stamp: number) => {
    const d = new Date(stamp);
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  };
  return Math.max(0, Math.round((date(end) - date(start)) / 86400000));
}
export function sessionEditTiming(session: FocusSession, startTime: number, manualEnd: number) {
  if (session.manual === true)
    return {
      startTime,
      endTime: manualEnd,
      focusedDurationSeconds: (manualEnd - startTime) / 1000,
      focusIntervals: undefined,
    };
  const delta = startTime - session.startTime;
  return {
    startTime,
    endTime: session.endTime + delta,
    focusedDurationSeconds: session.focusedDurationSeconds,
    ...(Array.isArray(session.focusIntervals)
      ? {
          focusIntervals: session.focusIntervals.map((interval) => ({
            ...interval,
            startTime: interval.startTime + delta,
            endTime: interval.endTime + delta,
          })),
        }
      : {}),
  };
}

export function manualEndOffset(start: string, end: string, explicit?: number) {
  return explicit ?? (end < start ? 1 : 0);
}
