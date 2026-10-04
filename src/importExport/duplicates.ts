import type { NormalizedData, StoredSession, StoredSubject, StoredYear } from "../storage/model";
import type { NormalizedBackup } from "./types";
export { requireSourceIdentity } from "../storage/identity";

export const normalizedName = (name: string) => name.normalize("NFC").trim().toLowerCase();
export const academicYearIdentity = (year: Pick<StoredYear, "name">) => normalizedName(year.name);
export const subjectIdentity = (subject: Pick<StoredSubject, "name">, year: string | number) =>
  JSON.stringify([String(year), normalizedName(subject.name)]);
export const yearDetails = (year: Omit<StoredYear, "id" | "name">) =>
  JSON.stringify([year.startDate ?? null, year.endDate ?? null, year.archived]);
export const subjectDetails = (subject: Pick<StoredSubject, "colorId" | "archived">) =>
  JSON.stringify([subject.colorId, subject.archived]);
export type SessionContents = Pick<StoredSession, "startedAt" | "elapsedSeconds" | "pauses" | "manual" | "note">;
export const canonicalSession = (row: SessionContents, destination: string | number) =>
  JSON.stringify([
    String(destination),
    row.startedAt,
    row.elapsedSeconds,
    row.pauses.map(({ offsetSeconds, durationSeconds }) => [offsetSeconds, durationSeconds]),
    row.manual,
    row.note ?? "",
  ]);
export const fallbackFingerprint = (row: SessionContents, yearName: string, subjectName: string) =>
  canonicalSession(row, JSON.stringify([normalizedName(yearName), normalizedName(subjectName)]));
export type SessionClassification = "new" | "duplicate" | "conflict" | "probable-duplicate";
export function classifySession(
  row: SessionContents,
  destination: string | number,
  existing?: StoredSession,
): SessionClassification {
  return !existing
    ? "new"
    : canonicalSession(row, destination) === canonicalSession(existing, existing.subjectId)
      ? "duplicate"
      : "conflict";
}

/** Consume one local parent at most once; an indistinguishable tie is an error. */
export function matchOne<T extends { id: number }>(
  candidates: T[],
  incomingDetails: string,
  details: (row: T) => string,
  used: Set<number>,
  error: string,
): T | undefined {
  const available = candidates.filter((row) => !used.has(row.id)).sort((a, b) => a.id - b.id);
  const exact = available.filter((row) => details(row) === incomingDetails);
  const choices = exact.length ? exact : available;
  if (choices.length > 1) throw new Error(error);
  const match = choices[0];
  if (match) used.add(match.id);
  return match;
}
function matchEntities<T extends { id: number }>(
  incoming: T[],
  existing: T[],
  incomingIdentity: (row: T) => string,
  existingIdentity: (row: T) => string,
  details: (row: T) => string,
  error: string,
) {
  const used = new Set<number>(),
    matches = new Map<number, T | undefined>(),
    deferred: T[] = [];
  for (const row of [...incoming].sort((a, b) => a.id - b.id)) {
    const exact = existing
      .filter(
        (candidate) =>
          !used.has(candidate.id) &&
          existingIdentity(candidate) === incomingIdentity(row) &&
          details(candidate) === details(row),
      )
      .sort((a, b) => a.id - b.id);
    if (exact.length > 1) throw new Error(error);
    if (exact.length === 1) {
      used.add(exact[0].id);
      matches.set(row.id, exact[0]);
    } else deferred.push(row);
  }
  // Reserve unique exact matches across the whole group before resolving conflicts.
  for (const row of deferred)
    matches.set(
      row.id,
      matchOne(
        existing.filter((candidate) => existingIdentity(candidate) === incomingIdentity(row)),
        details(row),
        details,
        used,
        error,
      ),
    );
  return matches;
}
export type ParentPlan = {
  years: Map<number, { destination: string; existing?: StoredYear; conflict: boolean }>;
  subjects: Map<number, { destination: string; existing?: StoredSubject; conflict: boolean }>;
};
export function planParents(incoming: NormalizedData, existing: NormalizedData): ParentPlan {
  const years: ParentPlan["years"] = new Map(),
    subjects: ParentPlan["subjects"] = new Map();
  const yearMatches = matchEntities(
    incoming.academicYears,
    existing.academicYears,
    academicYearIdentity,
    academicYearIdentity,
    yearDetails,
    "Ambiguous Academic Year match.",
  );
  for (const row of [...incoming.academicYears].sort((a, b) => a.id - b.id)) {
    const match = yearMatches.get(row.id);
    years.set(row.id, {
      destination: match ? String(match.id) : `new-year:${row.id}`,
      existing: match,
      conflict: !!match && yearDetails(match) !== yearDetails(row),
    });
  }
  const subjectMatches = matchEntities(
    incoming.subjects,
    existing.subjects,
    (row) => subjectIdentity(row, years.get(row.academicYearId)!.destination),
    (row) => subjectIdentity(row, row.academicYearId),
    subjectDetails,
    "Ambiguous Subject match.",
  );
  for (const row of [...incoming.subjects].sort((a, b) => a.id - b.id)) {
    const match = subjectMatches.get(row.id);
    subjects.set(row.id, {
      destination: match ? String(match.id) : `new-subject:${row.id}`,
      existing: match,
      conflict: !!match && subjectDetails(match) !== subjectDetails(row),
    });
  }
  return { years, subjects };
}

