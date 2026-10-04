import { normalizeNote } from "../notes";
import { sessionInvalidReason } from "../sessionValidity";
import { db, type FocusDatabase } from "../db";
import type { AcademicYear, FocusSession, Subject } from "../types";
import { focusIntervals, normalizeTiming, validateTiming, type Pause } from "../storage/model";
import type { CsvMapping, CsvPreview, CsvPreviewRow, ImportSummary } from "./types";

export const FOCUS_CSV_HEADERS = [
  "Source Identity",
  "Session ID",
  "Academic Year",
  "Subject",
  "Started At",
  "Elapsed Seconds",
  "Pauses",
  "Manual",
  "Note",
];
export const escapeCsv = (value: unknown) => {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};
export function exportSessionsCsv(sessions: FocusSession[]) {
  return (
    "\uFEFF" +
    [
      FOCUS_CSV_HEADERS.join(","),
      ...sessions.map((session) => {
        const timing = normalizeTiming(session);
        return [
          session.sourceIdentity ?? `legacy-session:${session.id}`,
          session.id,
          session.academicYearName,
          session.subjectName,
          timing.startedAt,
          timing.elapsedSeconds,
          JSON.stringify(timing.pauses),
          session.manual === true,
          session.note ?? "",
        ]
          .map(escapeCsv)
          .join(",");
      }),
    ].join("\r\n")
  );
}
export function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  const source = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (character === '"') quoted = false;
      else cell += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n") {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
    } else cell += character;
  }
  if (quoted) throw new Error("CSV contains an unterminated quoted value.");
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  if (!rows.length || !rows[0].some(Boolean)) throw new Error("CSV is empty.");
  const headers = rows[0].map((header) => header.trim());
  return {
    headers,
    records: rows
      .slice(1)
      .filter((row) => row.some((value) => value.trim()))
      .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]))),
  };
}
const normalize = (value: string) => value.trim().toLocaleLowerCase();
export function detectMapping(headers: string[]): CsvMapping {
  const find = (...names: string[]) => headers.find((header) => names.includes(normalize(header)));
  return {
    sessionId: find("session id", "id"),
    academicYear: find("academic year", "academic year name", "year"),
    subject: find("subject", "subject name"),
    startDate: find("start date", "date"),
    startTime: find("start time"),
    endDate: find("end date"),
    endTime: find("end time"),
    startDateTime: find("start datetime", "start", "started at"),
    endDateTime: find("end datetime", "end", "ended at"),
    focusedMinutes: find("focused minutes", "duration", "duration minutes", "minutes"),
    note: find("note", "notes"),
    archived: find("archived"),
  };
}
const combine = (date?: string, time?: string) =>
  date && time ? new Date(`${date.trim()}T${time.trim()}`).getTime() : NaN;
export function sessionFingerprint(
  session: Pick<FocusSession, "startTime" | "endTime" | "focusedDurationSeconds"> & Partial<FocusSession>,
) {
  const timing = normalizeTiming(session);
  return JSON.stringify([
    normalize(session.academicYearName ?? ""),
    normalize(session.subjectName ?? ""),
    timing.startedAt,
    timing.elapsedSeconds,
    timing.pauses,
    session.note ?? "",
    session.manual === true,
  ]);
}

