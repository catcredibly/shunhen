// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TimerPage } from "./TimerPage";
import { changed } from "../storage/connection";
import type { AcademicYear, FocusSession, Subject } from "../types";

const queries = vi.hoisted(() => ({ years: vi.fn(), subjects: vi.fn(), sessions: vi.fn() }));
vi.mock("../db", () => ({
  db: { academicYears: { toArray: queries.years }, subjects: { toArray: queries.subjects } },
}));
vi.mock("../storage/queries", () => ({ readHistorySessions: queries.sessions }));
vi.mock("../hooks/TimerContext", () => ({
  useMainTimer: () => ({ state: { running: false, note: "" }, noteValid: true, setNote: vi.fn() }),
}));
vi.mock("../hooks/useSettings", async () => {
  const { DEFAULT_SETTINGS } = await import("../settings");
  return { useSettings: () => ({ settings: DEFAULT_SETTINGS, setSetting: vi.fn() }) };
});
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (text: string) => text }),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function pendingQueries() {
  const years = deferred<AcademicYear[]>(),
    subjects = deferred<Subject[]>(),
    sessions = deferred<FocusSession[]>();
  queries.years.mockReturnValue(years.promise);
  queries.subjects.mockReturnValue(subjects.promise);
  queries.sessions.mockReturnValue(sessions.promise);
  return { years, subjects, sessions };
}
const years: AcademicYear[] = [{ id: "1", name: "2026", archived: false }];
const subjects: Subject[] = [{ id: "2", academicYearId: "1", name: "Physics", color: "#4da3ff", archived: false }];
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
const renderTimer = () => act(async () => root.render(<TimerPage onNavigate={vi.fn()} />));
const skeleton = () => host.querySelector('.timer-loading[aria-busy="true"]');
const setup = () => host.querySelector("#setup-title");

it("shows a noninteractive Timer skeleton until all initial queries resolve, without onboarding", async () => {
  const pending = pendingQueries();
  await renderTimer();
  expect(skeleton()).not.toBeNull();
  expect(setup()).toBeNull();
  expect(host.querySelectorAll("button,input,textarea,select")).toHaveLength(0);
  await act(async () => {
    pending.years.resolve(years);
    pending.subjects.resolve(subjects);
  });
  expect(skeleton()).not.toBeNull();
  expect(setup()).toBeNull();
  await act(async () => pending.sessions.resolve([]));
  expect(skeleton()).toBeNull();
  expect(setup()).toBeNull();
  expect(host.querySelector(".time-entry")).not.toBeNull();
  expect(host.textContent).toContain("Physics");
});

it("renders actual setup only after empty data has been confirmed", async () => {
  const pending = pendingQueries();
  await renderTimer();
  await act(async () => {
    pending.years.resolve([]);
    pending.subjects.resolve([]);
  });
  expect(setup()).toBeNull();
  expect(skeleton()).not.toBeNull();
  await act(async () => pending.sessions.resolve([]));
  expect(skeleton()).toBeNull();
  expect(setup()?.textContent).toBe("Set up Shunhen");
});

it.each([
  { years: [{ ...years[0], archived: true }], subjects, message: "No active Academic Years" },
  { years, subjects: [], message: "No active subjects" },
])("preserves the resolved unavailable state: $message", async (data) => {
  queries.years.mockResolvedValue(data.years);
  queries.subjects.mockResolvedValue(data.subjects);
  queries.sessions.mockResolvedValue([]);
  await renderTimer();
  expect(skeleton()).toBeNull();
  expect(setup()).toBeNull();
  expect(host.textContent).toContain(data.message);
});

it("shows the skeleton rather than onboarding when navigating back, and keeps loaded content during refresh", async () => {
  queries.years.mockResolvedValue(years);
  queries.subjects.mockResolvedValue(subjects);
  queries.sessions.mockResolvedValue([]);
  await renderTimer();
  expect(host.querySelector(".time-entry")).not.toBeNull();
  await act(async () => root.render(<div>History</div>));
  const pending = pendingQueries();
  await renderTimer();
  expect(skeleton()).not.toBeNull();
  expect(setup()).toBeNull();
  await act(async () => {
    pending.years.resolve(years);
    pending.subjects.resolve(subjects);
    pending.sessions.resolve([]);
  });
  const refresh = pendingQueries();
  await act(async () => changed());
  expect(skeleton()).toBeNull();
  expect(host.querySelector(".time-entry")).not.toBeNull();
  await act(async () => {
    refresh.years.resolve(years);
    refresh.subjects.resolve([]);
    refresh.sessions.resolve([]);
  });
  expect(skeleton()).toBeNull();
  expect(host.textContent).toContain("No active subjects");
});
