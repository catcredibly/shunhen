import { allocatedFocusInRange } from "./sessionAllocation";
import { matchesGoalScope, recoverGoalScope, type GoalScope } from "./goalScope";
import { ALL_SCOPE } from "./linkedScope";
import { selectableSubjects } from "./selectorOptions";
import type { AcademicYear, Subject, FocusSession } from "./types";

/** One eligibility path for goal progress, achievement and completion notifications. */
export function goalScopeSessions(
  sessions: FocusSession[],
  years: AcademicYear[],
  subjects: Subject[],
  scope: GoalScope = ALL_SCOPE,
) {
  scope = recoverGoalScope(scope, years, subjects);
  const eligible = new Map(
    selectableSubjects(years, subjects)
      .filter((subject) => matchesGoalScope(scope, subject))
      .map((subject) => [subject.id, subject]),
  );
  return sessions.filter(
    (session) => !session.archived && session.focusedDurationSeconds > 0 && eligible.has(session.subjectId),
  );
}

export function localDayBounds(now = Date.now()) {
  const date = new Date(now);
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return { start, end: new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime() };
}

export function localWeekBounds(now = Date.now()) {
  const date = new Date(now);
  const mondayOffset = (date.getDay() + 6) % 7;
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate() - mondayOffset).getTime();
  const endDate = new Date(start);
  endDate.setDate(endDate.getDate() + 7);
  return { start, end: endDate.getTime() };
}

export function sessionFocusedSecondsInRange(session: FocusSession, rangeStart: number, rangeEnd: number) {
  return session.archived ? 0 : allocatedFocusInRange(session, rangeStart, rangeEnd);
}

export function goalProgress(sessions: FocusSession[], now = Date.now()) {
  const day = localDayBounds(now),
    week = localWeekBounds(now);
  return {
    dailySeconds: Math.round(
      sessions.reduce((sum, session) => sum + sessionFocusedSecondsInRange(session, day.start, day.end), 0),
    ),
    weeklySeconds: Math.round(
      sessions.reduce((sum, session) => sum + sessionFocusedSecondsInRange(session, week.start, week.end), 0),
    ),
  };
}
