import type { FocusDatabase } from "../db";
import type { NormalizedData, StoredYear, StoredSubject } from "./model";
import { readStoredSessions } from "./queries";

export async function readNormalized(database: FocusDatabase): Promise<NormalizedData> {
  return database.access(async (connection) => {
    const [years, subjects, sessions, settings] = await Promise.all([
      connection.select("SELECT * FROM academic_years ORDER BY id"),
      connection.select("SELECT * FROM subjects ORDER BY id"),
      readStoredSessions(connection),
      connection.select<{ key: string; value: string }>("SELECT key,value FROM settings ORDER BY key"),
    ]);
    const academicYears: StoredYear[] = years.map((row) => ({
      id: Number(row.id),
      name: String(row.name),
      startDate: row.start_date === null ? undefined : String(row.start_date),
      endDate: row.end_date === null ? undefined : String(row.end_date),
      archived: Boolean(row.archived),
    }));
    const subjectRows: StoredSubject[] = subjects.map((row) => ({
      id: Number(row.id),
      academicYearId: Number(row.academic_year_id),
      name: String(row.name),
      colorId: Number(row.color_id),
      archived: Boolean(row.archived),
    }));
    return { academicYears, subjects: subjectRows, sessions, settings };
  });
}
