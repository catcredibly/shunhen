import { normalizeTiming, focusIntervals } from "./storage/model";
import { validSessions } from "./sessionValidity";
import { noteMetrics } from "./notes";
import { db, type FocusDatabase } from "./db";
import { goalScopeSessions, goalProgress, localDayBounds, localWeekBounds } from "./goals";
import { loadSettings } from "./settings";
import type { FocusSession } from "./types";
import type { ToastMessage } from "./toasts";

/** Claim notifications in the save transaction so concurrent timer webviews cannot
 * celebrate the same session twice. Recovery/import/edit callers never opt in. */
export async function saveFocusSession(
  session: FocusSession,
  live = false,
  database: FocusDatabase = db,
  now = Date.now(),
) {
  if (!noteMetrics(session.note ?? "").valid) throw new Error("Note exceeds the allowed limits.");
  return database.transaction("rw", async (database) => {
    const messages: { message: ToastMessage; kind: "daily" | "weekly" }[] = [];
    if (
      session.sourceIdentity
        ? await database.sessions.getBySource(session.sourceIdentity)
        : await database.sessions.get(session.id)
    )
      return messages;
    const subject = await database.subjects.get(session.subjectId);
    const year = subject ? await database.academicYears.get(subject.academicYearId) : undefined;
    if (!subject || !year) throw new Error("Session relationship is missing.");
    const timing = normalizeTiming(session);
    session = {
      ...session,
      subjectName: subject.name,
      academicYearId: year.id,
      academicYearName: year.name,
      archived: subject.archived || year.archived,
      startTime: timing.startedAt * 1000,
      endTime: (timing.startedAt + timing.elapsedSeconds) * 1000,
      focusedDurationSeconds:
        timing.elapsedSeconds - timing.pauses.reduce((sum, pause) => sum + pause.durationSeconds, 0),
      focusIntervals: focusIntervals(timing.startedAt, timing.elapsedSeconds, timing.pauses),
    };
    if (live) {
      const settings = await loadSettings(database, false);
      const years = await database.academicYears.toArray();
      const sessions = validSessions(await database.sessions.toArray(), years);
      const subjects = await database.subjects.toArray();
      const scoped = (rows: FocusSession[]) => goalScopeSessions(rows, years, subjects, settings.goalScope);
      const before = goalProgress(scoped(sessions), now),
        after = goalProgress(scoped(validSessions([...sessions, session], years)), now);
      for (const kind of ["daily", "weekly"] as const) {
        const target = settings[`${kind}GoalSeconds`];
        const period = kind === "daily" ? localDayBounds(now) : localWeekBounds(now);
        const key = `goalCompletion.${kind}`;
        if (
          settings[`${kind}GoalEnabled`] &&
          target > 0 &&
          before[`${kind}Seconds`] < target &&
          after[`${kind}Seconds`] >= target &&
          (await database.settings.get(key))?.value !== String(period.start)
        ) {
          await database.settings.put({ key, value: String(period.start) });
          messages.push({ message: kind === "daily" ? "Daily goal completed" : "Weekly goal completed", kind });
        }
      }
    }
    await database.sessions.add(session);
    return messages;
  });
}