export async function previewCsv(
  text: string,
  mappingOverride?: CsvMapping,
  destinationYearId?: string,
  database: FocusDatabase = db,
): Promise<CsvPreview> {
  const parsed = parseCsv(text),
    mapping = { ...detectMapping(parsed.headers), ...mappingOverride };
  const normalizedCsv = FOCUS_CSV_HEADERS.every((header) => parsed.headers.includes(header));
  const legacyCsv = [
    "Session ID",
    "Academic Year",
    "Subject",
    "Start Date",
    "Start Time",
    "End Date",
    "End Time",
    "Focused Minutes",
    "Archived",
    "Note",
  ].every((header) => parsed.headers.includes(header));
  const {
    years,
    subjects,
    sessions: existing,
  } = await import("../storage/queries").then(({ readHistorySnapshot }) => readHistorySnapshot(database));
  const yearByName = new Map(years.map((year) => [normalize(year.name), year]));
  const subjectByPair = new Map(
    subjects.map((subject) => [`${subject.academicYearId}|${normalize(subject.name)}`, subject]),
  );
  const fingerprints = new Map<string, number>();
  for (const session of existing) {
    const key = sessionFingerprint(session);
    fingerprints.set(key, (fingerprints.get(key) ?? 0) + 1);
  }
  const sourceKeys = new Set(existing.map((session) => session.sourceIdentity));
  const pendingSources = new Map<string, string>();
  const academicYearsToCreate = new Set<string>(),
    subjectsToCreate = new Map<string, { academicYearName: string; subjectName: string }>();
  const rows: CsvPreviewRow[] = parsed.records.map((record, index) => {
    const errors: string[] = [];
    const academicYearName = mapping.academicYear
      ? record[mapping.academicYear]?.trim()
      : years.find((year) => year.id === destinationYearId)?.name;
    const subjectName = mapping.subject ? record[mapping.subject]?.trim() : "";
    if (!academicYearName) errors.push("Academic Year is required.");
    if (!subjectName) errors.push("Subject is required.");
    let year = academicYearName ? yearByName.get(normalize(academicYearName)) : undefined;
    if (academicYearName && !year) {
      year = { id: `preview-year:${academicYearsToCreate.size}`, name: academicYearName, archived: false };
      yearByName.set(normalize(academicYearName), year);
      academicYearsToCreate.add(academicYearName);
    }
    let subject = year && subjectName ? subjectByPair.get(`${year.id}|${normalize(subjectName)}`) : undefined;
    if (year && subjectName && !subject) {
      subject = {
        id: `preview-subject:${subjectsToCreate.size}`,
        academicYearId: year.id,
        name: subjectName,
        color: "#4da3ff",
        archived: false,
      };
      subjectByPair.set(`${year.id}|${normalize(subjectName)}`, subject);
      subjectsToCreate.set(subject.id, { academicYearName: year.name, subjectName });
    }
    let session: FocusSession | undefined,
      duplicate = false;
    if (!errors.length && year && subject) {
      try {
        let startTime = mapping.startDateTime
          ? new Date(record[mapping.startDateTime]).getTime()
          : combine(
              mapping.startDate ? record[mapping.startDate] : undefined,
              mapping.startTime ? record[mapping.startTime] : undefined,
            );
        let endTime = mapping.endDateTime
          ? new Date(record[mapping.endDateTime]).getTime()
          : combine(
              mapping.endDate ? record[mapping.endDate] : mapping.startDate ? record[mapping.startDate] : undefined,
              mapping.endTime ? record[mapping.endTime] : undefined,
            );
        const minutes = mapping.focusedMinutes ? Number(record[mapping.focusedMinutes]) : NaN;
        if (!Number.isFinite(endTime) && Number.isFinite(startTime) && minutes > 0)
          endTime = startTime + minutes * 60000;
        if (normalizedCsv) {
          if (
            !record["Started At"]?.trim() ||
            !record["Source Identity"]?.trim() ||
            !["true", "false"].includes(record["Manual"])
          )
            throw new Error("Incomplete Shunhen Session identity or timing.");
          startTime = Number(record["Started At"]) * 1000;
          endTime = startTime + Number(record["Elapsed Seconds"]) * 1000;
        }
        if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime)
          throw new Error("Valid start and end times are required.");
        session = {
          id: "",
          subjectId: subject.id,
          subjectName: subject.name,
          academicYearId: year.id,
          academicYearName: year.name,
          startTime,
          endTime,
          focusedDurationSeconds: Number.isFinite(minutes) ? minutes * 60 : (endTime - startTime) / 1000,
          archived: subject.archived || year.archived,
          manual: record["Manual"] === "true" ? true : undefined,
          note: mapping.note ? normalizeNote(record[mapping.note] ?? "") || undefined : undefined,
        };
        if (normalizedCsv) {
          const pauses = JSON.parse(record["Pauses"]) as Pause[];
          if (!Array.isArray(pauses)) throw new Error("Invalid Session pauses.");
          const startedAt = Number(record["Started At"]),
            elapsedSeconds = Number(record["Elapsed Seconds"]);
          validateTiming(startedAt, elapsedSeconds, pauses);
          session.focusIntervals = focusIntervals(startedAt, elapsedSeconds, pauses);
          session.focusedDurationSeconds =
            elapsedSeconds - pauses.reduce((sum, pause) => sum + pause.durationSeconds, 0);
        } else {
          if (record["Focus Intervals"]?.trim()) session.focusIntervals = JSON.parse(record["Focus Intervals"]);
          if (record["Legacy Continuous"] === "true") session.legacyContinuous = true;
        }
        const timing = normalizeTiming(session);
        session.startTime = timing.startedAt * 1000;
        session.endTime = (timing.startedAt + timing.elapsedSeconds) * 1000;
        session.focusIntervals = focusIntervals(timing.startedAt, timing.elapsedSeconds, timing.pauses);
        session.focusedDurationSeconds =
          timing.elapsedSeconds - timing.pauses.reduce((sum, pause) => sum + pause.durationSeconds, 0);
        const externalId = mapping.sessionId ? record[mapping.sessionId]?.trim() : "";
        session.sourceIdentity =
          record["Source Identity"]?.trim() ||
          (externalId && legacyCsv
            ? `legacy-session:${externalId}`
            : externalId
              ? `csv-session:${externalId}`
              : undefined);
        if (session.sourceIdentity) {
          duplicate = sourceKeys.has(session.sourceIdentity) || pendingSources.has(session.sourceIdentity);
          if (sourceKeys.has(session.sourceIdentity)) {
            const match = existing.find((row) => row.sourceIdentity === session!.sourceIdentity)!;
            if (sessionFingerprint(match) !== sessionFingerprint(session)) {
              duplicate = false;
              errors.push("Session ID conflicts with an existing record.");
            }
          }
          const pending = pendingSources.get(session.sourceIdentity);
          if (pending && pending !== sessionFingerprint(session)) {
            duplicate = false;
            errors.push("Session ID conflicts with an existing record.");
          }
          pendingSources.set(session.sourceIdentity, sessionFingerprint(session));
        } else {
          const key = sessionFingerprint(session),
            count = fingerprints.get(key) ?? 0;
          duplicate = count > 0;
          if (count) fingerprints.set(key, count - 1);
        }
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "Invalid session");
      }
    }
    return { rowNumber: index + 2, session, academicYearName, subjectName, errors, duplicate };
  });
  return {
    headers: parsed.headers,
    rows,
    mapping,
    recognizedFocusCsv: normalizedCsv || legacyCsv,
    academicYearsToCreate: [...academicYearsToCreate],
    subjectsToCreate: [...subjectsToCreate.values()],
  };
}

