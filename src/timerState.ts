import { dailyFocusAllocations, allocatedFocusInRange } from "./sessionAllocation";
import type { AcademicYear, FocusSession, Subject } from "./types";

export const ACTIVE_TIMER_STORAGE_KEY = "focus.activeTimer";
export const LAST_TIMER_DURATION_KEY = "lastTimerDurationSeconds";

export type TimerState = {
  mode?: "timer" | "stopwatch";
  expiredWhileClosed?: boolean;
  expiredNoticeDismissed?: boolean;
  running: boolean;
  paused: boolean;
  pauseResumeAcceptedAt?: number;
  subject: string;
  subjectColor: string;
  subjectId: string;
  academicYearId: string;
  academicYearName: string;
  sessionId: string | null;
  startedAt: number | null;
  targetEnd: number | null;
  remainingSeconds: number;
  plannedDurationSeconds: number;
  note: string;
  finished?: boolean;
  finishedAt?: number | null;
  accumulatedFocusedSeconds: number;
  runningSince: number | null;
  focusIntervals: { startTime: number; endTime: number }[];
  checkpointAt: number | null;
  checkpointRemainingSeconds: number;
  checkpointFocusedSeconds: number;
  checkpointIntervals: { startTime: number; endTime: number }[];
  saveFailed?: boolean;
};

export const initialTimerState: TimerState = {
  running: false,
  paused: false,
  subject: "",
  subjectColor: "#ff922b",
  subjectId: "",
  academicYearId: "",
  academicYearName: "",
  sessionId: null,
  startedAt: null,
  targetEnd: null,
  remainingSeconds: 75 * 60,
  plannedDurationSeconds: 75 * 60,
  note: "",
  finished: false,
  finishedAt: null,
  accumulatedFocusedSeconds: 0,
  runningSince: null,
  focusIntervals: [],
  checkpointAt: null,
  checkpointRemainingSeconds: 75 * 60,
  checkpointFocusedSeconds: 0,
  checkpointIntervals: [],
  saveFailed: false,
};

export function normalizeTimerState(value: Partial<TimerState> | null | undefined): TimerState {
  const state = { ...initialTimerState, ...value };
  state.focusIntervals = Array.isArray(value?.focusIntervals) ? value.focusIntervals : [];
  state.checkpointIntervals = Array.isArray(value?.checkpointIntervals)
    ? value.checkpointIntervals
    : state.focusIntervals;
  state.accumulatedFocusedSeconds = Number.isFinite(value?.accumulatedFocusedSeconds)
    ? Math.max(0, value!.accumulatedFocusedSeconds!)
    : Math.max(0, state.plannedDurationSeconds - state.remainingSeconds);
  state.runningSince =
    value?.runningSince ?? (state.running && !state.paused && !state.finished ? state.startedAt : null);
  state.checkpointRemainingSeconds = Number.isFinite(value?.checkpointRemainingSeconds)
    ? Math.max(0, value!.checkpointRemainingSeconds!)
    : state.remainingSeconds;
  state.checkpointFocusedSeconds = Number.isFinite(value?.checkpointFocusedSeconds)
    ? Math.max(0, value!.checkpointFocusedSeconds!)
    : state.accumulatedFocusedSeconds;
  return state;
}

export function startTimerState(
  state: TimerState,
  seconds: number,
  subject: Subject,
  year: AcademicYear,
  now = Date.now(),
  sessionId: string = crypto.randomUUID(),
): TimerState {
  if (
    !Number.isFinite(seconds) ||
    seconds <= 0 ||
    subject.archived ||
    year.archived ||
    subject.academicYearId !== year.id
  )
    return state;
  return {
    ...state,
    mode: "timer",
    expiredWhileClosed: false,
    expiredNoticeDismissed: false,
    subject: subject.name,
    subjectId: subject.id,
    subjectColor: subject.color,
    academicYearId: year.id,
    academicYearName: year.name,
    sessionId,
    pauseResumeAcceptedAt: undefined,
    running: true,
    paused: false,
    finished: false,
    finishedAt: null,
    startedAt: now,
    targetEnd: now + seconds * 1000,
    remainingSeconds: seconds,
    plannedDurationSeconds: seconds,
    accumulatedFocusedSeconds: 0,
    runningSince: now,
    focusIntervals: [],
    checkpointAt: now,
    checkpointRemainingSeconds: seconds,
    checkpointFocusedSeconds: 0,
    checkpointIntervals: [],
    saveFailed: false,
  };
}

export function startStopwatchState(
  state: TimerState,
  subject: Subject,
  year: AcademicYear,
  now = Date.now(),
  sessionId: string = crypto.randomUUID(),
): TimerState {
  if (subject.archived || year.archived || subject.academicYearId !== year.id) return state;
  return {
    ...startTimerState(state, state.plannedDurationSeconds, subject, year, now, sessionId),
    mode: "stopwatch",
    remainingSeconds: 0,
    targetEnd: null,
    checkpointRemainingSeconds: 0,
  };
}

/** Restore expiry without replaying completion effects or finalizing the Session. */
export function restoreExpiredTimer(state: TimerState, now = Date.now()): TimerState {
  if (
    !state.running ||
    state.paused ||
    state.finished ||
    state.mode === "stopwatch" ||
    state.targetEnd === null ||
    state.targetEnd > now
  )
    return state;
  return { ...finishTimerState(state, state.targetEnd), expiredWhileClosed: true, expiredNoticeDismissed: false };
}

export function focusedSecondsAt(state: TimerState, now: number) {
  if (state.runningSince === null || state.paused || state.finished) return state.accumulatedFocusedSeconds;
  const end = Math.min(now, state.targetEnd ?? Infinity);
  return state.accumulatedFocusedSeconds + Math.max(0, (end - state.runningSince) / 1000);
}

