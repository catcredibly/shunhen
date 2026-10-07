import { normalizeGoalScope, remapGoalScope } from "../goalScope";
import { synchronizeStartup } from "../autostart";
import { sessionInvalidReason } from "../sessionValidity";
import packageMetadata from "../../package.json";
import { db, type FocusDatabase } from "../db";
import {
  loadSettings,
  encodeSetting,
  normalizeLegacyRevealShortcut,
  SETTINGS_KEYS,
  type FocusSettings,
} from "../settings";
import { validateData, COLOR_PALETTE, focusIntervals, type NormalizedData, type StoredSession } from "../storage/model";
import { readNormalized } from "../storage/snapshot";
import { validateDatabase } from "../storage/validation";
import type { AcademicYear, Subject, FocusSession } from "../types";
import type {
  BackupAnalysis,
  ConflictPolicy,
  FocusBackup,
  NormalizedBackup,
  ImportSummary,
  RestoreMode,
} from "./types";

import { planParents, classifyBackupSessions, uniqueImportSessions } from "./duplicates";
import { logicalBackup, parseBackup } from "./backupFormat";

export const BACKUP_FORMAT = "shunhen-backup" as const;
export const BACKUP_VERSION = 2 as const;
export const APP_VERSION = packageMetadata.version;
export async function createBackup(database: FocusDatabase = db): Promise<FocusBackup> {
  const { current, data } = await database.transaction("r", async (database) => ({
    current: await loadSettings(database, false),
    data: await readNormalized(database),
  }));
  const settings = new Map(
    data.settings.filter((row) => row.key !== "popoutCloseOnCompletion").map((row) => [row.key, row]),
  );
  for (const key of Object.keys(SETTINGS_KEYS) as (keyof FocusSettings)[])
    if (!settings.has(SETTINGS_KEYS[key]))
      settings.set(SETTINGS_KEYS[key], { key: SETTINGS_KEYS[key], value: encodeSetting(key, current[key]) });
  settings.set(SETTINGS_KEYS.goalScope, {
    key: SETTINGS_KEYS.goalScope,
    value: encodeSetting("goalScope", current.goalScope),
  });
  data.settings = [...settings.values()];
  validateData(data);
  return logicalBackup({
    format: BACKUP_FORMAT,
    formatVersion: 2,
    exportedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    data,
  });
}

export const validateBackup = parseBackup;

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

const emptyData = (): NormalizedData => ({ academicYears: [], subjects: [], sessions: [], settings: [] });
function prepareBackup(backup: NormalizedBackup) {
  const unique = uniqueImportSessions(backup.data, backup.unidentifiedSessionIds);
  const activeYears = new Set(unique.data.academicYears.filter((year) => !year.archived).map((year) => year.id));
  const eligible = unique.data.subjects
    .filter((subject) => !subject.archived && activeYears.has(subject.academicYearId))
    .map((subject) => ({ id: String(subject.id), academicYearId: String(subject.academicYearId) }));
  unique.data.settings = unique.data.settings.map((row) => {
    if (row.key !== SETTINGS_KEYS.goalScope) return row;
    try {
      return { ...row, value: JSON.stringify(normalizeGoalScope(JSON.parse(row.value), eligible)) };
    } catch {
      return row;
    }
  });
  validateData(unique.data);
  return { ...backup, data: unique.data, repeatedSessions: (backup.repeatedSessions ?? 0) + unique.repeatedSessions };
}
function remapSetting(key: string, value: string, years: Map<number, string>, subjects: Map<number, string>) {
  if (key === SETTINGS_KEYS.goalScope) {
    try {
      return JSON.stringify(remapGoalScope(normalizeGoalScope(JSON.parse(value)), years, subjects));
    } catch {
      return JSON.stringify(normalizeGoalScope(undefined));
    }
  }
  if (["defaultSubjectId", "lastSubjectId"].includes(key)) return value ? (subjects.get(Number(value)) ?? "") : "";
  if (key === "currentAcademicYearId") return value ? (years.get(Number(value)) ?? "") : "";
  return key === SETTINGS_KEYS.popoutRevealShortcut ? normalizeLegacyRevealShortcut(value) : value;
}
export async function analyzeBackup(
  backup: NormalizedBackup,
  database: FocusDatabase = db,
  mode: RestoreMode = "merge",
): Promise<BackupAnalysis> {
  backup = prepareBackup(backup);
  const existing =
    mode === "replace" ? emptyData() : await database.transaction("r", (database) => readNormalized(database));
  let parents: ReturnType<typeof planParents>;
  try {
    parents = planParents(backup.data, existing);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Ambiguous "))
      return { backup, duplicates: backup.repeatedSessions ?? 0, conflicts: 1, ambiguities: [error.message] };
    throw error;
  }
  const classifications = classifyBackupSessions(backup, existing, parents);
  let duplicates = backup.repeatedSessions ?? 0,
    conflicts = 0;
  for (const match of [...parents.years.values(), ...parents.subjects.values()])
    if (match.existing) match.conflict ? conflicts++ : duplicates++;
  for (const classification of classifications.values()) {
    if (classification === "duplicate" || classification === "probable-duplicate") duplicates++;
    if (classification === "conflict") conflicts++;
  }
  const settings = new Map(existing.settings.map((row) => [row.key, row.value]));
  for (const row of backup.data.settings) {
    if (row.key === "popoutCloseOnCompletion") continue;
    const value = remapSetting(
      row.key,
      row.value,
      new Map([...parents.years].map(([id, match]) => [id, match.destination])),
      new Map([...parents.subjects].map(([id, match]) => [id, match.destination])),
    );
    if (settings.has(row.key)) settings.get(row.key) === value ? duplicates++ : conflicts++;
  }
  return { backup, duplicates, conflicts };
}

