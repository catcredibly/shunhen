import { createTestDatabase } from "./storage/testDatabase";
import { afterEach, beforeEach, expect, it } from "vitest";
import { FocusDatabase } from "./db";
import { cycleSubjectColor, nextSubjectColor, SUBJECT_COLORS } from "./subjectColors";

let database: FocusDatabase;
beforeEach(async () => {
  database = createTestDatabase(`subject-colors-${crypto.randomUUID()}`).database;
  await database.academicYears.add({ id: "1", name: "Year", archived: false });
  await database.subjects.add({
    id: "1",
    name: "Math",
    academicYearId: "1",
    archived: true,
    color: SUBJECT_COLORS[0],
  });
});
afterEach(() => database.delete());
it("persists each palette color in order, wraps, and changes only the chosen Subject color", async () => {
  const original = await database.subjects.get("1");
  await database.subjects.add({ ...original!, id: "2" });
  for (let click = 1; click <= SUBJECT_COLORS.length; click++) {
    await cycleSubjectColor("1", database);
    expect(await database.subjects.get("1")).toEqual({
      ...original,
      color: SUBJECT_COLORS[click % SUBJECT_COLORS.length],
    });
    expect(await database.subjects.get("2")).toEqual({ ...original, id: "2" });
  }
});
it("preserves consecutive clicks before the list rerenders", async () => {
  await Promise.all([cycleSubjectColor("1", database), cycleSubjectColor("1", database)]);
  expect((await database.subjects.get("1"))?.color).toBe(SUBJECT_COLORS[2]);
});

it("keeps the original palette prefix and appends the specified six colors", () => {
  expect(SUBJECT_COLORS).toEqual([
    "#4da3ff",
    "#ff4d57",
    "#ffad3b",
    "#4dd39a",
    "#a879ff",
    "#ff7eb6",
    "#45d9e8",
    "#a8d94f",
    "#f4d64e",
    "#6672e5",
    "#2cb7a9",
    "#d95fe8",
  ]);
});
it("uses all twelve colors for new Subjects while ignoring archived and other-year Subjects", () => {
  const active = SUBJECT_COLORS.slice(0, 11).map((color, id) => ({
    id: String(id),
    name: String(id),
    academicYearId: "1",
    archived: false,
    color,
  }));
  const input = [
    ...active,
    { ...active[0], id: "archived", color: SUBJECT_COLORS[11], archived: true },
    { ...active[0], id: "2", color: SUBJECT_COLORS[11], academicYearId: "2" },
  ];
  const original = structuredClone(input);
  expect(nextSubjectColor(input, "1")).toBe(SUBJECT_COLORS[11]);
  expect(input).toEqual(original);
});
