import { synchronizeStartup } from "../autostart";
import { sessionInvalidReason } from "../sessionValidity";
import packageMetadata from "../../package.json";
import { db, type FocusDatabase } from "../db";
import { loadSettings, normalizeLegacyRevealShortcut, SETTINGS_KEYS, type FocusSettings } from "../settings";
import {
  normalizeLegacy,
  validateData,
  COLOR_PALETTE,
  focusIntervals,
  type NormalizedData,
  type LegacyData,
  type StoredSession,
} from "../storage/model";
import { readNormalized, validateDatabase } from "../storage/migration";
import type { AcademicYear, Subject, FocusSession } from "../types";
import type { BackupAnalysis, ConflictPolicy, FocusBackup, ImportSummary, RestoreMode } from "./types";

export const BACKUP_FORMAT = "focus-backup" as const;
export const BACKUP_VERSION = 2 as const;
export const APP_VERSION = packageMetadata.version;
const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export async function createBackup(database: FocusDatabase = db): Promise<FocusBackup> {
  const current = await loadSettings(database);
  const data = await database.transaction("r", (database) => readNormalized(database));
  const settings = new Map(
    data.settings.filter((row) => row.key !== "popoutCloseOnCompletion").map((row) => [row.key, row]),
  );
  for (const key of Object.keys(SETTINGS_KEYS) as (keyof FocusSettings)[])
    settings.set(SETTINGS_KEYS[key], { key: SETTINGS_KEYS[key], value: String(current[key]) });
  data.settings = [...settings.values()];
  validateData(data);
  return {
    format: BACKUP_FORMAT,
    formatVersion: 2,
    exportedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    data,
  };
}

export function validateBackup(value: unknown): FocusBackup {
  if (!object(value) || value.format !== BACKUP_FORMAT) throw new Error("This is not a Shunhen backup.");
  if (value.formatVersion !== 1 && value.formatVersion !== 2)
    throw new Error(`Unsupported Shunhen backup version: ${String(value.formatVersion)}.`);
  if (
    typeof value.exportedAt !== "string" ||
    typeof value.appVersion !== "string" ||
    !object(value.data) ||
    ![value.data.academicYears, value.data.subjects, value.data.sessions, value.data.settings].every(Array.isArray)
  )
    throw new Error("The backup data structure is incomplete.");
  const data =
    value.formatVersion === 1
      ? normalizeLegacy(value.data as unknown as LegacyData).data
      : (value.data as unknown as NormalizedData);
  validateData(data);
  return { format: BACKUP_FORMAT, formatVersion: 2, exportedAt: value.exportedAt, appVersion: value.appVersion, data };
}

export function sessionView(row: StoredSession, subject: Subject, year: AcademicYear): FocusSession {
  return {
    id: String(row.id),
    subjectId: subject.id,
    academicYearId: year.id,
    subjectName: subject.name,
    academicYearName: year.name,
    startTime: row.startedAt * 1000,
    endTime: (row.startedAt + row.elapsedSeconds) * 1000,
    focusedDurationSeconds: row.elapsedSeconds - row.pauses.reduce((sum, pause) => sum + pause.durationSeconds, 0),
    focusIntervals: focusIntervals(row.startedAt, row.elapsedSeconds, row.pauses),
    manual: row.manual ? true : undefined,
    note: row.note,
    archived: subject.archived || year.archived,
    sourceIdentity: row.sourceIdentity,
  };
}

const comparable = (row: StoredSession) =>
  JSON.stringify([row.startedAt, row.elapsedSeconds, row.pauses, row.note ?? null, row.manual]);
const yearDetails = (row: { startDate?: string; endDate?: string; archived: boolean }) =>
  JSON.stringify([row.startDate ?? null, row.endDate ?? null, row.archived]);
const subjectDetails = (row: { colorId: number; archived: boolean }) => JSON.stringify([row.colorId, row.archived]);
const parentNames = (data: NormalizedData, row: StoredSession) => {
  const subject = data.subjects.find((subject) => subject.id === row.subjectId)!;
  return JSON.stringify([subject.name, data.academicYears.find((year) => year.id === subject.academicYearId)!.name]);
};
export async function analyzeBackup(backup: FocusBackup, database: FocusDatabase = db): Promise<BackupAnalysis> {
  validateData(backup.data);
  const existing = await database.transaction("r", (database) => readNormalized(database));
  const sources = new Map(existing.sessions.map((row) => [row.sourceIdentity, row]));
  let duplicates = 0,
    conflicts = 0;
  for (const row of backup.data.sessions) {
    const match = sources.get(row.sourceIdentity);
    if (match)
      comparable(row) === comparable(match) && parentNames(backup.data, row) === parentNames(existing, match)
        ? duplicates++
        : conflicts++;
  }
  const usedYears = new Set<number>(),
    usedSubjects = new Set<number>();
  for (const row of backup.data.academicYears) {
    const match = existing.academicYears.find((year) => year.name === row.name && !usedYears.has(year.id));
    if (match) {
      usedYears.add(match.id);
      yearDetails(row) === yearDetails(match) ? duplicates++ : conflicts++;
    }
  }
  for (const row of backup.data.subjects) {
    const yearName = backup.data.academicYears.find((year) => year.id === row.academicYearId)!.name;
    const match = existing.subjects.find(
      (subject) =>
        subject.name === row.name &&
        !usedSubjects.has(subject.id) &&
        existing.academicYears.find((year) => year.id === subject.academicYearId)?.name === yearName,
    );
    if (match) {
      usedSubjects.add(match.id);
      subjectDetails(row) === subjectDetails(match) ? duplicates++ : conflicts++;
    }
  }
  const settings = new Map(existing.settings.map((row) => [row.key, row.value]));
  for (const row of backup.data.settings)
    if (settings.has(row.key)) settings.get(row.key) === row.value ? duplicates++ : conflicts++;
  return { backup, duplicates, conflicts };
}

