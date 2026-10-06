import { expect, it } from "vitest";
import { prepareSubjectAnalytics } from "./subjectData";
import { dailyFocusAllocations } from "../sessionAllocation";
import { addDays } from "./periods";
import type { FocusSession } from "../types";

const at = (month: number, day: number, hour = 0) => new Date(2026, month - 1, day, hour).getTime();
const years = [{ id: "y", name: "Year", archived: false }];
const subjects = [
  { id: "a", name: "A", academicYearId: "y", color: "#4da3ff", archived: false },
  { id: "b", name: "B", academicYearId: "y", color: "#ff4d57", archived: false },
];
const session = (startTime: number, seconds = 3600, subjectId = "a"): FocusSession => ({
  id: `${subjectId}:${startTime}`,
  subjectId,
  subjectName: subjectId.toUpperCase(),
  academicYearId: "y",
  academicYearName: "Year",
  startTime,
  endTime: startTime + seconds * 1000,
  focusedDurationSeconds: seconds,
  archived: false,
});
const prepare = (history: FocusSession[], start: number, end: number) =>
  prepareSubjectAnalytics(history, history, subjects, years, { start, end }, "en", dailyFocusAllocations);

it.each([
  [1, "daily"],
  [14, "daily"],
  [15, "weekly"],
  [60, "weekly"],
  [61, "monthly"],
])("uses the requested granularity for %i days", (days, aggregation) => {
  const start = at(9, 20);
  expect(prepare([], start, addDays(start, Number(days))).shareAggregation).toBe(aggregation);
});

it("omits empty daily buckets without synthesizing Subject shares", () => {
  const data = prepare(
    [session(at(10, 1, 12)), session(at(10, 2, 12)), session(at(10, 5, 12), 3600, "b")],
    at(10, 1),
    at(10, 8),
  );
  expect(data.share.map((point) => point.key)).toEqual(["2026-10-01", "2026-10-02", "2026-10-05"]);
  expect(data.share.map((point) => point.shares)).toEqual([
    { a: 100, b: 0 },
    { a: 100, b: 0 },
    { a: 0, b: 100 },
  ]);
  for (const point of data.share) {
    expect(point).not.toHaveProperty("displayShares");
    expect(point).not.toHaveProperty("carriedForward");
    expect(point.dateLabel).not.toContain("2026");
  }
});

it("uses Monday weeks, preserves partial boundary labels and omits empty weeks", () => {
  const data = prepare([session(at(10, 4, 12)), session(at(10, 13, 12), 3600, "b")], at(10, 1), at(10, 16));
  expect(data.share.map((point) => point.key)).toEqual(["2026-09-28", "2026-10-12"]);
  expect(data.share[0].label).toContain("Oct");
  expect(data.share.map((point) => point.shares)).toEqual([
    { a: 100, b: 0 },
    { a: 0, b: 100 },
  ]);
});

it("keeps only observed months and calculates shares from dates inside the selected range", () => {
  const data = prepare(
    [session(at(1, 10), 9999), session(at(1, 20), 5400), session(at(1, 21), 1800, "b"), session(at(3, 5), 3600)],
    at(1, 15),
    at(4, 15),
  );
  expect(data.share.map((point) => point.key)).toEqual(["2026-01-01", "2026-03-01"]);
  expect(data.share[0].shares).toEqual({ a: 75, b: 25 });
  expect(data.share[1].shares).toEqual({ a: 100, b: 0 });
  expect(data.share.map((point) => point.dateLabel)).toEqual(["Jan", "Mar"]);
  expect(data.share.every((point) => Object.values(point.shares).reduce((sum, value) => sum + value, 0) === 100)).toBe(
    true,
  );
});

it("allocates overnight focus across daily buckets", () => {
  const data = prepare([session(at(10, 1, 23), 7200), session(at(10, 2, 12), 3600, "b")], at(10, 1), at(10, 3));
  expect(data.share[0].shares).toEqual({ a: 100, b: 0 });
  expect(data.share[1].shares).toEqual({ a: 50, b: 50 });
});

it("returns no buckets for a wholly empty range", () => {
  const data = prepare([], at(10, 1), at(10, 8));
  expect(data.share).toEqual([]);
  expect(data.shareRows).toEqual([]);
});
