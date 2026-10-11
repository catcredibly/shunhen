import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { popoutStopwatchState, scheduleStopwatchDisplay } from "./stopwatchPopout";
import { completedSession, initialTimerState, timerStateAt, toggleTimerPause } from "./timerState";

const start = 1_800_000_000_000;
const stopwatch = () => ({
  ...initialTimerState,
  mode: "stopwatch" as const,
  running: true,
  sessionId: "stopwatch",
  subjectId: "1",
  startedAt: start,
  runningSince: start,
  targetEnd: null,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(start);
});
afterEach(() => vi.useRealTimers());

describe("Stopwatch popout display", () => {
  it("projects seconds without mutating precise timing or Session recording", () => {
    const state = stopwatch();
    const now = start + 26_437;
    expect(popoutStopwatchState(state, now).remainingSeconds).toBe(26);
    expect(timerStateAt(state, now).remainingSeconds).toBe(26.437);
    expect(completedSession(state, now)?.focusedDurationSeconds).toBe(26.437);
    expect(state.accumulatedFocusedSeconds).toBe(0);
  });

  it("updates at the next visible second boundary, with no sub-second polling", () => {
    const state = stopwatch();
    vi.setSystemTime(start + 26_001);
    const update = vi.fn(() => popoutStopwatchState(state).remainingSeconds);
    const stop = scheduleStopwatchDisplay(() => state, update);
    expect(update).toHaveReturnedWith(26);
    vi.advanceTimersByTime(998);
    expect(update).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveLastReturnedWith(27);
    vi.advanceTimersByTime(1000);
    expect(update).toHaveLastReturnedWith(28);
    stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("catches up from authoritative timestamps after a delayed callback", () => {
    const state = stopwatch();
    const update = vi.fn(() => popoutStopwatchState(state).remainingSeconds);
    const stop = scheduleStopwatchDisplay(() => state, update);
    vi.setSystemTime(start + 15_250);
    vi.advanceTimersToNextTimer();
    expect(update).toHaveLastReturnedWith(16);
    stop();
  });

  it("pauses precisely, schedules no paused updates, and resumes from the fractional remainder", () => {
    const paused = toggleTimerPause(stopwatch(), start + 26_437);
    vi.setSystemTime(start + 30_000);
    const update = vi.fn();
    const stopPaused = scheduleStopwatchDisplay(() => paused, update);
    expect(popoutStopwatchState(paused).remainingSeconds).toBe(26);
    expect(paused.accumulatedFocusedSeconds).toBe(26.437);
    expect(vi.getTimerCount()).toBe(0);
    stopPaused();
    const resumed = toggleTimerPause(paused, Date.now());
    const resumedUpdate = vi.fn(() => popoutStopwatchState(resumed).remainingSeconds);
    const stop = scheduleStopwatchDisplay(() => resumed, resumedUpdate);
    vi.advanceTimersByTime(562);
    expect(resumedUpdate).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(resumedUpdate).toHaveLastReturnedWith(27);
    stop();
  });

  it("does not schedule inactive or finished Stopwatches", () => {
    for (const state of [
      { ...stopwatch(), running: false },
      { ...stopwatch(), finished: true },
    ]) {
      const stop = scheduleStopwatchDisplay(() => state, vi.fn());
      expect(vi.getTimerCount()).toBe(0);
      stop();
    }
  });

  it("leaves Timer countdown projection unchanged", () => {
    const timer = { ...stopwatch(), mode: "timer" as const, targetEnd: start + 60_437 };
    expect(popoutStopwatchState(timer, start + 26_001)).toEqual(timerStateAt(timer, start + 26_001));
  });
});