export async function restoreBackup(
  backup: FocusBackup,
  mode: RestoreMode,
  policy: ConflictPolicy,
  database: FocusDatabase = db,
): Promise<ImportSummary> {
  validateData(backup.data);
  const summary: ImportSummary = {
    academicYearsCreated: 0,
    subjectsCreated: 0,
    sessionsImported: 0,
    duplicatesSkipped: 0,
    conflicts: 0,
    invalidRowsSkipped: 0,
  };
  const importedStartup = backup.data.settings.find((row) => row.key === SETTINGS_KEYS.launchAtStartup);
  const existingStartup = await database.settings.get(SETTINGS_KEYS.launchAtStartup);
  const requested =
    importedStartup && (mode === "replace" || policy === "use-imported" || !existingStartup)
      ? importedStartup.value === "true"
      : undefined;
  await synchronizeStartup(database, requested, (verified) =>
    database.transaction("rw", async (database) => {
      if (mode === "replace") {
        await database.academicYears.clear();
        await database.settings.clear();
      }
      const years: AcademicYear[] = await database.academicYears.toArray(),
        subjects: Subject[] = await database.subjects.toArray();
      const originalYearIds = new Set(years.map((row) => row.id)),
        originalSubjectIds = new Set(subjects.map((row) => row.id));
      const usedYears = new Set<string>(),
        usedSubjects = new Set<string>();
      const existingSessions = new Map((await readNormalized(database)).sessions.map((row) => [row.id, row]));
      const yearMap = new Map<number, AcademicYear>(),
        subjectMap = new Map<number, Subject>();
      for (const row of backup.data.academicYears) {
        // Local numeric IDs are deliberately ignored on merge. Match named parents
        // within this database, then allocate new IDs for new entities.
        let match = years.find(
          (year) => year.name === row.name && originalYearIds.has(year.id) && !usedYears.has(year.id),
        );
        if (!match) {
          match = { ...row, id: "" };
          await database.academicYears.add(match);
          years.push(match);
          summary.academicYearsCreated++;
        } else {
          if (yearDetails(match) === yearDetails(row)) summary.duplicatesSkipped++;
          else summary.conflicts++;
          if (policy === "use-imported") {
            match = { ...row, id: match.id };
            await database.academicYears.put(match);
          }
        }
        usedYears.add(match.id);
        yearMap.set(row.id, match);
      }
      for (const row of backup.data.subjects) {
        const year = yearMap.get(row.academicYearId)!;
        let match = subjects.find(
          (subject) =>
            subject.academicYearId === year.id &&
            subject.name === row.name &&
            originalSubjectIds.has(subject.id) &&
            !usedSubjects.has(subject.id),
        );
        const value = {
          id: "",
          academicYearId: year.id,
          name: row.name,
          color: COLOR_PALETTE[row.colorId],
          archived: row.archived,
        };
        if (!match) {
          match = value;
          await database.subjects.add(match);
          subjects.push(match);
          summary.subjectsCreated++;
        } else {
          if (
            subjectDetails({
              colorId: COLOR_PALETTE.indexOf(match.color as (typeof COLOR_PALETTE)[number]),
              archived: match.archived,
            }) === subjectDetails(row)
          )
            summary.duplicatesSkipped++;
          else summary.conflicts++;
          if (policy === "use-imported") {
            match = { ...value, id: match.id };
            await database.subjects.put(match);
          }
        }
        usedSubjects.add(match.id);
        subjectMap.set(row.id, match);
      }
      for (const row of backup.data.sessions) {
        const subject = subjectMap.get(row.subjectId)!,
          year = yearMap.get(backup.data.subjects.find((subject) => subject.id === row.subjectId)!.academicYearId)!;
        const existing = await database.sessions.getBySource(row.sourceIdentity);
        if (existing) {
          const normalized = existingSessions.get(Number(existing.id))!;
          if (comparable(normalized) === comparable(row) && existing.subjectId === subject.id) {
            summary.duplicatesSkipped++;
            continue;
          }
          summary.conflicts++;
          if (policy !== "use-imported") continue;
        }
        const view = sessionView(row, subject, year);
        view.id = existing?.id ?? "";
        await database.sessions.put(view);
        summary.sessionsImported++;
        if (sessionInvalidReason(view, year))
          summary.invalidSessionsImported = (summary.invalidSessionsImported ?? 0) + 1;
      }
      for (const setting of backup.data.settings) {
        if ([SETTINGS_KEYS.launchAtStartup, "popoutCloseOnCompletion"].includes(setting.key)) continue;
        const existing = await database.settings.get(setting.key);
        let value = setting.value;
        if (["defaultSubjectId", "lastSubjectId"].includes(setting.key))
          value = value ? (subjectMap.get(Number(value))?.id ?? "") : "";
        if (setting.key === "currentAcademicYearId") value = value ? (yearMap.get(Number(value))?.id ?? "") : "";
        if (setting.key === SETTINGS_KEYS.popoutRevealShortcut) value = normalizeLegacyRevealShortcut(value);
        if (!existing || policy === "use-imported" || mode === "replace")
          await database.settings.put({ key: setting.key, value });
        else if (existing.value === value) summary.duplicatesSkipped++;
        else summary.conflicts++;
      }
      await database.settings.put({ key: SETTINGS_KEYS.launchAtStartup, value: String(verified) });
      await validateDatabase(database);
    }),
  );
  return summary;
}

export function parseBackupText(text: string) {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("The selected file is not valid JSON.");
  }
  return validateBackup(value);
}
export function backupFilename(now = new Date()) {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  return `shunhen-backup-${local}.json`;
}