export async function restoreBackup(
  backup: NormalizedBackup,
  mode: RestoreMode,
  policy: ConflictPolicy,
  database: FocusDatabase = db,
): Promise<ImportSummary> {
  backup = prepareBackup(backup);
  const summary: ImportSummary = {
    academicYearsCreated: 0,
    subjectsCreated: 0,
    sessionsImported: 0,
    duplicatesSkipped: backup.repeatedSessions ?? 0,
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
      const existing = mode === "replace" ? emptyData() : await readNormalized(database);
      // Resolve everything before the first write; preview uses this identical plan.
      const parents = planParents(backup.data, existing);
      const classifications = classifyBackupSessions(backup, existing, parents);
      if (mode === "replace") {
        await database.academicYears.clear();
        await database.settings.clear();
      }
      const yearMap = new Map<number, AcademicYear>(),
        subjectMap = new Map<number, Subject>();
      for (const row of [...backup.data.academicYears].sort((a, b) => a.id - b.id)) {
        const match = parents.years.get(row.id)!;
        const value: AcademicYear = { ...row, id: match.existing ? String(match.existing.id) : "" };
        if (!match.existing) {
          await database.academicYears.add(value);
          summary.academicYearsCreated++;
        } else {
          match.conflict ? summary.conflicts++ : summary.duplicatesSkipped++;
          if (policy === "use-imported") await database.academicYears.put(value);
          else Object.assign(value, match.existing, { id: String(match.existing.id) });
        }
        yearMap.set(row.id, value);
      }
      for (const row of [...backup.data.subjects].sort((a, b) => a.id - b.id)) {
        const match = parents.subjects.get(row.id)!;
        const value: Subject = {
          id: match.existing ? String(match.existing.id) : "",
          academicYearId: yearMap.get(row.academicYearId)!.id,
          name: row.name,
          color: COLOR_PALETTE[row.colorId],
          archived: row.archived,
        };
        if (!match.existing) {
          await database.subjects.add(value);
          summary.subjectsCreated++;
        } else {
          match.conflict ? summary.conflicts++ : summary.duplicatesSkipped++;
          if (policy === "use-imported") await database.subjects.put(value);
          else
            Object.assign(value, {
              name: match.existing.name,
              color: COLOR_PALETTE[match.existing.colorId],
              archived: match.existing.archived,
            });
        }
        subjectMap.set(row.id, value);
      }
      const sources = new Map(existing.sessions.map((row) => [row.sourceIdentity, row]));
      const unidentified = new Set(backup.unidentifiedSessionIds);
      for (const row of [...backup.data.sessions].sort((a, b) => a.id - b.id)) {
        const classification = classifications.get(row.id)!;
        if (classification === "duplicate" || classification === "probable-duplicate") {
          summary.duplicatesSkipped++;
          continue;
        }
        if (classification === "conflict") {
          summary.conflicts++;
          if (policy === "keep-existing") continue;
        }
        const subject = subjectMap.get(row.subjectId)!;
        const source = unidentified.has(row.id) ? undefined : sources.get(row.sourceIdentity);
        await database.sessions.putNormalized({
          ...row,
          id: source?.id,
          subjectId: Number(subject.id),
          sourceIdentity: unidentified.has(row.id) ? undefined : row.sourceIdentity,
        });
        summary.sessionsImported++;
        const year = yearMap.get(backup.data.subjects.find((subject) => subject.id === row.subjectId)!.academicYearId)!;
        if (sessionInvalidReason(sessionView(row, subject, year), year))
          summary.invalidSessionsImported = (summary.invalidSessionsImported ?? 0) + 1;
      }
      for (const setting of backup.data.settings) {
        if ([SETTINGS_KEYS.launchAtStartup, "popoutCloseOnCompletion"].includes(setting.key)) continue;
        const stored = await database.settings.get(setting.key);
        const value = remapSetting(
          setting.key,
          setting.value,
          new Map([...yearMap].map(([id, row]) => [id, row.id])),
          new Map([...subjectMap].map(([id, row]) => [id, row.id])),
        );
        if (stored) stored.value === value ? summary.duplicatesSkipped++ : summary.conflicts++;
        if (!stored || ((policy === "use-imported" || mode === "replace") && stored.value !== value))
          await database.settings.put({ key: setting.key, value });
      }
      const originalStartup = existing.settings.find((row) => row.key === SETTINGS_KEYS.launchAtStartup);
      if (importedStartup && originalStartup)
        originalStartup.value === importedStartup.value ? summary.duplicatesSkipped++ : summary.conflicts++;
      if ((await database.settings.get(SETTINGS_KEYS.launchAtStartup))?.value !== String(verified))
        await database.settings.put({ key: SETTINGS_KEYS.launchAtStartup, value: String(verified) });
      await database.settings.recoverGoalScope();
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
