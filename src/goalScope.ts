import type { AcademicYear, Subject } from "./types";
import { normalizeLinkedScope, remapLinkedScope, scopedSubjects, type LinkedScope } from "./linkedScope";

/** Automatically included Goal years use Subject exceptions; other scopes remain explicit. */
export type GoalScope = LinkedScope & { automaticYearIds?: string[]; excludedAutomaticSubjectIds?: string[] };
export function normalizeGoalScope(value: unknown, subjects?: Pick<Subject, "id" | "academicYearId">[]): GoalScope {
  const scope = normalizeLinkedScope(value, subjects);
  const source = value as GoalScope | undefined;
  const automaticYearIds = normalizeLinkedScope({ yearIds: source?.automaticYearIds }).yearIds;
  const excludedAutomaticSubjectIds = normalizeLinkedScope({
    subjectIds: source?.excludedAutomaticSubjectIds,
  }).subjectIds;
  return scope.subjectIds.length && automaticYearIds.length
    ? { ...scope, automaticYearIds, ...(excludedAutomaticSubjectIds.length ? { excludedAutomaticSubjectIds } : {}) }
    : scope;
}
export function includeAutomaticGoalYear(
  scope: GoalScope,
  yearId: string,
  subjects: Pick<Subject, "id" | "academicYearId">[] = [],
): GoalScope {
  const excluded = (scope.excludedAutomaticSubjectIds ?? []).filter(
    (id) => !subjects.some((subject) => subject.id === id && subject.academicYearId === yearId),
  );
  return {
    yearIds: scope.yearIds.length ? [...new Set([...scope.yearIds, yearId])] : [],
    subjectIds: scope.subjectIds,
    ...(scope.subjectIds.length
      ? {
          automaticYearIds: [...new Set([...(scope.automaticYearIds ?? []), yearId])],
          ...(excluded.length ? { excludedAutomaticSubjectIds: excluded } : {}),
        }
      : {}),
  };
}
export function includeAutomaticGoalSubject(
  scope: GoalScope,
  subject: Pick<Subject, "id" | "academicYearId">,
): GoalScope {
  if (
    !scope.automaticYearIds?.includes(subject.academicYearId) ||
    !scope.excludedAutomaticSubjectIds?.includes(subject.id)
  )
    return scope;
  const excluded = scope.excludedAutomaticSubjectIds.filter((id) => id !== subject.id);
  const { excludedAutomaticSubjectIds: _previous, ...rest } = scope;
  return excluded.length ? { ...rest, excludedAutomaticSubjectIds: excluded } : rest;
}
export function matchesGoalScope(scope: GoalScope, subject: Subject) {
  return (
    (!scope.yearIds.length || scope.yearIds.includes(subject.academicYearId)) &&
    (!scope.subjectIds.length ||
      (scope.automaticYearIds?.includes(subject.academicYearId)
        ? !scope.excludedAutomaticSubjectIds?.includes(subject.id)
        : scope.subjectIds.includes(subject.id)))
  );
}
export function goalSubjectSelection(scope: GoalScope, subjects: Subject[]) {
  if (!scope.subjectIds.length) return scope.subjectIds;
  const visible = scopedSubjects(scope, subjects)
    .filter((subject) => matchesGoalScope(scope, subject))
    .map((subject) => subject.id);
  return [...new Set([...scope.subjectIds.filter((id) => !subjects.some((subject) => subject.id === id)), ...visible])];
}
export function refineGoalSubjects(previous: GoalScope, next: LinkedScope, subjects: Subject[]): GoalScope {
  if (!next.subjectIds.length || !previous.automaticYearIds?.length) return next;
  const automaticYearIds = previous.automaticYearIds;
  const excludedAutomaticSubjectIds = [
    ...new Set([
      ...(previous.excludedAutomaticSubjectIds ?? []).filter((id) => !subjects.some((subject) => subject.id === id)),
      ...subjects
        .filter((subject) => automaticYearIds.includes(subject.academicYearId) && !next.subjectIds.includes(subject.id))
        .map((subject) => subject.id),
    ]),
  ];
  return { ...next, automaticYearIds, ...(excludedAutomaticSubjectIds.length ? { excludedAutomaticSubjectIds } : {}) };
}
/** Recover with semantic All, never an arbitrary surviving item. Empty universes remain temporary. */
export function recoverGoalScope(scope: GoalScope, years: AcademicYear[], subjects?: Subject[]): GoalScope {
  const activeYears = years.filter((year) => !year.archived);
  if (!activeYears.length) return scope;
  if (scope.yearIds.length && !activeYears.some((year) => scope.yearIds.includes(year.id)))
    return { yearIds: [], subjectIds: [] };
  if (subjects) {
    const active = subjects.filter(
      (subject) => !subject.archived && activeYears.some((year) => year.id === subject.academicYearId),
    );
    const inYears = active.filter((subject) => !scope.yearIds.length || scope.yearIds.includes(subject.academicYearId));
    if (!inYears.length && active.length) return { yearIds: [], subjectIds: [] };
    if (scope.subjectIds.length && inYears.length && !inYears.some((subject) => matchesGoalScope(scope, subject)))
      return { yearIds: scope.yearIds, subjectIds: [] };
  }
  return scope;
}

export function remapGoalScope(scope: GoalScope, years: Map<number, string>, subjects: Map<number, string>): GoalScope {
  const remapped = remapLinkedScope(scope, years, subjects);
  return scope.automaticYearIds?.length
    ? {
        ...remapped,
        automaticYearIds: remapLinkedScope({ yearIds: scope.automaticYearIds, subjectIds: [] }, years, subjects)
          .yearIds,
        ...(scope.excludedAutomaticSubjectIds?.length
          ? {
              excludedAutomaticSubjectIds: remapLinkedScope(
                { yearIds: [], subjectIds: scope.excludedAutomaticSubjectIds },
                years,
                subjects,
              ).subjectIds,
            }
          : {}),
      }
    : remapped;
}
