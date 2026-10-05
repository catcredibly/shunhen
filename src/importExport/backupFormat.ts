import { validateData, type NormalizedData } from "../storage/model";
import { parseBackupV1 } from "./backupV1";
import { newSourceIdentity, requireSourceIdentity, isSourceIdentity } from "../storage/identity";
import { uniqueImportSessions } from "./duplicates";
import type { FocusBackup, NormalizedBackup } from "./types";

const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const rows = (value: unknown): Record<string, unknown>[] => {
  if (!Array.isArray(value) || !value.every(object)) throw new Error("The backup data structure is incomplete.");
  return value;
};
const fields = (row: Record<string, unknown>, allowed: string[]) => {
  if (Object.keys(row).some((key) => !allowed.includes(key))) throw new Error("Unexpected backup field.");
};

/** Portable logical records; implementation tables and derived Session values never leak. */
export function logicalBackup(backup: NormalizedBackup): FocusBackup {
  const { data } = backup;
  validateData(data);
  return {
    format: "shunhen-backup",
    formatVersion: 2,
    exportedAt: backup.exportedAt,
    appVersion: backup.appVersion,
    academicYears: data.academicYears.map(({ id, name, startDate, endDate, archived }) => ({
      id,
      name,
      startDate,
      endDate,
      archived,
    })),
    subjects: data.subjects.map(({ id, academicYearId, name, colorId, archived }) => ({
      id,
      academicYearId,
      name,
      colorId,
      archived,
    })),
    sessions: data.sessions.map(
      ({ id, sourceIdentity, subjectId, startedAt, elapsedSeconds, note, manual, pauses }) => ({
        id,
        sourceIdentity,
        subjectId,
        startedAt,
        elapsedSeconds,
        note,
        manual,
        pauses: pauses.map(({ offsetSeconds, durationSeconds }) => ({ offsetSeconds, durationSeconds })),
      }),
    ),
    settings: Object.fromEntries(data.settings.map(({ key, value }) => [key, value])),
  };
}

function parseV2(value: Record<string, unknown>, unidentified: number[]): NormalizedData {
  fields(value, [
    "format",
    "formatVersion",
    "appVersion",
    "exportedAt",
    "academicYears",
    "subjects",
    "sessions",
    "settings",
    "sessionIdentities",
  ]);
  const academicYears = rows(value.academicYears).map((row) => {
    fields(row, ["id", "name", "startDate", "endDate", "archived"]);
    return { ...row };
  });
  const subjects = rows(value.subjects).map((row) => {
    fields(row, ["id", "academicYearId", "name", "colorId", "archived"]);
    return { ...row };
  });
  if (!object(value.settings)) throw new Error("Invalid Settings object.");
  const identities = value.sessionIdentities === undefined ? {} : value.sessionIdentities;
  if (!object(identities)) throw new Error("Invalid Session identities.");
  const sessions: Record<string, unknown>[] = rows(value.sessions).map((row) => {
    fields(row, ["id", "sourceIdentity", "subjectId", "startedAt", "elapsedSeconds", "note", "manual", "pauses"]);
    const pauses = rows(row.pauses).map((pause) => {
      fields(pause, ["offsetSeconds", "durationSeconds"]);
      return { ...pause };
    });
    const mappedIdentity = identities[String(row.id)];
    if (mappedIdentity !== undefined && row.sourceIdentity !== undefined && mappedIdentity !== row.sourceIdentity)
      throw new Error("Conflicting Session identities in import.");
    const identity = row.sourceIdentity ?? (isSourceIdentity(mappedIdentity) ? mappedIdentity : undefined);
    if (identity === undefined) unidentified.push(row.id as number);
    const sourceIdentity = identity === undefined ? newSourceIdentity() : requireSourceIdentity(identity);
    return { ...row, pauses, sourceIdentity };
  });
  for (const [id, identity] of Object.entries(identities)) {
    if (!sessions.some((row) => String(row.id) === id) || typeof identity !== "string" || !identity)
      throw new Error("Invalid Session identities.");
  }
  const data = {
    academicYears,
    subjects,
    sessions,
    settings: Object.entries(value.settings).map(([key, value]) => ({ key, value })),
  } as unknown as NormalizedData;
  return data;
}

export function parseBackup(value: unknown): NormalizedBackup {
  if (!object(value) || !["shunhen-backup", "focus-backup"].includes(String(value.format)))
    throw new Error("This is not a Shunhen backup.");
  if (value.formatVersion !== 1 && value.formatVersion !== 2)
    throw new Error(`Unsupported Shunhen backup version: ${String(value.formatVersion)}.`);
  if (typeof value.appVersion !== "string" || (value.exportedAt !== undefined && typeof value.exportedAt !== "string"))
    throw new Error("The backup header is incomplete.");
  let data: NormalizedData;
  const unidentifiedSessionIds: number[] = [];
  if (value.formatVersion === 1) data = parseBackupV1(value);
  else if (value.format === "shunhen-backup") data = parseV2(value, unidentifiedSessionIds);
  else {
    // Explicit compatibility adapter for SQLite backups emitted before the logical
    // v2 envelope was introduced. New exports never use this representation.
    if (!object(value.data)) throw new Error("The previous SQLite backup structure is incomplete.");
    for (const table of ["academicYears", "subjects", "sessions", "settings"]) rows(value.data[table]);
    data = structuredClone(value.data) as unknown as NormalizedData;
    for (const row of data.sessions)
      if (!isSourceIdentity(row.sourceIdentity)) {
        unidentifiedSessionIds.push(row.id);
        row.sourceIdentity = newSourceIdentity();
      }
  }
  const unique = uniqueImportSessions(data, unidentifiedSessionIds);
  validateData(unique.data);
  return {
    format: "shunhen-backup",
    formatVersion: 2,
    unidentifiedSessionIds,
    repeatedSessions: unique.repeatedSessions,
    exportedAt: value.exportedAt as string | undefined,
    appVersion: value.appVersion,
    data: unique.data,
  };
}
