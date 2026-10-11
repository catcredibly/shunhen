import { timerStateAt, type TimerState } from "./timerState";

/** Display projection only: never persist this snapshot or use it to record a Session. */
export function popoutStopwatchState(state: TimerState, now = Date.now()): TimerState {
  const current = timerStateAt(state, now);
  return current.mode === "stopwatch"
    ? { ...current, remainingSeconds: Math.floor(current.remainingSeconds) }
    : current;
}

/** Re-read authoritative timestamps at each visible second boundary, rather than counting ticks. */
export function scheduleStopwatchDisplay(read: () => TimerState, update: () => void) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    update();
    const state = read();
    if (state.mode !== "stopwatch" || !state.running || state.paused || state.finished) return;
    const elapsed = timerStateAt(state).remainingSeconds;
    const delay = Math.max(1, Math.round((Math.floor(elapsed) + 1 - elapsed) * 1000));
    timeout = setTimeout(tick, delay);
  };
  tick();
  return () => {
    stopped = true;
    clearTimeout(timeout);
  };
}
