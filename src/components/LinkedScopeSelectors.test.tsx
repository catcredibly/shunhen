// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LinkedScopeSelectors } from "./LinkedScopeSelectors";
import { ALL_SCOPE, type LinkedScope } from "../linkedScope";
import { selectableSubjects } from "../selectorOptions";
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, opts?: { count: number }) => key.replace("{{count}}", String(opts?.count ?? "")),
  }),
}));
const years = [
  { id: "1", name: "IB", archived: false },
  { id: "2", name: "University", archived: false },
  { id: "3", name: "Archived", archived: true },
];
const subjects = [
  { id: "11", academicYearId: "1", name: "Chemistry", color: "red", archived: false },
  { id: "12", academicYearId: "1", name: "Physics", color: "red", archived: false },
  { id: "21", academicYearId: "2", name: "Engineering", color: "red", archived: false },
  { id: "31", academicYearId: "3", name: "Old", color: "red", archived: false },
  { id: "13", academicYearId: "1", name: "Old IB", color: "red", archived: true },
];
let host: HTMLDivElement, root: Root, state: LinkedScope;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
function Harness({
  goal = false,
  empty = false,
  settings = false,
}: {
  goal?: boolean;
  empty?: boolean;
  settings?: boolean;
}) {
  const [value, setValue] = useState(ALL_SCOPE);
  state = value;
  return (
    <LinkedScopeSelectors
      years={empty ? [] : goal ? years.filter((row) => !row.archived) : years}
      subjects={empty ? [] : goal ? selectableSubjects(years, subjects) : subjects}
      value={value}
      onChange={setValue}
      multiOnly={goal}
      requireNonEmptyScope={goal}
      variant={settings ? "settings" : "filter"}
      emptyYears="No active Academic Years available."
      emptySubjects="No active Subjects available."
    />
  );
}
const trigger = (label: string) => host.querySelector<HTMLButtonElement>('button[aria-label="' + label + '"]')!;
const panel = () => document.querySelector('[role="dialog"]')!;
const option = (name: string) =>
  [...panel().querySelectorAll<HTMLElement>('[role="option"]')].find((row) => row.textContent === name)!;
const click = async (node: Element) =>
  act(async () => {
    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
const escape = async () =>
  act(async () => {
    panel().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
const toggle = () => panel().querySelector('[role="switch"]')!;
it("keeps independent default Single modes and resets a specific Subject on year expansion", async () => {
  await act(async () => root.render(<Harness />));
  await click(trigger("Academic Year"));
  expect(toggle().getAttribute("aria-checked")).toBe("false");
  await click(option("IB"));
  expect(trigger("Subject").textContent).toBe("All Subjects");
  await click(trigger("Subject"));
  expect(toggle().getAttribute("aria-checked")).toBe("false");
  expect(panel().textContent).not.toContain("Engineering");
  await click(option("Chemistry"));
  await click(trigger("Academic Year"));
  await click(toggle());
  await click(option("University"));
  await escape();
  expect(trigger("Subject").textContent).toBe("All Subjects");
  await click(trigger("Subject"));
  expect(toggle().getAttribute("aria-checked")).toBe("false");
});
it("All checks every Subject, custom uses indeterminate, and the final selected Subject remains checked", async () => {
  await act(async () => root.render(<Harness goal />));
  await click(trigger("Academic Year"));
  await click(option("IB"));
  await escape();
  await click(trigger("Subject"));
  const checkbox = (name: string) => option(name).querySelector<HTMLInputElement>("input[type=checkbox]")!;
  expect(checkbox("All Subjects").checked).toBe(true);
  expect(checkbox("Chemistry").checked).toBe(true);
  expect(checkbox("Physics").checked).toBe(true);
  await click(option("Chemistry"));
  expect(state.subjectIds).toEqual(["12"]);
  expect(checkbox("All Subjects").indeterminate).toBe(true);
  expect(option("All Subjects").getAttribute("aria-checked")).toBe("mixed");
  await click(option("Physics"));
  expect(state.subjectIds).toEqual(["12"]);
  expect(state.yearIds).toEqual(["1"]);
  await click(option("All Subjects"));
  expect(state.subjectIds).toEqual([]);
  expect(checkbox("All Subjects").indeterminate).toBe(false);
  await click(option("Chemistry"));
  await click(option("Chemistry"));
  expect(state.subjectIds).toEqual([]);
  await click(option("Physics"));
  expect(state.subjectIds).toEqual(["11"]);
  await escape();
  await click(trigger("Academic Year"));
  await click(option("University"));
  expect(state.subjectIds).toEqual([]);
  await escape();
  await click(trigger("Subject"));
  expect(checkbox("Engineering").checked).toBe(true);
  expect(checkbox("Physics").checked).toBe(true);
});
it("Settings scope uses two standard rows and the same Settings trigger class, with no mode toggle or archived choices", async () => {
  await act(async () => root.render(<Harness goal settings />));
  expect(host.querySelectorAll(".setting-row")).toHaveLength(2);
  expect(host.querySelectorAll(".setting-control .settings-default-subject")).toHaveLength(2);
  expect(host.querySelector(".filter-bar")).toBeNull();
  await click(trigger("Academic Years"));
  expect(panel().querySelector('[role="switch"]')).toBeNull();
  expect(panel().textContent).not.toContain("Archived");
  await click(option("IB"));
  await escape();
  await click(trigger("Subjects"));
  expect(panel().querySelector('[role="switch"]')).toBeNull();
  expect(panel().textContent).not.toContain("Old IB");
  expect(panel().textContent).not.toContain("Engineering");
  expect(panel().querySelector(".filter-group-heading")?.textContent).toBe("IB");
});
it("History exposes archived data but searches only selected years", async () => {
  await act(async () => root.render(<Harness />));
  await click(trigger("Academic Year"));
  expect(option("Archived")).toBeDefined();
  await click(option("IB"));
  await click(trigger("Subject"));
  expect(option("Old IB")).toBeDefined();
  const search = panel().querySelector<HTMLInputElement>("input[type=search]")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "Engineering");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(panel().querySelectorAll("[role=option]")).toHaveLength(1);
  expect(panel().textContent).toContain("No results found");
});
it("uses standard empty-state Settings rows without archived fallback", async () => {
  await act(async () => root.render(<Harness goal empty settings />));
  expect(trigger("Academic Years").disabled).toBe(true);
  expect(trigger("Subjects").disabled).toBe(true);
  expect(host.textContent).toContain("No active Academic Years available.");
  expect(host.textContent).toContain("No active Subjects available.");
});

it("Goal scope cannot uncheck its final active year or disturb Subject refinements", async () => {
  await act(async () => root.render(<Harness goal />));
  await click(trigger("Academic Year"));
  await click(option("IB"));
  await escape();
  await click(trigger("Subject"));
  await click(option("Chemistry"));
  expect(state.subjectIds).toEqual(["12"]);
  await escape();
  await click(trigger("Academic Year"));
  await click(option("IB"));
  expect(state.yearIds).toEqual(["1"]);
  expect(state.subjectIds).toEqual(["12"]);
  await click(option("University"));
  expect(state.yearIds).toEqual(["1", "2"]);
  expect(state.subjectIds).toEqual([]);
});