export async function importCsvPreview(preview: CsvPreview, database: FocusDatabase = db): Promise<ImportSummary> {
  const summary: ImportSummary = {
    academicYearsCreated: 0,
    subjectsCreated: 0,
    sessionsImported: 0,
    duplicatesSkipped: 0,
    conflicts: 0,
    invalidRowsSkipped: 0,
  };
  await database.transaction("rw", async (database) => {
    const years = await database.academicYears.toArray(),
      subjects = await database.subjects.toArray();
    for (const row of preview.rows) {
      if (row.errors.length || !row.session) {
        summary.invalidRowsSkipped++;
        if (row.errors.some((error) => error.includes("conflicts"))) summary.conflicts++;
        continue;
      }
      if (
        row.duplicate ||
        (row.session.sourceIdentity && (await database.sessions.getBySource(row.session.sourceIdentity)))
      ) {
        summary.duplicatesSkipped++;
        continue;
      }
      let year = years.find((year) => normalize(year.name) === normalize(row.academicYearName!));
      if (!year) {
        year = { id: "", name: row.academicYearName!, archived: false };
        await database.academicYears.add(year);
        years.push(year);
        summary.academicYearsCreated++;
      }
      let subject = subjects.find(
        (subject) => subject.academicYearId === year!.id && normalize(subject.name) === normalize(row.subjectName!),
      );
      if (!subject) {
        subject = { id: "", academicYearId: year.id, name: row.subjectName!, color: "#4da3ff", archived: false };
        await database.subjects.add(subject);
        subjects.push(subject);
        summary.subjectsCreated++;
      }
      const session = { ...row.session, id: "", subjectId: subject.id, academicYearId: year.id };
      await database.sessions.add(session);
      summary.sessionsImported++;
      if (sessionInvalidReason(session, year))
        summary.invalidSessionsImported = (summary.invalidSessionsImported ?? 0) + 1;
    }
  });
  return summary;
}
