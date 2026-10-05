import { createTestDatabase } from "./storage/testDatabase";
import { afterEach, expect, it, vi } from "vitest";
import { FocusDatabase } from "./db";
import {
  readTimerRecovery,
  persistTimerRecovery,
  checkpointTimerState,
  continueTimerRecovery,
  resumeTimerCheckpoint,
  scheduleRecoveryCheckpoints,
  registerCloseCheckpoint,
  closeAfterCheckpoint,
} from "./timerRecovery";
import {
  initialTimerState,
  startTimerState,
  focusedSecondsAt,
  extendTimerState,
  normalizeTimerState,
  startStopwatchState,
  toggleTimerPause,
  finishTimerState,
  completedSession,
  idleTimerState,
} from "./timerState";
import { saveFocusSession } from "./saveFocusSession";

it("persists transitions, survives failed saves and recovers a save-before-cleanup crash without duplication", async () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  const database = createTestDatabase(`timer-recovery-${crypto.randomUUID()}`).database;
  const start = new Date(2026, 8, 21, 23).getTime();
  const subject = { id: "1", name: "S", academicYearId: "1", color: "#fff", archived: false };
  const year = { id: "1", name: "Y", archived: false };
  await database.academicYears.add(year);
  await database.subjects.add({ ...subject, color: "#4da3ff" });
  try {
    let state = startStopwatchState(initialTimerState, subject, year, start);
    persistTimerRecovery(state, storage);
    expect(readTimerRecovery(storage)).toEqual(state);
    state = toggleTimerPause(readTimerRecovery(storage), start + 1800000);
    persistTimerRecovery(state, storage);
    expect(readTimerRecovery(storage).paused).toBe(true);
    expect(readTimerRecovery(storage).focusIntervals).toHaveLength(1);
    state = toggleTimerPause(readTimerRecovery(storage), start + 5400000);
    persistTimerRecovery(state, storage);
    state = finishTimerState(readTimerRecovery(storage), start + 7200000);
    persistTimerRecovery(state, storage);
    expect(readTimerRecovery(storage)).toMatchObject({ finished: true, focusIntervals: state.focusIntervals });
    const session = completedSession(readTimerRecovery(storage), state.finishedAt!)!;
    await expect(saveFocusSession({ ...session, note: "x".repeat(100000) }, false, database)).rejects.toThrow();
    expect(readTimerRecovery(storage).focusIntervals).toHaveLength(2);
    await saveFocusSession(session, false, database);
    // Simulate a crash after the DB write, before recovery cleanup.
    const recovered = readTimerRecovery(storage);
    await saveFocusSession(completedSession(recovered, recovered.finishedAt!)!, false, database);
    expect(await database.sessions.count()).toBe(1);
    expect((await database.sessions.get(session.id))?.focusIntervals).toEqual(state.focusIntervals);
    persistTimerRecovery(idleTimerState(recovered), storage);
    expect(values.size).toBe(0);
  } finally {
    await database.delete();
  }
});

const checkpointStart = new Date(2026, 8, 30, 12).getTime();
const checkpointSubject = { id: "1", name: "S", academicYearId: "1", color: "#fff", archived: false };
const checkpointYear = { id: "1", name: "Y", archived: false };
const runningState = (mode: "timer" | "stopwatch") =>
  mode === "timer"
    ? startTimerState(initialTimerState, 3600, checkpointSubject, checkpointYear, checkpointStart, "same-session")
    : startStopwatchState(initialTimerState, checkpointSubject, checkpointYear, checkpointStart, "same-session");
afterEach(() => vi.useRealTimers());

it.each(["timer", "stopwatch"] as const)(
  "anchors %s checkpoints to Start and Resume, independent of mount time",
  (mode) => {
    vi.useFakeTimers();
    vi.setSystemTime(checkpointStart + 37000);
    let state = runningState(mode);
    const write = vi.fn((next) => {
      state = next;
    });
    let stop = scheduleRecoveryCheckpoints(() => state, write);
    vi.advanceTimersByTime(22999);
    expect(write).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(state.checkpointFocusedSeconds).toBe(60);
    expect(state.checkpointAt).toBe(checkpointStart + 60000);
    expect(state.targetEnd).toBe(mode === "timer" ? checkpointStart + 3600000 : null);
    // An extension persists immediately without shifting the next scheduled minute.
    vi.advanceTimersByTime(20000);
    state = checkpointTimerState(extendTimerState(state, 60));
    vi.advanceTimersByTime(40000);
    expect(write).toHaveBeenCalledTimes(2);
    expect(state.checkpointFocusedSeconds).toBe(120);
    stop();
    state = checkpointTimerState(toggleTimerPause(state));
    vi.advanceTimersByTime(5000);
    state = checkpointTimerState(toggleTimerPause(state));
    expect(state.checkpointAt).toBe(Date.now());
    expect(state.checkpointFocusedSeconds).toBe(120);
    stop = scheduleRecoveryCheckpoints(() => state, write);
    vi.advanceTimersByTime(59999);
    expect(write).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);
    expect(write).toHaveBeenCalledTimes(3);
    expect(state.checkpointFocusedSeconds).toBe(180);
    expect(state.checkpointIntervals).toEqual([
      { startTime: checkpointStart, endTime: checkpointStart + 120000 },
      { startTime: checkpointStart + 125000, endTime: checkpointStart + 185000 },
    ]);
    stop();
  },
);

