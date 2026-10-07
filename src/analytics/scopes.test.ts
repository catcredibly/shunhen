import { describe, expect, it } from "vitest";
import { goalProgress } from "../goals";
import type { FocusSession } from "../types";
import en from "../i18n/en";
import zhCN from "../i18n/zh-CN";
import zhTW from "../i18n/zh-TW";
import ja from "../i18n/ja";
import { analyticsScopes } from "./scopes";
import { goalAchievement } from "./goalAchievement";
import { summaryMetrics } from "./periods";

const at = (day: number, hour = 0) => new Date(2026, 8, day, hour).getTime();
const now = at(30, 18);
const session = (id: string, day: number, subjectId: string, academicYearId: string): FocusSession => ({
  id,
  subjectId,
  academicYearId,
  subjectName: subjectId,
  academicYearName: academicYearId,
  startTime: at(day, 12),
  endTime: at(day, 13),
  focusedDurationSeconds: 3600,
  archived: false,
});
const sessions = [
  session("a", 30, "physics", "2025"),
  session("b", 30, "math", "2025"),
  session("c", 30, "art", "2026"),
  session("d", 29, "art", "2026"),
  session("e", 10, "physics", "2025"),
];
const year = { id: "2025", name: "2025", archived: false, startDate: "2026-09-01", endDate: "2026-09-20" };
const baseline = analyticsScopes(sessions, {}, "30D", now);

describe("goal filter independence", () => {
  it.each([
    ["Subject", { academicYearId: "2025", subjectId: "physics" }],
    ["Academic Year", { academicYearId: "2025" }],
    ["empty Subject", { academicYearId: "2025", subjectId: "missing" }],
  ])("keeps Daily, Weekly and Time Trends goals independent of %s", (_label, filters) => {
    const scope = analyticsScopes(sessions, filters, "30D", now, undefined, year);
    expect(goalProgress(scope.goalHistory, now).dailySeconds).toBe(10800);
    expect(goalProgress(scope.goalHistory, now).weeklySeconds).toBe(14400);
    expect(goalProgress(scope.goalHistory, now)).toEqual(goalProgress(baseline.goalHistory, now));
    expect(scope.goalPeriod).toEqual(baseline.goalPeriod);
    for (const mode of ["daily", "weekly"] as const) {
      const grouping = mode === "daily" ? "daily" : "weekly";
      expect(goalAchievement(scope.goalHistory, scope.goalPeriod, mode, grouping, 7200, now)).toEqual(
        goalAchievement(baseline.goalHistory, baseline.goalPeriod, mode, grouping, 7200, now),
      );
    }
    // The regular charts retain their selected scope and historical-year anchor.
    expect(scope.period.end).toBe(at(21));
    expect(scope.history.length).toBeLessThan(baseline.history.length);
    expect(summaryMetrics(scope.history, scope.period)).not.toEqual(summaryMetrics(baseline.history, baseline.period));
  });

  it("keeps Time Range effective for goals and ordinary metrics", () => {
    const short = analyticsScopes(sessions, {}, "7D", now);
    const total = (scope: typeof baseline) =>
      goalAchievement(scope.goalHistory, scope.goalPeriod, "daily", "daily", 7200, now).reduce(
        (sum, point) => sum + point.seconds,
        0,
      );
    expect(total(short)).toBe(14400);
    expect(total(baseline)).toBe(18000);
    expect(summaryMetrics(short.history, short.period)).not.toEqual(summaryMetrics(baseline.history, baseline.period));
    // Overview goals do not inherit the selected Analytics time range.
    expect(goalProgress(short.goalHistory, now)).toEqual(goalProgress(baseline.goalHistory, now));
  });

  it("keeps All and Custom goal boundaries independent of year and subject", () => {
    const all = analyticsScopes(
      sessions,
      { academicYearId: "2025", subjectId: "physics" },
      "All",
      now,
      undefined,
      year,
    );
    expect(all.goalPeriod).toEqual(analyticsScopes(sessions, {}, "All", now).goalPeriod);
    const custom = { start: at(29), end: at(31) };
    const scope = analyticsScopes(sessions, { academicYearId: "2025" }, "Custom", now, custom, year);
    expect(scope.goalPeriod).toEqual(custom);
    expect(
      goalAchievement(scope.goalHistory, scope.goalPeriod, "daily", "daily", 7200, now).reduce(
        (sum, point) => sum + point.seconds,
        0,
      ),
    ).toBe(14400);
  });

  it("preserves Subject and Academic Year filtering for ordinary metrics", () => {
    const custom = { start: at(29), end: at(31) };
    const all = analyticsScopes(sessions, {}, "Custom", now, custom);
    const byYear = analyticsScopes(sessions, { academicYearId: "2025" }, "Custom", now, custom);
    const bySubject = analyticsScopes(
      sessions,
      { academicYearId: "2025", subjectId: "physics" },
      "Custom",
      now,
      custom,
    );
    expect(all.filtered).toHaveLength(4);
    expect(byYear.filtered).toHaveLength(2);
    expect(bySubject.filtered).toHaveLength(1);
    expect(summaryMetrics(all.history, custom)[0]).toBe(14400);
    expect(summaryMetrics(byYear.history, custom)[0]).toBe(7200);
    expect(summaryMetrics(bySubject.history, custom)[0]).toBe(3600);
  });

  it("provides the exact tooltip text in all four languages", () => {
    const key = "Academic Year and Subject filters do not affect goals. Goal scope can be configured in Settings.";
    expect([en[key], zhCN[key], zhTW[key], ja[key]]).toEqual([
      key,
      "学年和科目筛选不会影响目标。可在设置中配置目标范围。",
      "學年和科目篩選不會影響目標。可在設定中配置目標範圍。",
      "学年と科目のフィルターは目標には影響しません。目標範囲は設定で変更できます。",
    ]);
  });
});
