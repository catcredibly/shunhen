import { COLOR_PALETTE } from "./storage/model";
import { db, type FocusDatabase } from "./db";
import type { Subject } from "./types";

export const SUBJECT_COLORS: readonly string[] = COLOR_PALETTE;

export function nextSubjectColor(subjects: Subject[], academicYearId: string): string {
  const counts = SUBJECT_COLORS.map(
    (color) =>
      subjects.filter(
        (subject) =>
          !subject.archived && subject.academicYearId === academicYearId && subject.color.toLowerCase() === color,
      ).length,
  );
  return SUBJECT_COLORS[counts.indexOf(Math.min(...counts))];
}

/** Cycle only on explicit clicks; read within the transaction to preserve rapid clicks. */
export async function cycleSubjectColor(id: string, database: FocusDatabase = db) {
  await database.transaction("rw", async (database) => {
    const subject = await database.subjects.get(id);
    if (!subject) return;
    const index = SUBJECT_COLORS.indexOf(subject.color.toLowerCase());
    await database.subjects.update(id, { color: SUBJECT_COLORS[(index + 1) % SUBJECT_COLORS.length] });
  });
}