/** Ignore rapid inputs without changing the timestamps of accepted transitions. */
export function toggleTimerPause(state: TimerState, now = Date.now()): TimerState {
  if (
    !state.running ||
    state.finished ||
    (state.pauseResumeAcceptedAt !== undefined &&
      now >= state.pauseResumeAcceptedAt &&
      now - state.pauseResumeAcceptedAt < 1000)
  )
    return state;
  const current = timerStateAt(state, now);
  if (current.finished) return state;
  if (!current.paused)
    return {
      ...closeRunningInterval(current, now),
      paused: true,
      targetEnd: null,
      pauseResumeAcceptedAt: now,
    };
  return {
    ...current,
    paused: false,
    pauseResumeAcceptedAt: now,
    runningSince: now,
    targetEnd: current.mode === "stopwatch" ? null : now + current.remainingSeconds * 1000,
    checkpointAt: now,
    checkpointRemainingSeconds: current.remainingSeconds,
    checkpointFocusedSeconds: current.accumulatedFocusedSeconds,
    checkpointIntervals: current.focusIntervals,
  };
}

export function closeRunningInterval(state: TimerState, endTime: number): TimerState {
  if (state.runningSince === null) return state;
  const end = Math.min(endTime, state.targetEnd ?? Infinity);
  if (end <= state.runningSince) return { ...state, runningSince: null };
  return {
    ...state,
    accumulatedFocusedSeconds: focusedSecondsAt(state, end),
    runningSince: null,
    focusIntervals: [...state.focusIntervals, { startTime: state.runningSince, endTime: end }],
  };
}

export function finishTimerState(state: TimerState, endTime: number): TimerState {
  endTime = Math.min(endTime);
  const closed = closeRunningInterval(state, endTime);
  return { ...closed, remainingSeconds: 0, targetEnd: null, finished: true, finishedAt: endTime, paused: false };
}

export function extendTimerState(state: TimerState, seconds: number, now = Date.now()): TimerState {
  if (!state.running || state.mode === "stopwatch") return state;
  if (seconds <= 0 || !Number.isFinite(seconds)) return state;
  const fromFinished = Boolean(state.finished);
  return {
    ...state,
    expiredNoticeDismissed: true,
    paused: fromFinished ? false : state.paused,
    finished: false,
    finishedAt: null,
    remainingSeconds: state.remainingSeconds + seconds,
    plannedDurationSeconds: state.plannedDurationSeconds + seconds,
    targetEnd: state.paused && !fromFinished ? null : (state.targetEnd ?? now) + seconds * 1000,
    runningSince: fromFinished ? now : state.runningSince,
    saveFailed: false,
  };
}

export function completedSession(state: TimerState, endTime: number): FocusSession | undefined {
  endTime = Math.min(endTime);
  if (!state.sessionId || !state.subjectId || !state.startedAt || endTime <= state.startedAt) return;
  const closed = closeRunningInterval(state, endTime);
  const focusedDurationSeconds = Math.max(0, closed.accumulatedFocusedSeconds);
  if (!focusedDurationSeconds) return;
  return {
    id: state.sessionId,
    subjectId: state.subjectId,
    subjectName: state.subject,
    academicYearId: state.academicYearId,
    academicYearName: state.academicYearName,
    startTime: state.startedAt,
    endTime,
    focusedDurationSeconds,
    note: state.note.trim() ? state.note : undefined,
    archived: false,
    focusIntervals: closed.focusIntervals,
  };
}

export function idleTimerState(state: TimerState): TimerState {
  return {
    ...state,
    mode: "timer",
    expiredWhileClosed: false,
    expiredNoticeDismissed: false,
    running: false,
    paused: false,
    finished: false,
    finishedAt: null,
    startedAt: null,
    targetEnd: null,
    sessionId: null,
    remainingSeconds: state.plannedDurationSeconds,
    note: "",
    accumulatedFocusedSeconds: 0,
    runningSince: null,
    focusIntervals: [],
    checkpointAt: null,
    checkpointRemainingSeconds: state.plannedDurationSeconds,
    checkpointFocusedSeconds: 0,
    checkpointIntervals: [],
    saveFailed: false,
  };
}

export function localDateInputValue(stamp: number) {
  const date = new Date(stamp);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function todaySummary(sessions: FocusSession[], now = Date.now()) {
  const date = new Date(now);
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const end = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
  const today = sessions.filter(
    (session) => !session.archived && session.startTime >= start && session.startTime < end,
  );
  return {
    sessions: today,
    focusedDurationSeconds: sessions
      .filter((session) => !session.archived)
      .reduce((sum, session) => sum + allocatedFocusInRange(session, start, end), 0),
  };
}

export function currentStreak(sessions: FocusSession[], now = Date.now()) {
  const activeDays = new Set(
    sessions
      .filter((session) => !session.archived)
      .flatMap((session) => dailyFocusAllocations(session).map((day) => localDateInputValue(day.start))),
  );
  const cursor = new Date(now);
  cursor.setHours(0, 0, 0, 0);
  if (!activeDays.has(localDateInputValue(cursor.getTime()))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (activeDays.has(localDateInputValue(cursor.getTime()))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function timerStateAt(state: TimerState, now = Date.now()) {
  if (state.mode === "stopwatch") return { ...state, remainingSeconds: focusedSecondsAt(state, now) };
  if (!state.running || state.paused || state.finished || !state.targetEnd) return state;
  return { ...state, remainingSeconds: Math.max(0, Math.ceil((state.targetEnd - now) / 1000)) };
}
