// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useTimer } from "./useTimer";
import { ACTIVE_TIMER_STORAGE_KEY, initialTimerState, type TimerState } from "../timerState";

const save = vi.hoisted(() => vi.fn());
vi.mock("../saveFocusSession", () => ({ saveFocusSession: save }));
vi.mock("./useLiveQuery", () => ({ useLiveQuery: () => undefined }));
vi.mock("../db", () => ({ db: {} }));
vi.mock("../timerCompletion", () => ({ handleTimerCompletion: vi.fn() }));
vi.mock("../toasts", () => ({ showToast: vi.fn() }));

const start = 1_800_000_000_000;
let channel: { onmessage: ((event: { data: TimerState }) => void) | null };
let root: Root, host: HTMLDivElement;
let timer: ReturnType<typeof useTimer>;
let renders: number;
function Display({ seconds = true }: { seconds?: boolean }) {
  timer = useTimer({ wholeSecondStopwatch: seconds });
  renders++;
  return <span>{timer.state.remainingSeconds}</span>;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(start + 26_001);
  vi.clearAllMocks();
  save.mockResolvedValue([]);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      onmessage: ((event: { data: TimerState }) => void) | null = null;
      constructor() {
        channel = this;
      }
      postMessage() {}
      close() {}
    },
  );
  window.location.hash = "#/popout";
  localStorage.setItem(
    ACTIVE_TIMER_STORAGE_KEY,
    JSON.stringify({
      ...initialTimerState,
      mode: "stopwatch",
      running: true,
      sessionId: "stopwatch",
      subjectId: "1",
      startedAt: start,
      runningSince: start,
      targetEnd: null,
    }),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  renders = 0;
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear();
  window.location.hash = "";
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("does not rerender Stopwatch digits within a second and resynchronizes on focus", async () => {
  await act(async () => root.render(<Display />));
  expect(host.textContent).toBe("26");
  const initialRenders = renders;
  await act(async () => vi.advanceTimersByTime(998));
  expect(renders).toBe(initialRenders);
  await act(async () => vi.advanceTimersByTime(1));
  expect(host.textContent).toBe("27");
  expect(renders).toBe(initialRenders + 1);
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(host.textContent).toBe("27");
  vi.setSystemTime(start + 40_321);
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(host.textContent).toBe("40");
});

it("applies pause/resume broadcasts immediately without losing fractional elapsed time", async () => {
  await act(async () => root.render(<Display />));
  const stored = JSON.parse(localStorage.getItem(ACTIVE_TIMER_STORAGE_KEY)!) as TimerState;
  const paused = { ...stored, paused: true, runningSince: null, accumulatedFocusedSeconds: 26.437 };
  await act(async () => channel.onmessage?.({ data: paused }));
  expect(host.textContent).toBe("26");
  expect(vi.getTimerCount()).toBe(0);
  const pausedRenders = renders;
  await act(async () => vi.advanceTimersByTime(5000));
  expect(renders).toBe(pausedRenders);
  await act(async () => channel.onmessage?.({ data: { ...paused, paused: false, runningSince: Date.now() } }));
  await act(async () => vi.advanceTimersByTime(563));
  expect(host.textContent).toBe("27");
});

it("records precise elapsed time instead of the displayed seconds", async () => {
  await act(async () => root.render(<Display />));
  vi.setSystemTime(start + 27_437);
  await act(async () => {
    await timer.stop();
  });
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ focusedDurationSeconds: 27.437 }), true);
});

it("retains fractional Stopwatch updates when the popout display option is disabled", async () => {
  await act(async () => root.render(<Display seconds={false} />));
  expect(timer.state.remainingSeconds).toBe(26.001);
  await act(async () => vi.advanceTimersByTime(250));
  expect(timer.state.remainingSeconds).toBe(26.251);
});

it("retains the Timer countdown update cadence", async () => {
  const stored = JSON.parse(localStorage.getItem(ACTIVE_TIMER_STORAGE_KEY)!) as TimerState;
  localStorage.setItem(ACTIVE_TIMER_STORAGE_KEY, JSON.stringify({
    ...stored, mode: "timer", targetEnd: Date.now() + 1250,
  }));
  await act(async () => root.render(<Display />));
  expect(host.textContent).toBe("2");
  await act(async () => vi.advanceTimersByTime(250));
  expect(host.textContent).toBe("1");
});
