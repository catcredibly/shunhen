import type { AcademicYear, FocusSession, Subject } from "../types";
import { subjectTotals, localDayKey, startOfLocalWeek } from "./analytics";
import { orderSubjectsForStack } from "./subjectStack";
import { addDays, calendarDays, type Aggregation, type Period } from "./periods";
import type { AllocationReader } from "./snapshot";
export function prepareSubjectAnalytics(
  sessions: FocusSession[],
  history: FocusSession[],
  subjects: Subject[],
  years: AcademicYear[],
  period: Period,
  locale: string,
  getDays: AllocationReader,
) {
  const rows = subjectTotals(sessions, subjects, getDays),
    total = rows.reduce((sum, row) => sum + row.seconds, 0);
  const names = new Map(
    rows.map((row) => [row.subjectId, `${row.name} · ${years.find((y) => y.id === row.academicYearId)?.name ?? ""}`]),
  );
  const shareRows = subjectTotals(
    history.filter((session) => session.startTime < period.end && session.endTime > period.start),
    subjects,
    getDays,
  );
  const stackedShareRows = orderSubjectsForStack(shareRows);
  const shareNames = new Map(
    shareRows.map((row) => [
      row.subjectId,
      row.name + " · " + (years.find((year) => year.id === row.academicYearId)?.name ?? ""),
    ]),
  );
  const days = calendarDays(period);
  const shareAggregation: Aggregation = days <= 14 ? "daily" : days <= 60 ? "weekly" : "monthly";
  const totals = new Map<string, Map<string, number>>();
  for (const session of history)
    for (const day of getDays(session)) {
      if (day.start < period.start || day.start >= period.end || day.seconds <= 0) continue;
      const date = new Date(day.start);
      const key = localDayKey(
        shareAggregation === "daily"
          ? day.start
          : shareAggregation === "weekly"
            ? startOfLocalWeek(day.start)
            : new Date(date.getFullYear(), date.getMonth(), 1).getTime(),
      );
      const values = totals.get(key) ?? new Map<string, number>();
      values.set(session.subjectId, (values.get(session.subjectId) ?? 0) + day.seconds);
      totals.set(key, values);
    }
  const share = [...totals]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, values]) => {
      const sum = [...values.values()].reduce((a, b) => a + b, 0);
      const bucketStart = new Date(`${key}T00:00:00`).getTime();
      const date = new Date(Math.max(bucketStart, period.start));
      const formatter = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric" });
      const label =
        shareAggregation === "monthly"
          ? date.toLocaleDateString(locale, { month: "short", year: "numeric" })
          : shareAggregation === "weekly"
            ? formatter.formatRange(date, new Date(addDays(Math.min(addDays(bucketStart, 7), period.end), -1)))
            : formatter.format(date);
      return {
        key,
        label,
        yearLabel: String(date.getFullYear()),
        dateLabel: date.toLocaleDateString(
          locale,
          shareAggregation === "monthly" ? { month: "short" } : { day: "numeric", month: "short" },
        ),
        shares: Object.fromEntries(
          shareRows.map((row) => [row.subjectId, ((values.get(row.subjectId) ?? 0) / sum) * 100]),
        ),
      };
    });
  return { rows, total, names, shareRows, stackedShareRows, shareNames, share, shareAggregation };
}

export type SubjectSharePoint = ReturnType<typeof prepareSubjectAnalytics>["share"][number];
