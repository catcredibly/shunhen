import { createTestDatabase } from "./storage/testDatabase";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FocusDatabase } from "./db";
import { filterSessions } from "./analytics/analytics";
import { createDevelopmentAnalyticsDataset } from "./analytics/developmentDataset";
import {
  closeRunningInterval,
  toggleTimerPause,
  timerStateAt,
  finishTimerState,
  focusedSecondsAt,
  idleTimerState,
  normalizeTimerState,
  restoreExpiredTimer,
  startStopwatchState,
  completedSession,
  currentStreak,
  extendTimerState,
  initialTimerState,
  LAST_TIMER_DURATION_KEY,
  localDateInputValue,
  startTimerState,
  todaySummary,
} from "./timerState";
import { EXTEND_PRESETS_MINUTES } from "./components/TimerExtendMenu";
import { normaliseDuration } from "./settings";

const opened: { delete(): Promise<void> }[] = [];
const database = () => {
  const value = createTestDatabase(`focus-timer-test-${crypto.randomUUID()}`).database;
  opened.push(value);
  return value;
};
const year = { id: "1", name: "University Year 1", archived: false };
const subject = { id: "1", academicYearId: year.id, name: "Mathematics", color: "#4da3ff", archived: false };

afterEach(async () => {
  await Promise.all(opened.splice(0).map((value) => value.delete()));
});

describe("timer persistence and summaries", () => {
  it("uses persisted non-archived Sessions only for Today", () => {
    const now = new Date(2026, 8, 22, 12).getTime();
    const rows = [21, 2, 1, 2].map((seconds, index) => ({
      id: String(index),
      subjectId: subject.id,
      subjectName: subject.name,
      academicYearId: year.id,
      academicYearName: year.name,
      startTime: now + index * 1000,
      endTime: now + (index + seconds) * 1000,
      focusedDurationSeconds: seconds,
      archived: false,
    }));
    rows.push({ ...rows[0], id: "archived", focusedDurationSeconds: 999, archived: true });
    expect(todaySummary(rows, now).focusedDurationSeconds).toBe(26);
    expect(todaySummary(rows, now).sessions).toHaveLength(4);
    expect(currentStreak(rows, now)).toBe(1);
  });

  it("retains a note through extension and writes it to the completed Session", () => {
    const started = startTimerState(
      { ...initialTimerState, note: "Chapter 3 questions" },
      1500,
      subject,
      year,
      1_000,
      "session",
    );
    const extended = extendTimerState({ ...started, remainingSeconds: 1400 }, 900, 101_000);
    expect(extended.note).toBe("Chapter 3 questions");
    expect(JSON.parse(JSON.stringify(extended)).note).toBe("Chapter 3 questions");
    expect(completedSession({ ...extended, remainingSeconds: 0 }, 2_401_000)?.note).toBe("Chapter 3 questions");
  });

  it("uses the approved presets and normalizes custom extension overflow", () => {
    expect(EXTEND_PRESETS_MINUTES).toEqual([5, 15, 30, 60]);
    expect(normaliseDuration(2, 75, 90)).toEqual({ total: 11790, hours: 3, minutes: 16, seconds: 30 });
    const started = startTimerState(initialTimerState, 3000, subject, year, 1_000, "same-session");
    const paused = { ...started, paused: true, targetEnd: null, note: "Keep this" };
    const extended = extendTimerState(paused, 1200, 2_000);
    expect(extended).toMatchObject({
      sessionId: "same-session",
      subjectId: "1",
      note: "Keep this",
      paused: true,
      remainingSeconds: 4200,
    });
    expect(extendTimerState(started, 0)).toBe(started);
  });

  it("resumes the same expired Session when it is extended", () => {
    const finished = {
      ...startTimerState(initialTimerState, 300, subject, year, 1_000, "session"),
      remainingSeconds: 0,
      targetEnd: null,
      finished: true,
      finishedAt: 301_000,
    };
    expect(extendTimerState(finished, 300, 400_000)).toMatchObject({
      sessionId: "session",
      running: true,
      paused: false,
      finished: false,
      remainingSeconds: 300,
      targetEnd: 700_000,
    });
  });

  it("persists the last started duration without replacing it on extension", async () => {
    const testDb = database();
    await testDb.settings.put({ key: LAST_TIMER_DURATION_KEY, value: "1500" });
    extendTimerState(startTimerState(initialTimerState, 1500, subject, year, 1_000, "session"), 900);
    expect((await testDb.settings.get(LAST_TIMER_DURATION_KEY))?.value).toBe("1500");
  });

  it("clearing Sessions preserves all other tables", async () => {
    const testDb = database();
    await testDb.academicYears.add(year);
    await testDb.subjects.add(subject);
    await testDb.settings.put({ key: "preference", value: "kept" });
    await testDb.sessions.add({
      id: "session",
      subjectId: subject.id,
      subjectName: subject.name,
      academicYearId: year.id,
      academicYearName: year.name,
      startTime: 1_000,
      endTime: 2_000,
      focusedDurationSeconds: 1,
      archived: false,
    });
    await testDb.sessions.clear();
    expect(filterSessions(await testDb.sessions.toArray())).toHaveLength(0);
    expect(await testDb.academicYears.count()).toBe(1);
    expect(await testDb.subjects.count()).toBe(1);
    expect(await testDb.settings.get("preference")).toBeTruthy();
  });

  it("permanently deletes exactly one Session", async () => {
    const testDb = database();
    await testDb.academicYears.add(year);
    await testDb.subjects.add(subject);
    const session = (id: string) => ({
      id,
      subjectId: subject.id,
      subjectName: subject.name,
      academicYearId: year.id,
      academicYearName: year.name,
      startTime: 1_000,
      endTime: 2_000,
      focusedDurationSeconds: 1,
      archived: false,
    });
    const first = await testDb.sessions.add(session("one"));
    const second = await testDb.sessions.add(session("two"));
    await testDb.sessions.delete(first);
    expect((await testDb.sessions.toArray()).map((row) => row.id)).toEqual([second]);
  });

  it("round-trips the local edit date without UTC conversion", () => {
    const stamp = new Date(2026, 8, 22, 0, 30).getTime();
    expect(localDateInputValue(stamp)).toBe("2026-09-22");
    expect(localDateInputValue(new Date(`${localDateInputValue(stamp)}T00:30`).getTime())).toBe("2026-09-22");
  });

  it("keeps the analytics demo entirely outside storage", async () => {
    const testDb = database();
    createDevelopmentAnalyticsDataset(100);
    expect(await testDb.sessions.count()).toBe(0);
  });
});

