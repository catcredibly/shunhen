import type { AcademicYear, Subject, FocusSession, AppSetting } from "../types";
import { colorId, validateData, type NormalizedData } from "../storage/model";
import { isSourceIdentity } from "../storage/identity";
import { normalizeNote } from "../notes";
import { convertLegacyFileTiming } from "./legacyTiming";

export type BackupV1Session = Omit<FocusSession, "manual"> & { manual?: boolean; legacyContinuous?: true };
export type BackupV1Data = {
  academicYears: AcademicYear[];
  subjects: (Subject & { archivedBeforeParent?: boolean })[];
  sessions: BackupV1Session[];
  settings: AppSetting[];
};

export function convertBackupV1(data: BackupV1Data) {
  const yearMap = new Map<string, number>(),
    subjectMap = new Map<string, number>();
  const mapIds = (rows: { id: string }[], map: Map<string, number>) =>
    rows.forEach((row, index) => {
      if (typeof row.id !== "string" || !row.id || map.has(row.id)) throw new Error("Invalid legacy IDs.");
      map.set(row.id, index + 1);
    });
  mapIds(data.academicYears, yearMap);
  mapIds(data.subjects, subjectMap);
  const sessionIds = new Set<string>();
  const academicYears = data.academicYears.map((row) => ({
    id: yearMap.get(row.id)!,
    name: row.name,
    startDate: row.startDate || undefined,
    endDate: row.endDate || undefined,
    archived: row.archived ?? false,
  }));
  const subjects = data.subjects.map((row) => ({
    id: subjectMap.get(row.id)!,
    academicYearId: yearMap.get(row.academicYearId)!,
    name: row.name,
    colorId: colorId(row.color),
    archived: row.archivedBeforeParent ?? row.archived ?? false,
  }));
  const sessions = data.sessions.map((row, index) => {
    if (typeof row.id !== "string" || !row.id || sessionIds.has(row.id)) throw new Error("Invalid legacy Session ID.");
    sessionIds.add(row.id);
    if (row.note !== undefined && typeof row.note !== "string") throw new Error("Invalid legacy note.");
    const timing = convertLegacyFileTiming({
      ...row,
      focusedDurationSeconds: row.focusedDurationSeconds ?? (row.endTime - row.startTime) / 1000,
    });
    return {
      id: index + 1,
      subjectId: subjectMap.get(row.subjectId)!,
      ...timing,
      note: row.note === undefined ? undefined : normalizeNote(row.note),
      manual: row.manual === true,
      sourceIdentity: isSourceIdentity(row.sourceIdentity) ? row.sourceIdentity : `legacy-session:${row.id}`,
    };
  });
  const settings = data.settings.map((row) => {
    if (["defaultSubjectId", "lastSubjectId"].includes(row.key))
      return { ...row, value: row.value ? String(subjectMap.get(row.value) ?? "") : "" };
    if (row.key === "currentAcademicYearId")
      return { ...row, value: row.value ? String(yearMap.get(row.value) ?? "") : "" };
    return { ...row };
  });
  const normalized = { academicYears, subjects, sessions, settings };
  validateData(normalized);
  return { data: normalized, yearMap, subjectMap };
}

const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const rows = (value: unknown): Record<string, unknown>[] => {
  if (!Array.isArray(value) || !value.every(object)) throw new Error("The legacy backup data structure is incomplete.");
  return value;
};

export function parseBackupV1(value: Record<string, unknown>): NormalizedData {
  if (!object(value.data)) throw new Error("The legacy backup data structure is incomplete.");
  const { data } = value;
  for (const table of ["academicYears", "subjects", "sessions", "settings"]) rows(data[table]);
  if (value.sessionTimingVersion !== undefined && value.sessionTimingVersion !== 1)
    throw new Error("Unsupported legacy Session timing version.");
  for (const row of rows(data.sessions)) {
    if (
      typeof row.startTime !== "number" ||
      !Number.isFinite(row.startTime) ||
      typeof row.endTime !== "number" ||
      !Number.isFinite(row.endTime) ||
      row.endTime <= row.startTime ||
      typeof row.focusedDurationSeconds !== "number" ||
      !Number.isFinite(row.focusedDurationSeconds) ||
      row.focusedDurationSeconds <= 0 ||
      (row.manual !== undefined && typeof row.manual !== "boolean") ||
      (row.legacyContinuous !== undefined && row.legacyContinuous !== true)
    )
      throw new Error("Invalid legacy Session timing.");
  }
  // The v1 converter resolves Subject -> Year before discarding snapshots;
  // precise intervals win, while absent intervals retain the legacy continuous rule.
  return convertBackupV1(data as unknown as BackupV1Data).data;
}
