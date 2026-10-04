import { noteMetrics } from "./notes";
import { db, type FocusDatabase } from "./db";
import type { AcademicYear, FocusSession, Subject } from "./types";
import { localeCode } from "./i18n";

export function formatDurationForLocale(totalSeconds: number, locale = localeCode()) {
  const total = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const number = new Intl.NumberFormat(locale);
  const units =
    locale === "zh-CN"
      ? ["小时", "分钟", "秒"]
      : locale === "zh-TW"
        ? ["小時", "分鐘", "秒"]
        : locale === "ja"
          ? ["時間", "分", "秒"]
          : ["hr", "min", "sec"];
  if (hours && minutes) return `${number.format(hours)} ${units[0]} ${number.format(minutes)} ${units[1]}`;
  if (hours) return `${number.format(hours)} ${units[0]}`;
  if (minutes) return `${number.format(minutes)} ${units[1]}`;
  return `${number.format(total)} ${units[2]}`;
}

export function formatDuration(totalSeconds: number) {
  return formatDurationForLocale(totalSeconds);
}

export function formatDurationAxisForLocale(totalSeconds: number, locale = localeCode()) {
  const total = Math.max(0, totalSeconds);
  const units =
    locale === "zh-CN"
      ? ["小时", "分钟", "秒"]
      : locale === "zh-TW"
        ? ["小時", "分鐘", "秒"]
        : locale === "ja"
          ? ["時間", "分", "秒"]
          : ["hr", "min", "sec"];
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  if (total < 60) return `${number.format(Math.round(total))} ${units[2]}`;
  if (total < 3600) return `${number.format(Math.round(total / 60))} ${units[1]}`;
  const hours = total / 3600;
  return `${number.format(hours < 10 && !Number.isInteger(hours) ? hours : Math.round(hours))} ${units[0]}`;
}

export function formatDurationAxis(totalSeconds: number) {
  return formatDurationAxisForLocale(totalSeconds);
}

export async function createSession(
  input: {
    subject: Subject;
    academicYear: AcademicYear;
    startTime: number;
    endTime: number;
    note?: string;
  },
  database: FocusDatabase = db,
) {
  if (!noteMetrics(input.note ?? "").valid) throw new Error("Note exceeds the allowed limits.");
  if (!Number.isFinite(input.startTime) || !Number.isFinite(input.endTime) || input.endTime <= input.startTime) {
    throw new Error("End time must be after start time.");
  }
  if (input.subject.academicYearId !== input.academicYear.id)
    throw new Error("Choose a Subject from the selected Academic Year.");
  const subject = await database.subjects.get(input.subject.id);
  const year = await database.academicYears.get(input.academicYear.id);
  if (!subject || subject.archived || !year || year.archived || subject.academicYearId !== year.id)
    throw new Error("Choose a Subject in an active Academic Year.");
  const session: FocusSession = {
    id: "",
    subjectId: input.subject.id,
    subjectName: input.subject.name,
    academicYearId: input.academicYear.id,
    academicYearName: input.academicYear.name,
    startTime: input.startTime,
    endTime: input.endTime,
    manual: true,
    focusedDurationSeconds: (input.endTime - input.startTime) / 1000,
    note: input.note?.trim() ? input.note : undefined,
    archived: false,
  };
  const id = await database.sessions.add(session);
  return (await database.sessions.get(id))!;
}
