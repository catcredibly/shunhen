import { describe, expect, it } from "vitest";
import type { FocusSession } from "../types";
import {
  addDays,
  analyticsPeriod,
  averageStudyPattern,
  calendarBuckets,
  calendarDays,
  cumulativeDailyFocus,
  dailyTickIndices,
  defaultAggregation,
  goalAggregationModes,
  goalDefaultAggregation,
  percentageChange,
  personalBests,
  previousPeriod,
  rollingTimeline,
} from "./periods";

const at = (month: number, day: number, hour = 0) => new Date(2026, month - 1, day, hour).getTime();
const row = (day: number, seconds: number, month = 9): FocusSession => ({
  id: `${month}-${day}`,
  startTime: at(month, day, 12),
  endTime: at(month, day, 12) + seconds * 1000,
  focusedDurationSeconds: seconds,
  subjectId: "math",
  subjectName: "Math",
  academicYearId: "year",
  academicYearName: "Year",
  archived: false,
});

describe("calendar periods", () => {
  it("distributes All by its calendar length without changing other ranges", () => {
    for (const [days, mode] of [
      [1, "daily"],
      [31, "daily"],
      [32, "weekly"],
      [180, "weekly"],
      [181, "monthly"],
    ] as const) {
      const period = { start: at(9, 22), end: addDays(at(9, 22), days) };
      expect(defaultAggregation("All", period)).toBe(mode);
    }
    for (const [range, days, mode] of [
      ["7D", 7, "daily"],
      ["30D", 30, "daily"],
      ["90D", 90, "daily"],
      ["1Y", 365, "weekly"],
      ["Custom", 32, "daily"],
      ["Custom", 180, "weekly"],
      ["Custom", 181, "weekly"],
    ] as const) {
      expect(defaultAggregation(range, { start: at(9, 22), end: addDays(at(9, 22), days) })).toBe(mode);
    }
  });
  it("keeps empty All periods and averages complete Sessions rather than empty dates", () => {
    const period = { start: at(9, 22), end: at(10, 1) };
    const sessions = [row(23, 100), { ...row(23, 300), id: "second" }, row(29, 50)];
    const points = calendarBuckets(sessions, period, defaultAggregation("All", period));
    expect(points).toHaveLength(9);
    expect(points.map((p) => p.sessionCount)).toEqual([0, 2, 0, 0, 0, 0, 0, 1, 0]);
    expect(points.map((p) => (p.sessionCount ? p.averageSeconds : null))).toEqual([
      null,
      200,
      null,
      null,
      null,
      null,
      null,
      50,
      null,
    ]);
    const longer = { start: at(9, 22), end: addDays(at(9, 22), 32) };
    const weekly = calendarBuckets(sessions, longer, defaultAggregation("All", longer));
    expect(weekly.map((p) => p.sessionCount)).toEqual([2, 1, 0, 0, 0]);
    expect(weekly[0].averageSeconds).toBe(200);
    expect(weekly[0].start).toBe(longer.start);
    expect(weekly.at(-1)?.end).toBe(longer.end);
  });
  it("selects smart defaults without hiding valid aggregation choices", () => {
    for (const [days, daily, weekly] of [
      [1, "daily", "weekly"],
      [31, "daily", "weekly"],
      [32, "weekly", "weekly"],
      [180, "weekly", "weekly"],
      [181, "monthly", "monthly"],
    ] as const) {
      expect(goalDefaultAggregation("Custom", days)).toBe(daily);
      expect(goalDefaultAggregation("All", days, "weekly")).toBe(weekly);
      expect(goalAggregationModes("7D", days)).toEqual(["daily", "weekly", "monthly"]);
    }
  });
  it("keeps zero days and endpoints in a daily cumulative dataset independently of ticks", () => {
    const points = cumulativeDailyFocus([row(23, 100), row(29, 50)], { start: at(9, 22), end: at(10, 1) });
    expect(points).toHaveLength(9);
    expect(points.map((p) => p.cumulativeSeconds)).toEqual([0, 100, 100, 100, 100, 100, 100, 150, 150]);
    expect(dailyTickIndices(9, 300)).toEqual([0, 4, 8]);
    expect(dailyTickIndices(9, 1000)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
  });
  it("uses inclusive rolling calendar dates and equal previous periods across DST", () => {
    for (const [range, count] of [
      ["7D", 7],
      ["30D", 30],
      ["90D", 90],
      ["1Y", 365],
    ] as const) {
      const period = analyticsPeriod(range, [], at(10, 1, 15));
      expect(calendarDays(period)).toBe(count);
      expect(period.end).toBe(at(10, 2));
      expect(calendarDays(previousPeriod(period))).toBe(count);
      expect(previousPeriod(period).end).toBe(period.start);
    }
  });
  it("allows same-day Custom ranges and applies aggregation boundaries", () => {
    for (const [days, mode] of [
      [1, "daily"],
      [90, "daily"],
      [91, "weekly"],
      [365, "weekly"],
      [366, "monthly"],
    ] as const) {
      const period = { start: at(1, 1), end: addDays(at(1, 1), days) };
      expect(defaultAggregation("Custom", period)).toBe(mode);
      expect(calendarBuckets([], period, mode).reduce((sum, bucket) => sum + bucket.days, 0)).toBe(days);
    }
  });
  it("includes zero days and clips partial Monday-Sunday buckets", () => {
    const buckets = calendarBuckets(
      [row(20, 7200), row(21, 3600)],
      { start: at(9, 20), end: at(9, 23) },
      "weekly",
      3600,
    );
    expect(buckets.map((b) => [b.days, b.goalPercent])).toEqual([
      [1, 200],
      [2, 50],
    ]);
    expect(buckets.map((b) => b.sessionCount)).toEqual([1, 1]);
    expect(
      calendarBuckets([], { start: at(9, 20), end: at(9, 23) }, "daily", 0).every((b) =>
        Number.isFinite(b.goalPercent),
      ),
    ).toBe(true);
  });
  it("uses pre-range history for rolling averages but never later sessions", () => {
    const points = rollingTimeline([row(1, 700), row(8, 70), row(9, 9999)], { start: at(9, 7), end: at(9, 9) });
    expect(points.map((p) => p.avg7)).toEqual([100, 10]);
    expect(points[0].avg30).toBeCloseTo(700 / 7);
    expect(points.map((p) => p.seconds)).toEqual([0, 70]);
  });
  it("keeps zero-baseline comparisons finite and explicit", () => {
    expect(percentageChange(100, 0)).toBeUndefined();
    expect(percentageChange(0, 0)).toBe(0);
    expect(percentageChange(0, 100)).toBe(-100);
    expect(percentageChange(108, 100)).toBe(8);
  });
  it("distinguishes the longest streak from the highest-total active run", () => {
    const records = personalBests([row(1, 10), row(2, 10), row(3, 10), row(5, 100), row(6, 100), row(10, 999)], {
      start: at(9, 1),
      end: at(9, 8),
    });
    expect(records.longest).toMatchObject({ days: 3, start: at(9, 1), end: at(9, 4) });
    expect(records.consecutive).toMatchObject({ days: 2, seconds: 200, start: at(9, 5), end: at(9, 7) });
    expect(records.bestDay?.start).toBe(at(9, 5));
    expect(records.longestSession?.startTime).toBe(at(9, 5, 12));
    expect(records.bestWeek?.seconds).toBe(230);
  });
  it("averages weekday buckets over all occurrences, including zero-study weekdays", () => {
    const matrix = averageStudyPattern([row(7, 3600)], { start: at(9, 7), end: at(9, 21) });
    expect(matrix[0][4]).toBe(1800);
    expect(matrix.flat().reduce((a, b) => a + b, 0)).toBe(1800);
  });
});
