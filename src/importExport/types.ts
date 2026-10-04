import type { FocusSession } from "../types";

import type { NormalizedData, StoredYear, StoredSubject, StoredSession } from "../storage/model";

export type FocusBackup = {
  format: "shunhen-backup";
  formatVersion: 2;
  exportedAt?: string;
  appVersion: string;
  academicYears: StoredYear[];
  subjects: StoredSubject[];
  sessions: (Omit<StoredSession, "sourceIdentity"> & { sourceIdentity?: string })[];
  settings: Record<string, string>;
  /** Read compatibility for earlier v2 files; never emitted by current exports. */
  sessionIdentities?: Record<string, string>;
};

/** Validated internal import model shared by legacy and logical v2 parsers. */
export type NormalizedBackup = {
  format: "shunhen-backup";
  formatVersion: 2;
  exportedAt?: string;
  appVersion: string;
  data: NormalizedData;
  unidentifiedSessionIds?: number[];
  repeatedSessions?: number;
};

export type ConflictPolicy = "keep-existing" | "use-imported";
export type RestoreMode = "merge" | "replace";

export type ImportSummary = {
  academicYearsCreated: number;
  subjectsCreated: number;
  sessionsImported: number;
  invalidSessionsImported?: number;
  duplicatesSkipped: number;
  conflicts: number;
  invalidRowsSkipped: number;
};

export type BackupAnalysis = {
  backup: NormalizedBackup;
  duplicates: number;
  conflicts: number;
  ambiguities?: string[];
};

export type CsvMapping = Partial<
  Record<
    | "sessionId"
    | "academicYear"
    | "subject"
    | "startDate"
    | "startTime"
    | "endDate"
    | "endTime"
    | "startDateTime"
    | "endDateTime"
    | "focusedMinutes"
    | "note"
    | "archived",
    string
  >
>;

export type CsvPreviewRow = {
  rowNumber: number;
  session?: FocusSession;
  academicYearName?: string;
  subjectName?: string;
  errors: string[];
  duplicate: boolean;
  duplicateKind?: "identity" | "fingerprint";
  conflict?: boolean;
};

export type CsvPreview = {
  sourceText: string;
  destinationYearId?: string;
  identityConflict?: boolean;
  headers: string[];
  rows: CsvPreviewRow[];
  mapping: CsvMapping;
  recognizedFocusCsv: boolean;
  academicYearsToCreate: string[];
  subjectsToCreate: Array<{ academicYearName: string; subjectName: string }>;
};
