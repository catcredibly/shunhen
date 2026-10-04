import type { FocusSession } from "../types";

export type FocusBackup = {
  format: "focus-backup";
  formatVersion: 2;
  exportedAt: string;
  appVersion: string;
  data: import("../storage/model").NormalizedData;
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
  backup: FocusBackup;
  duplicates: number;
  conflicts: number;
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
};

export type CsvPreview = {
  headers: string[];
  rows: CsvPreviewRow[];
  mapping: CsvMapping;
  recognizedFocusCsv: boolean;
  academicYearsToCreate: string[];
  subjectsToCreate: Array<{ academicYearName: string; subjectName: string }>;
};
