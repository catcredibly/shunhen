import { goalScopeSessions } from "../goals";
import type { LinkedScope } from "../linkedScope";
import type { AcademicYear, Subject, FocusSession } from "../types";
import { filterSessions, type AnalyticsFilters } from "./analytics";
import { analyticsPeriod, type AnalyticsRange, type Period } from "./periods";

/** Persistent Goal scope shares the time range, never temporary page filters. */
export function analyticsScopes(
  sessions: FocusSession[],
  filters: Pick<AnalyticsFilters, "academicYearId" | "subjectId" | "academicYearIds" | "subjectIds">,
  range: AnalyticsRange,
  now: number,
  customRange?: Period,
  year?: AcademicYear,
  goals?: { years: AcademicYear[]; subjects: Subject[]; scope: LinkedScope },
) {
  const history = filterSessions(sessions, filters);
  const period = analyticsPeriod(range, history, now, customRange, year);
  const all = filterSessions(sessions);
  const goalHistory = goals ? goalScopeSessions(all, goals.years, goals.subjects, goals.scope) : all;
  return {
    history,
    period,
    filtered: filterSessions(history, period),
    goalHistory,
    goalPeriod: analyticsPeriod(range, all, now, customRange),
  };
}
