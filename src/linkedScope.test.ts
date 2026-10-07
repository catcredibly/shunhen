import { expect, it } from "vitest";
import {
  ALL_SCOPE,
  changeSubjectScope,
  changeYearScope,
  matchesLinkedScope,
  subjectSelection,
  normalizeLinkedScope,
  remapLinkedScope,
} from "./linkedScope";
import { goalScopeSessions, goalProgress } from "./goals";
import { analyticsScopes } from "./analytics/scopes";
import { goalAchievement } from "./analytics/goalAchievement";
import { subjectOptions, searchSelectorOptions, selectableSubjects } from "./selectorOptions";
import type { AcademicYear, Subject, FocusSession } from "./types";
const years: AcademicYear[] = [
  { id: "1", name: "IB", archived: false },
  { id: "2", name: "University", archived: false },
  { id: "3", name: "Archived", archived: true },
];
const subject = (id: string, academicYearId: string, archived = false): Subject => ({
  id,
  academicYearId,
  name: id,
  color: "#4da3ff",
  archived,
});
const subjects = [
  subject("11", "1"),
  subject("12", "1"),
  subject("21", "2"),
  subject("22", "2"),
  subject("31", "3"),
  subject("13", "1", true),
];
it.each([["1"], ["2"], ["1", "2"], []].map((yearIds) => ({ yearIds })))(
  "every parent scope change resets custom Subjects to semantic All: %j",
  ({ yearIds }) => {
    const scope = { yearIds: ["1"], subjectIds: ["11"] };
    expect(changeYearScope(scope, yearIds)).toEqual({ yearIds, subjectIds: [] });
  },
);
it("Subject scope is one-directional and searching cannot expose another year", () => {
  const scope = changeSubjectScope({ ...ALL_SCOPE, yearIds: ["1", "2"] }, ["21"], subjects);
  expect(scope.yearIds).toEqual(["1", "2"]);
  expect(subjectSelection(scope, subjects)).toEqual(["21"]);
  expect(matchesLinkedScope(scope, subjects[0])).toBe(false);
  expect(searchSelectorOptions(subjectOptions(years, subjects, ["1"]), "31")).toEqual([]);
});
it("manual restoration normalizes to All; All is dynamic but custom scopes stay custom", () => {
  const initial = { ...ALL_SCOPE, yearIds: ["1"] };
  expect(changeSubjectScope(initial, ["11", "12", "13"], subjects)).toEqual(initial);
  expect(matchesLinkedScope(initial, subject("14", "1"))).toBe(true);
  const custom = changeSubjectScope(initial, ["11"], subjects);
  expect(matchesLinkedScope(custom, subject("14", "1"))).toBe(false);
  expect(changeSubjectScope(initial, ["11"], subjects, false).subjectIds).toEqual(["11"]);
});
it("keeps unmatched custom IDs without accidentally turning them into All", () => {
  const scope = { ...ALL_SCOPE, subjectIds: ["999"] };
  expect(subjectSelection(scope, subjects)).toEqual(["999"]);
  expect(matchesLinkedScope(scope, subjects[0])).toBe(false);
});
const now = new Date(2026, 9, 7, 18).getTime(),
  day = new Date(2026, 9, 7, 12).getTime();
const session = (id: string, subjectId: string, academicYearId: string, startTime = day): FocusSession => ({
  id,
  subjectId,
  academicYearId,
  subjectName: "Subject",
  academicYearName: "Year",
  startTime,
  endTime: startTime + 3600000,
  focusedDurationSeconds: 3600,
  archived: false,
});
const sessions = [
  session("1", "11", "1"),
  session("2", "21", "2"),
  session("3", "31", "3"),
  session("4", "13", "1"),
  session("5", "missing", "1"),
];
it("one active-only Goal scope drives Daily, Weekly and range-bound Achievement independently of page filters", () => {
  const scope = { ...ALL_SCOPE, yearIds: ["1"] };
  const eligible = goalScopeSessions(sessions, years, subjects, scope);
  expect(eligible.map((row) => row.id)).toEqual(["1"]);
  expect(goalProgress(eligible, now)).toEqual({ dailySeconds: 3600, weeklySeconds: 3600 });
  const custom = { start: day - 1000, end: day + 86400000 };
  const goalContext = { years, subjects, scope };
  const first = analyticsScopes(sessions, {}, "Custom", now, custom, undefined, goalContext);
  const filtered = analyticsScopes(
    sessions,
    { academicYearId: "2", subjectId: "21" },
    "Custom",
    now,
    custom,
    undefined,
    goalContext,
  );
  expect(first.goalHistory).toEqual(filtered.goalHistory);
  expect(filtered.filtered.map((row) => row.id)).toEqual(["2"]);
  expect(first.goalPeriod).toEqual(custom);
  expect(
    goalAchievement(first.goalHistory, custom, "daily", "daily", 7200, now).reduce((sum, row) => sum + row.seconds, 0),
  ).toBe(3600);
  expect(
    goalAchievement(first.goalHistory, { start: day - 86400000, end: day }, "daily", "daily", 7200, now).reduce(
      (sum, row) => sum + row.seconds,
      0,
    ),
  ).toBe(0);
});
it("archive changes, stale IDs, and empty active eligibility never fall back to inactive data", () => {
  expect(
    goalScopeSessions(
      sessions,
      years.map((year) => ({ ...year, archived: true })),
      subjects,
    ),
  ).toEqual([]);
  expect(goalScopeSessions(sessions, years, subjects, { ...ALL_SCOPE, subjectIds: ["999"] })).toHaveLength(2);
  expect(goalScopeSessions(sessions, years, subjects)).toHaveLength(2);
  expect(
    goalScopeSessions(
      sessions,
      years,
      subjects.map((row) => ({ ...row, archived: true })),
    ),
  ).toEqual([]);
  expect(selectableSubjects(years, subjects).map((row) => row.id)).toEqual(["11", "12", "21", "22"]);
});
it("remaps explicit IDs and ignores unresolved references safely", () => {
  const scope = normalizeLinkedScope({ yearIds: ["1"], subjectIds: ["11", "999"] });
  const result = remapLinkedScope(scope, new Map([[1, "7"]]), new Map([[11, "71"]]));
  expect(result).toEqual({ yearIds: ["7"], subjectIds: ["71", "missing:999"] });
  expect(normalizeLinkedScope(result)).toEqual(result);
  expect(normalizeLinkedScope(undefined)).toEqual(ALL_SCOPE);
});
it("reads earlier per-year refinements without writing obsolete metadata", () => {
  const result = normalizeLinkedScope(
    { yearIds: [], subjectIds: ["11"], allSubjectYearIds: ["2"], knownYearIds: ["1", "2", "3"] },
    subjects,
  );
  expect(result).toEqual({ yearIds: [], subjectIds: ["11", "21", "22"] });
});
