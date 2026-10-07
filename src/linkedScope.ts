import type { Subject } from "./types";
import { subjectsInYears } from "./selectorOptions";

/** Empty arrays are semantic All; a custom Subject scope stores included IDs. */
export type LinkedScope = { yearIds: string[]; subjectIds: string[] };
export const ALL_SCOPE: LinkedScope = { yearIds: [], subjectIds: [] };
export function normalizeLinkedScope(value: unknown, subjects?: Pick<Subject, "id" | "academicYearId">[]): LinkedScope {
  if (!value || typeof value !== "object") return { ...ALL_SCOPE };
  const source = value as Partial<LinkedScope> & { allSubjectYearIds?: string[]; knownYearIds?: string[] };
  const ids = (value: unknown) =>
    Array.isArray(value)
      ? [
          ...new Set(
            value.filter((id): id is string => typeof id === "string" && /^(?:[1-9]\d*|missing:[1-9]\d*)$/.test(id)),
          ),
        ]
      : [];
  const yearIds = ids(source.yearIds),
    subjectIds = ids(source.subjectIds);
  // Read compatibility for the earlier, unreleased per-year refinement setting.
  if (subjectIds.length && subjects) {
    const allYears = ids(source.allSubjectYearIds),
      knownYears = source.knownYearIds ? ids(source.knownYearIds) : undefined;
    for (const subject of subjects)
      if (
        (!yearIds.length || yearIds.includes(subject.academicYearId)) &&
        (allYears.includes(subject.academicYearId) ||
          (!yearIds.length && knownYears && !knownYears.includes(subject.academicYearId))) &&
        !subjectIds.includes(subject.id)
      )
        subjectIds.push(subject.id);
  }
  return { yearIds, subjectIds };
}
export function scopedSubjects(scope: LinkedScope, subjects: Subject[]) {
  return subjectsInYears(subjects, scope.yearIds);
}
export function subjectSelection(scope: LinkedScope, subjects: Subject[]) {
  if (!scope.subjectIds.length) return scope.subjectIds;
  // Retain unmatched IDs so stale custom settings never accidentally become All.
  return [
    ...new Set([
      ...scope.subjectIds.filter((id) => !subjects.some((subject) => subject.id === id)),
      ...scopedSubjects(scope, subjects)
        .filter((subject) => scope.subjectIds.includes(subject.id))
        .map((subject) => subject.id),
    ]),
  ];
}
export function changeYearScope(_scope: LinkedScope, yearIds: string[]): LinkedScope {
  return { yearIds, subjectIds: [] };
}
export function changeSubjectScope(
  scope: LinkedScope,
  subjectIds: string[],
  subjects: Subject[],
  multiple = true,
): LinkedScope {
  const eligible = scopedSubjects(scope, subjects);
  const all =
    !subjectIds.length ||
    (multiple && eligible.length > 0 && eligible.every((subject) => subjectIds.includes(subject.id)));
  return { yearIds: scope.yearIds, subjectIds: all ? [] : [...new Set(subjectIds)] };
}
export function matchesLinkedScope(scope: LinkedScope, subject: Subject) {
  return (
    (!scope.yearIds.length || scope.yearIds.includes(subject.academicYearId)) &&
    (!scope.subjectIds.length || scope.subjectIds.includes(subject.id))
  );
}
export function remapLinkedScope(
  scope: LinkedScope,
  years: Map<number, string>,
  subjects: Map<number, string>,
): LinkedScope {
  const remap = (ids: string[], map: Map<number, string>) =>
    ids.map((id) => map.get(Number(id)) ?? (id.startsWith("missing:") ? id : "missing:" + id));
  return { yearIds: remap(scope.yearIds, years), subjectIds: remap(scope.subjectIds, subjects) };
}