it("never schedules idle, paused, or finished checkpoint writes and cancels a pending loop", () => {
  vi.useFakeTimers();
  vi.setSystemTime(checkpointStart);
  const running = runningState("timer");
  const write = vi.fn();
  for (const state of [
    initialTimerState,
    toggleTimerPause(running, checkpointStart + 1000),
    finishTimerState(running, checkpointStart + 1000),
  ]) {
    const stop = scheduleRecoveryCheckpoints(() => state, write);
    vi.advanceTimersByTime(120000);
    stop();
  }
  const stop = scheduleRecoveryCheckpoints(() => running, write);
  stop(); // Main-window cleanup while waiting for a recovery decision.
  vi.advanceTimersByTime(120000);
  expect(write).not.toHaveBeenCalled();
});

it.each(["timer", "stopwatch"] as const)("preserves both %s recovery choices and exact intervals", (mode) => {
  const checkpoint = checkpointTimerState({ ...runningState(mode), note: "keep me" }, checkpointStart + 360000);
  const reopenedAt = checkpointStart + 1200000;
  const continued = continueTimerRecovery(checkpoint, reopenedAt);
  expect(focusedSecondsAt(continued, reopenedAt)).toBe(1200);
  expect(continued.targetEnd).toBe(mode === "timer" ? checkpointStart + 3600000 : null);
  const resumed = resumeTimerCheckpoint(checkpoint, reopenedAt);
  expect(resumed).toMatchObject({
    sessionId: "same-session",
    note: "keep me",
    runningSince: reopenedAt,
    accumulatedFocusedSeconds: 360,
  });
  expect(resumed.focusIntervals).toEqual([{ startTime: checkpointStart, endTime: checkpointStart + 360000 }]);
  expect(resumed.targetEnd).toBe(mode === "timer" ? reopenedAt + 3240000 : null);
  expect(focusedSecondsAt(resumed, reopenedAt + 2000)).toBe(362);
  expect(completedSession(resumed, reopenedAt + 2000)?.focusIntervals).toEqual([
    ...checkpoint.checkpointIntervals,
    { startTime: reopenedAt, endTime: reopenedAt + 2000 },
  ]);
});

it("Continue finishes at the original deadline while checkpoint recovery retains its remaining duration", () => {
  const checkpoint = checkpointTimerState(runningState("timer"), checkpointStart + 360000);
  const now = checkpointStart + 7200000;
  const continued = continueTimerRecovery(checkpoint, now);
  expect(continued).toMatchObject({
    finished: true,
    finishedAt: checkpointStart + 3600000,
    accumulatedFocusedSeconds: 3600,
  });
  expect(continued.focusIntervals).toEqual([{ startTime: checkpointStart, endTime: checkpointStart + 3600000 }]);
  expect(resumeTimerCheckpoint(checkpoint, now)).toMatchObject({
    finished: false,
    remainingSeconds: 3240,
    accumulatedFocusedSeconds: 360,
  });
});

it("writes a final exact checkpoint before confirmed exit without finalizing the Session", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(checkpointStart + 408000);
  let state = checkpointTimerState(runningState("timer"), checkpointStart + 367000);
  const write = vi.fn(() => {
    state = checkpointTimerState(state);
  });
  const unregister = registerCloseCheckpoint(write);
  const exit = vi.fn(async () => {
    expect(state.checkpointRemainingSeconds).toBe(3192);
    expect(state.finished).toBe(false);
    expect(state.targetEnd).toBe(checkpointStart + 3600000);
  });
  try {
    // Opening/dismissing the warning does not invoke the explicit close action.
    expect(write).not.toHaveBeenCalled();
    expect(state.checkpointAt).toBe(checkpointStart + 367000);
    await closeAfterCheckpoint(exit);
    expect(write).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(resumeTimerCheckpoint(state, checkpointStart + 7200000).remainingSeconds).toBe(3192);
  } finally {
    unregister();
  }
});

it("does not exit if the final recovery write fails", async () => {
  const unregister = registerCloseCheckpoint(() => {
    throw new Error("storage unavailable");
  });
  const exit = vi.fn();
  try {
    await expect(closeAfterCheckpoint(exit)).rejects.toThrow("storage unavailable");
    expect(exit).not.toHaveBeenCalled();
  } finally {
    unregister();
  }
});

it.each(["timer", "stopwatch"] as const)(
  "restores paused %s state exactly and accepts legacy checkpoint records",
  (mode) => {
    const paused = checkpointTimerState(
      toggleTimerPause(runningState(mode), checkpointStart + 100000),
      checkpointStart + 100000,
    );
    const legacy = {
      ...paused,
      checkpointRemainingSeconds: undefined,
      checkpointFocusedSeconds: undefined,
      checkpointIntervals: undefined,
      checkpointAt: undefined,
    };
    const restored = normalizeTimerState(legacy);
    expect(restored.paused).toBe(true);
    expect(restored.checkpointIntervals).toEqual(paused.focusIntervals);
    expect(restored.checkpointFocusedSeconds).toBe(100);
    expect(
      focusedSecondsAt(continueTimerRecovery(restored, checkpointStart + 9000000), checkpointStart + 9000000),
    ).toBe(100);
    expect(resumeTimerCheckpoint(restored)).toBe(restored);
  },
);
