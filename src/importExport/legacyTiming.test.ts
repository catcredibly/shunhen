import { expect, it } from "vitest";
import { nearestSecond, normalizeTiming } from "../storage/model";
import { convertLegacyFileTiming } from "./legacyTiming";

it("rounds absolute boundaries with deterministic ties and converts Focus gaps", () => {
  expect([nearestSecond(500), nearestSecond(-500), nearestSecond(1499), nearestSecond(-501)]).toEqual([1, 0, 1, -1]);
  expect(
    normalizeTiming({
      startTime: 0,
      endTime: 3000,
      focusedDurationSeconds: 2.8,
      focusIntervals: [
        { startTime: 0, endTime: 1400 },
        { startTime: 1600, endTime: 3000 },
      ],
    }).pauses,
  ).toEqual([{ offsetSeconds: 1, durationSeconds: 1 }]);
  expect(
    normalizeTiming({
      startTime: 0,
      endTime: 3000,
      focusedDurationSeconds: 2.8,
      focusIntervals: [
        { startTime: 0, endTime: 1100 },
        { startTime: 1300, endTime: 3000 },
      ],
    }).pauses,
  ).toEqual([]);
  expect(convertLegacyFileTiming({ startTime: 0, endTime: 5000, focusedDurationSeconds: 2 }).pauses).toEqual([]);
  expect(convertLegacyFileTiming({ startTime: 0, endTime: 5000, focusedDurationSeconds: 2 }).elapsedSeconds).toBe(2);
});

it("normalizes old file timing without admitting legacy fields into current Sessions", () => {
  const old = { startTime: 0, endTime: 5000, focusedDurationSeconds: 2 };
  expect(() => normalizeTiming(old)).toThrow("continuous Session span");
  expect(convertLegacyFileTiming(old)).toEqual({ startedAt: 0, elapsedSeconds: 2, pauses: [] });
  expect(convertLegacyFileTiming({ ...old, manual: true })).toEqual({ startedAt: 0, elapsedSeconds: 5, pauses: [] });
  expect(convertLegacyFileTiming({ ...old, legacyContinuous: true })).toEqual({
    startedAt: 0,
    elapsedSeconds: 5,
    pauses: [],
  });
});
