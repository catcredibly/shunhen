import { describe, expect, it } from "vitest";
import { goalProgress, localDayBounds, localWeekBounds, sessionFocusedSecondsInRange } from "./goals";
import type { FocusSession } from "./types";

const session = (startTime: number, endTime: number, intervals?: FocusSession["focusIntervals"]): FocusSession => ({
  id: "s",
  subjectId: "subject",
  subjectName: "Subject",
  academicYearId: "year",
  academicYearName: "Year",
  startTime,
  endTime,
  focusedDurationSeconds: intervals
    ? intervals.reduce((sum, value) => sum + (value.endTime - value.startTime) / 1000, 0)
    : (endTime - startTime) / 1000,
  archived: false,
  focusIntervals: intervals,
});

describe("study goal allocation", () => {
  it("uses edited normalized focus intervals and dates", () => {
    const start = new Date(2026, 8, 22, 9).getTime(),
      end = start + 3 * 3600_000;
    const row = session(start, end, [{ startTime: start, endTime: start + 8820_000 }]);
    row.focusedDurationSeconds = 9000;
    row.focusIntervals = [{ startTime: start, endTime: start + 9000_000 }];
    expect(goalProgress([row], start)).toEqual({ dailySeconds: 9000, weeklySeconds: 9000 });
    row.startTime += 7 * 86400_000;
    row.endTime += 7 * 86400_000;
    row.focusIntervals = row.focusIntervals.map((interval) => ({
      startTime: interval.startTime + 7 * 86400_000,
      endTime: interval.endTime + 7 * 86400_000,
    }));
    expect(goalProgress([row], start)).toEqual({ dailySeconds: 0, weeklySeconds: 0 });
    expect(goalProgress([row], row.startTime)).toEqual({ dailySeconds: 9000, weeklySeconds: 9000 });
  });
  it("splits continuous focus across local midnight", () => {
    const start = new Date(2026, 8, 21, 23, 30).getTime(),
      end = new Date(2026, 8, 22, 0, 30).getTime();
    const row = session(start, end, [{ startTime: start, endTime: end }]);
    const first = localDayBounds(start),
      second = localDayBounds(end);
    expect(sessionFocusedSecondsInRange(row, first.start, first.end)).toBe(1800);
    expect(sessionFocusedSecondsInRange(row, second.start, second.end)).toBe(1800);
  });

  it("excludes paused gaps represented by separate running intervals", () => {
    const start = new Date(2026, 8, 22, 9).getTime(),
      end = new Date(2026, 8, 22, 11).getTime();
    const row = session(start, end, [
      { startTime: start, endTime: start + 1800_000 },
      { startTime: end - 1800_000, endTime: end },
    ]);
    expect(goalProgress([row], start).dailySeconds).toBe(3600);
  });

  it("uses Monday as the local weekly boundary", () => {
    const sunday = new Date(2026, 8, 20, 23, 30).getTime(),
      monday = new Date(2026, 8, 21, 0, 30).getTime();
    const row = session(sunday, monday, [{ startTime: sunday, endTime: monday }]);
    const oldWeek = localWeekBounds(sunday),
      newWeek = localWeekBounds(monday);
    expect(sessionFocusedSecondsInRange(row, oldWeek.start, oldWeek.end)).toBe(1800);
    expect(sessionFocusedSecondsInRange(row, newWeek.start, newWeek.end)).toBe(1800);
  });
});