it("restores expiry at the deadline and excludes the closed-app gap on extension", () => {
  const started = startTimerState(initialTimerState, 300, subject, year, 1000, "expired");
  const restored = restoreExpiredTimer(started, 900000);
  expect(restored).toMatchObject({
    running: true,
    finished: true,
    finishedAt: 301000,
    remainingSeconds: 0,
    accumulatedFocusedSeconds: 300,
    expiredWhileClosed: true,
  });
  const acknowledged = { ...restored, expiredNoticeDismissed: true };
  expect(restoreExpiredTimer(normalizeTimerState(JSON.parse(JSON.stringify(acknowledged))), 1000000)).toEqual(
    acknowledged,
  );
  const extended = extendTimerState(restored, 60, 900000);
  expect(completedSession(extended, 960000)).toMatchObject({
    id: "expired",
    focusedDurationSeconds: 360,
  });
});

it("shares Stopwatch persistence and completion while excluding paused time", () => {
  const started = startStopwatchState(initialTimerState, subject, year, 1000, "stopwatch");
  expect(started).toMatchObject({ mode: "stopwatch", targetEnd: null, remainingSeconds: 0 });
  expect(focusedSecondsAt(started, 91000)).toBe(90);
  const paused = { ...closeRunningInterval(started, 91000), paused: true };
  expect(focusedSecondsAt(paused, 301000)).toBe(90);
  expect(restoreExpiredTimer(paused, 301000)).toBe(paused);
  const resumed = normalizeTimerState(JSON.parse(JSON.stringify({ ...paused, paused: false, runningSince: 301000 })));
  expect(extendTimerState(resumed, 300, 310000)).toBe(resumed);
  expect(completedSession(resumed, 361000)).toMatchObject({
    focusedDurationSeconds: 150,
  });
  expect(idleTimerState(resumed)).toMatchObject({
    mode: "timer",
    running: false,
    sessionId: null,
    remainingSeconds: initialTimerState.plannedDurationSeconds,
  });
});

it("note updates derive current running, paused, extended and Stopwatch display values", () => {
  const started = startTimerState(initialTimerState, 100, subject, year, 1000);
  expect(timerStateAt({ ...started, note: "typing" }, 11000).remainingSeconds).toBe(90);
  const paused = { ...timerStateAt(started, 11000), paused: true, targetEnd: null };
  expect(timerStateAt({ ...paused, note: "more" }, 21000).remainingSeconds).toBe(90);
  const extended = extendTimerState(started, 50, 11000);
  expect(timerStateAt({ ...extended, note: "extended" }, 21000).remainingSeconds).toBe(130);
  const stopwatch = startStopwatchState(initialTimerState, subject, year, 1000);
  expect(timerStateAt({ ...stopwatch, note: "count up" }, 11000).remainingSeconds).toBe(10);
});
it("preserves an invalid completed draft and original timing across recovery", () => {
  const started = startTimerState(initialTimerState, 60, subject, year, 1000);
  const finished = finishTimerState({ ...started, note: "a".repeat(1300) }, 61000);
  const restored = normalizeTimerState(JSON.parse(JSON.stringify(finished)));
  expect(restored.note).toHaveLength(1300);
  expect(restored.finishedAt).toBe(61000);
  const session = completedSession({ ...restored, note: "repaired" }, restored.finishedAt!);
  expect(session).toMatchObject({ endTime: 61000, focusedDurationSeconds: 60, note: "repaired" });
});

