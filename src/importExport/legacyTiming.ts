import type { FocusSession } from "../types";
import { normalizeTiming } from "../storage/model";

export type LegacyFileTiming = Pick<
  FocusSession,
  "startTime" | "endTime" | "focusedDurationSeconds" | "focusIntervals"
> & {
  manual?: boolean;
  legacyContinuous?: true;
};

/** Older exports without interval information recorded only a continuous focus span. */
export function convertLegacyFileTiming(session: LegacyFileTiming) {
  const endTime =
    session.focusIntervals === undefined && !session.manual && !session.legacyContinuous
      ? session.startTime + session.focusedDurationSeconds * 1000
      : session.endTime;
  return normalizeTiming({
    ...session,
    endTime,
    focusedDurationSeconds:
      session.focusIntervals === undefined ? (endTime - session.startTime) / 1000 : session.focusedDurationSeconds,
  });
}
