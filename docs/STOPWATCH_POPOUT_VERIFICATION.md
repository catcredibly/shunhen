# Stopwatch popout verification

The popout displays whole seconds and schedules its Stopwatch display at the next elapsed-second boundary. Timing actions and recording retain the precise authoritative state.

Node.js is unavailable for this implementation. Tests, TypeScript checking, and builds have **not been run**; no Node installation or configuration was attempted.

When Node.js is available, run:

- `npm run test -- src/stopwatchPopout.test.ts src/hooks/useTimer.test.tsx src/timerState.test.ts src/timerRecovery.test.ts`
- `npm run typecheck`
- The usual frontend build/check, performed by the maintainer.

Manual verification:

- Stopwatch popout shows `HH:MM:SS`, with no fractional digits, and advances correctly each second.
- Check render activity/CPU against the previous version: elapsed-time updates should occur once per visible second rather than every 250 ms.
- Pause freezes the correct whole-second display immediately; resume preserves the fractional elapsed remainder.
- Ending a Session uses precise elapsed time through the existing recording path, including partial seconds before permanent normalization.
- Closing/reopening the popout and recovering the active Stopwatch remain accurate; focus/visibility changes catch up from authoritative timestamps.
- Main Stopwatch display and Timer popout behavior remain unchanged.