export function classifyBackupSessions(backup: NormalizedBackup, existing: NormalizedData, parents: ParentPlan) {
  const sources = new Map(existing.sessions.map((row) => [row.sourceIdentity, row]));
  const counts = new Map<string, number>();
  for (const row of existing.sessions) {
    const subject = existing.subjects.find((subject) => subject.id === row.subjectId)!;
    const year = existing.academicYears.find((year) => year.id === subject.academicYearId)!;
    const fingerprint = fallbackFingerprint(row, year.name, subject.name);
    counts.set(fingerprint, (counts.get(fingerprint) ?? 0) + 1);
  }
  const unidentified = new Set(backup.unidentifiedSessionIds);
  return new Map(
    [...backup.data.sessions]
      .sort((a, b) => a.id - b.id)
      .map((row) => {
        let classification: SessionClassification;
        if (!unidentified.has(row.id))
          classification = classifySession(
            row,
            parents.subjects.get(row.subjectId)!.destination,
            sources.get(row.sourceIdentity),
          );
        else {
          const subject = backup.data.subjects.find((subject) => subject.id === row.subjectId)!;
          const year = backup.data.academicYears.find((year) => year.id === subject.academicYearId)!;
          const fingerprint = fallbackFingerprint(row, year.name, subject.name),
            count = counts.get(fingerprint) ?? 0;
          classification = count > 0 ? "probable-duplicate" : "new";
          if (count > 0) counts.set(fingerprint, count - 1);
        }
        return [row.id, classification] as const;
      }),
  );
}

/** Validate the entire import before writes; repeated identical identities coalesce. */
export function uniqueImportSessions(data: NormalizedData, unidentified: number[] = []) {
  const sources = new Map<string, StoredSession>(),
    unknown = new Set(unidentified);
  let repeatedSessions = 0;
  const sessions: StoredSession[] = [];
  for (const row of data.sessions) {
    const previous = unknown.has(row.id) ? undefined : sources.get(row.sourceIdentity);
    if (previous) {
      if (canonicalSession(previous, previous.subjectId) !== canonicalSession(row, row.subjectId))
        throw new Error("Conflicting Session identities in import.");
      repeatedSessions++;
    } else {
      sessions.push(row);
      if (!unknown.has(row.id)) sources.set(row.sourceIdentity, row);
    }
  }
  return { data: { ...data, sessions }, repeatedSessions };
}
