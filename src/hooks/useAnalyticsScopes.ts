import { useMemo } from "react";
import type { AcademicYear, FocusSession } from "../types";
import { filterSessions, type AnalyticsFilters } from "../analytics/analytics";
import { analyticsPeriod, type AnalyticsRange, type Period } from "../analytics/periods";
/** Filters depend on the snapshot; calendar refreshes do not recreate unchanged scopes. */
export function useAnalyticsScopes(
  sessions: FocusSession[],
  yearIds: string[],
  subjectIds: string[],
  ignoreFilters: boolean,
  range: AnalyticsRange,
  today: number,
  custom?: Period,
  year?: AcademicYear,
  scopedGoals?: FocusSession[],
) {
  const history = useMemo(
    () =>
      filterSessions(
        sessions,
        ignoreFilters
          ? {}
          : ({
              academicYearIds: yearIds,
              subjectIds,
            } satisfies AnalyticsFilters),
      ),
    [sessions, yearIds, subjectIds, ignoreFilters],
  );
  const goalHistory = scopedGoals ?? sessions;
  const period = useMemo(
    () => analyticsPeriod(range, history, today, custom, year),
    [range, history, today, custom?.start, custom?.end, year],
  );
  const goalPeriod = useMemo(
    () => analyticsPeriod(range, sessions, today, custom),
    [range, sessions, today, custom?.start, custom?.end],
  );
  const filtered = useMemo(() => filterSessions(history, period), [history, period.start, period.end]);
  return { history, goalHistory, period, goalPeriod, filtered };
}
