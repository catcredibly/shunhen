import { normalizeNote } from "../notes";
import { sessionInvalidReason } from "../sessionValidity";
import { db, type FocusDatabase } from "../db";
import type { AcademicYear, FocusSession, Subject } from "../types";
import { focusIntervals, normalizeTiming, validateTiming, type Pause } from "../storage/model";
import { requireSourceIdentity } from "../storage/identity";
import { canonicalSession, classifySession, fallbackFingerprint, normalizedName, matchOne } from "./duplicates";
import type { ConflictPolicy, CsvMapping, CsvPreview, CsvPreviewRow, ImportSummary } from "./types";

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
          requireSourceIdentity(session.sourceIdentity),
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
const normalize = normalizedName;
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
  return fallbackFingerprint(
    { ...normalizeTiming(session), manual: session.manual === true, note: session.note },
    session.academicYearName ?? "",
    session.subjectName ?? "",
  );
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
  const groupedYears = new Map<string, AcademicYear[]>();
  for (const year of years)
    groupedYears.set(normalize(year.name), [...(groupedYears.get(normalize(year.name)) ?? []), year]);
  const groupedSubjects = new Map<string, Subject[]>();
  for (const subject of subjects) {
    const key = `${subject.academicYearId}|${normalize(subject.name)}`;
    groupedSubjects.set(key, [...(groupedSubjects.get(key) ?? []), subject]);
  }
  const yearByName = new Map<string, AcademicYear>();
  const subjectByPair = new Map<string, Subject>();
  const fingerprints = new Map<string, number>();
  for (const session of existing) {
    const key = sessionFingerprint(session);
    fingerprints.set(key, (fingerprints.get(key) ?? 0) + 1);
  }
  const sourceKeys = new Map(existing.map((session) => [session.sourceIdentity, session]));
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
    let year =
      !mapping.academicYear && destinationYearId
        ? years.find((year) => year.id === destinationYearId)
        : academicYearName
          ? yearByName.get(normalize(academicYearName))
          : undefined;
    if (!year && academicYearName) {
      try {
        const candidates = groupedYears.get(normalize(academicYearName)) ?? [];
        const picked = matchOne(
          candidates.map((row) => ({ ...row, id: Number(row.id) })),
          "",
          () => "",
          new Set(),
          "Ambiguous Academic Year match.",
        );
        if (picked) {
          year = { ...picked, id: String(picked.id) };
          yearByName.set(normalize(academicYearName), year);
        }
      } catch (error) {
        errors.push((error as Error).message);
      }
    }
    if (academicYearName && !year && !errors.length) {
      year = { id: `preview-year:${academicYearsToCreate.size}`, name: academicYearName, archived: false };
      yearByName.set(normalize(academicYearName), year);
      academicYearsToCreate.add(academicYearName);
    }
    let subject = year && subjectName ? subjectByPair.get(`${year.id}|${normalize(subjectName)}`) : undefined;
    if (year && subjectName && !subject) {
      try {
        const candidates = groupedSubjects.get(`${year.id}|${normalize(subjectName)}`) ?? [];
        const picked = matchOne(
          candidates.map((row) => ({ ...row, id: Number(row.id) })),
          "",
          () => "",
          new Set(),
          "Ambiguous Subject match.",
        );
        if (picked) {
          subject = { ...picked, id: String(picked.id) };
          subjectByPair.set(`${year.id}|${normalize(subjectName)}`, subject);
        }
      } catch (error) {
        errors.push((error as Error).message);
      }
    }
    if (year && subjectName && !subject && !errors.length) {
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
      duplicate = false,
      conflict = false;
    let duplicateKind: "identity" | "fingerprint" | undefined;
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
        session.sourceIdentity = normalizedCsv
          ? requireSourceIdentity(record["Source Identity"])
          : legacyCsv && externalId
            ? requireSourceIdentity(`legacy-session:${externalId}`)
            : undefined;
        if (session.sourceIdentity) {
          const content = canonicalSession(
            { ...timing, manual: session.manual === true, note: session.note },
            session.subjectId,
          );
          const pending = pendingSources.get(session.sourceIdentity);
          if (pending) {
            if (pending !== content) errors.push("Conflicting Session identities in import.");
            else {
              duplicate = true;
              duplicateKind = "identity";
            }
          } else {
            const match = sourceKeys.get(session.sourceIdentity);
            if (match) {
              const same =
                classifySession({ ...timing, manual: session.manual === true, note: session.note }, session.subjectId, {
                  ...normalizeTiming(match),
                  id: Number(match.id),
                  subjectId: Number(match.subjectId),
                  manual: match.manual === true,
                  note: match.note,
                  sourceIdentity: match.sourceIdentity!,
                }) === "duplicate";
              duplicate = same;
              conflict = !same;
              if (same) duplicateKind = "identity";
            }
            pendingSources.set(session.sourceIdentity, content);
          }
        } else {
          const key = sessionFingerprint(session),
            count = fingerprints.get(key) ?? 0;
          duplicate = count > 0;
          if (duplicate) duplicateKind = "fingerprint";
          if (count) fingerprints.set(key, count - 1);
        }
      } catch (error) {
        errors.push(error instanceof Error ? error.message : "Invalid session");
      }
    }
    return { rowNumber: index + 2, session, academicYearName, subjectName, errors, duplicate, duplicateKind, conflict };
  });
  const conflictingIdentities = new Set(
    rows
      .filter((row) => row.errors.includes("Conflicting Session identities in import."))
      .map((row) => row.session?.sourceIdentity),
  );
  for (const row of rows)
    if (row.session?.sourceIdentity && conflictingIdentities.has(row.session.sourceIdentity)) {
      row.duplicate = false;
      if (!row.errors.includes("Conflicting Session identities in import."))
        row.errors.push("Conflicting Session identities in import.");
    }
  return {
    sourceText: text,
    destinationYearId,
    identityConflict: conflictingIdentities.size > 0,
    headers: parsed.headers,
    rows,
    mapping,
    recognizedFocusCsv: normalizedCsv || legacyCsv,
    academicYearsToCreate: [...academicYearsToCreate],
    subjectsToCreate: [...subjectsToCreate.values()],
  };
}