describe("Pause/Resume interaction guard", () => {
  it.each(["timer", "stopwatch"] as const)("drops rapid %s inputs and preserves a genuine short pause", (mode) => {
    const started =
      mode === "timer"
        ? startTimerState(initialTimerState, 100, subject, year, 1000)
        : startStopwatchState(initialTimerState, subject, year, 1000);
    const paused = toggleTimerPause(started, 6000);
    expect(paused.paused).toBe(true);
    expect(toggleTimerPause(paused, 6001)).toBe(paused);
    expect(toggleTimerPause(paused, 6999)).toBe(paused);
    const resumed = toggleTimerPause(paused, 8000);
    expect(resumed.paused).toBe(false);
    expect(toggleTimerPause(resumed, 8999)).toBe(resumed);
    const pausedAgain = toggleTimerPause(resumed, 9000);
    expect(pausedAgain.focusIntervals).toEqual([
      { startTime: 1000, endTime: 6000 },
      { startTime: 8000, endTime: 9000 },
    ]);
    expect(pausedAgain.accumulatedFocusedSeconds).toBe(6);
    expect(toggleTimerPause(pausedAgain, 10000).paused).toBe(false);
  });

  it("does not guard inactive inputs or carry a guard into a new session", () => {
    expect(toggleTimerPause(initialTimerState, 1000)).toBe(initialTimerState);
    const started = startTimerState({ ...initialTimerState, pauseResumeAcceptedAt: 1000 }, 100, subject, year, 1100);
    expect(toggleTimerPause(started, 1200).paused).toBe(true);
    const finished = finishTimerState(started, 1300);
    expect(toggleTimerPause(finished, 1400)).toBe(finished);
  });
});

it("uses a one-second guard without queuing inputs, measured with a fake clock", () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(100000);
    let state = startStopwatchState(initialTimerState, subject, year);
    vi.advanceTimersByTime(2000);
    state = toggleTimerPause(state);
    const paused = state;
    for (let n = 0; n < 10; n++) state = toggleTimerPause(state);
    expect(state).toBe(paused);
    vi.advanceTimersByTime(999);
    expect(toggleTimerPause(state)).toBe(paused);
    vi.advanceTimersByTime(1);
    expect(state.paused).toBe(true);
    state = toggleTimerPause(state);
    expect(state.paused).toBe(false);
    vi.advanceTimersByTime(2000);
    state = toggleTimerPause(state);
    expect(state.focusIntervals).toEqual([
      { startTime: 100000, endTime: 102000 },
      { startTime: 103000, endTime: 105000 },
    ]);
    expect(state.accumulatedFocusedSeconds).toBe(4);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it("preserves paused and running intervals through reload and completion retry", () => {
  const started = startStopwatchState(initialTimerState, subject, year, 1000);
  const paused = toggleTimerPause(started, 6000);
  const restored = normalizeTimerState(JSON.parse(JSON.stringify(paused)));
  expect(restored.runningSince).toBeNull();
  expect(restored.focusIntervals).toEqual(paused.focusIntervals);
  const running = toggleTimerPause(restored, 9000);
  const reloaded = normalizeTimerState(JSON.parse(JSON.stringify(running)));
  const closed = finishTimerState(reloaded, 12000);
  expect(closed.focusIntervals).toEqual([
    { startTime: 1000, endTime: 6000 },
    { startTime: 9000, endTime: 12000 },
  ]);
  expect(completedSession(normalizeTimerState({ ...closed, saveFailed: true }), 12000)).toEqual(
    completedSession(closed, 12000),
  );
});

it("allows countdowns and stopwatches across arbitrary calendar dates, retaining permanent intervals", () => {
  const start = new Date(2026, 8, 20, 23).getTime();
  const countdown = startTimerState(initialTimerState, 7 * 86400, subject, year, start);
  expect(countdown.running).toBe(true);
  expect(extendTimerState(countdown, 7 * 86400, start).targetEnd).toBe(start + 14 * 86400000);
  const stopwatch = startStopwatchState(initialTimerState, subject, year, start);
  const finished = finishTimerState(stopwatch, start + 5 * 86400000);
  expect(completedSession(finished, finished.finishedAt!)?.focusIntervals).toEqual([
    { startTime: start, endTime: start + 5 * 86400000 },
  ]);
});