export async function importCsvPreview(
  preview: CsvPreview,
  database: FocusDatabase = db,
  policy: ConflictPolicy = "keep-existing",
): Promise<ImportSummary> {
  const summary: ImportSummary = {
    academicYearsCreated: 0,
    subjectsCreated: 0,
    sessionsImported: 0,
    duplicatesSkipped: 0,
    conflicts: 0,
    invalidRowsSkipped: 0,
  };
  await database.transaction("rw", async (database) => {
    // Recompute against the transaction snapshot instead of trusting a stale preview.
    preview = await previewCsv(preview.sourceText, preview.mapping, preview.destinationYearId, database);
    if (preview.identityConflict) throw new Error("Conflicting Session identities in import.");
    const ambiguity = preview.rows.flatMap((row) => row.errors).find((error) => error.startsWith("Ambiguous "));
    if (ambiguity) throw new Error(ambiguity);
    const years = await database.academicYears.toArray(),
      subjects: Subject[] = await database.subjects.toArray();
    for (const row of preview.rows) {
      if (row.errors.length || !row.session) {
        summary.invalidRowsSkipped++;
        if (row.errors.some((error) => error.includes("conflicts"))) summary.conflicts++;
        continue;
      }
      if (row.duplicate) {
        summary.duplicatesSkipped++;
        continue;
      }
      if (row.conflict) {
        summary.conflicts++;
        if (policy === "keep-existing") continue;
      }
      const yearCandidates = years.filter((year) => normalize(year.name) === normalize(row.academicYearName!));
      const yearMatch = matchOne(
        yearCandidates
          .filter((year) => !/^\d+$/.test(row.session!.academicYearId) || year.id === row.session!.academicYearId)
          .map((row) => ({ ...row, id: Number(row.id) })),
        "",
        () => "",
        new Set(),
        "Ambiguous Academic Year match.",
      );
      let year: AcademicYear | undefined = yearMatch ? { ...yearMatch, id: String(yearMatch.id) } : undefined;
      if (!year) {
        year = { id: "", name: row.academicYearName!, archived: false };
        await database.academicYears.add(year);
        years.push(year);
        summary.academicYearsCreated++;
      }
      const subjectCandidates = subjects.filter(
        (subject) => subject.academicYearId === year!.id && normalize(subject.name) === normalize(row.subjectName!),
      );
      const subjectMatch = matchOne(
        subjectCandidates
          .filter((subject) => !/^\d+$/.test(row.session!.subjectId) || subject.id === row.session!.subjectId)
          .map((row) => ({ ...row, id: Number(row.id) })),
        "",
        () => "",
        new Set(),
        "Ambiguous Subject match.",
      );
      let subject: Subject | undefined = subjectMatch ? { ...subjectMatch, id: String(subjectMatch.id) } : undefined;
      if (!subject) {
        subject = { id: "", academicYearId: year.id, name: row.subjectName!, color: "#4da3ff", archived: false };
        await database.subjects.add(subject);
        subjects.push(subject);
        summary.subjectsCreated++;
      }
      const session = { ...row.session, id: "", subjectId: subject.id, academicYearId: year.id };
      await database.sessions.putNormalized(
        {
          ...normalizeTiming(session),
          subjectId: Number(subject.id),
          manual: session.manual === true,
          note: session.note,
          sourceIdentity: session.sourceIdentity,
        },
        row.conflict === true,
      );
      summary.sessionsImported++;
      if (sessionInvalidReason(session, year))
        summary.invalidSessionsImported = (summary.invalidSessionsImported ?? 0) + 1;
    }
  });
  return summary;
}
