import { describe, expect, it } from "vitest";
import { formatDuration, formatDurationAxis, createSession } from "./data";
import { createTestDatabase } from "./storage/testDatabase";
describe("Session creation", () => {
  it("allocates integer IDs, derives whole-second timing and validates relationships", async () => {
    const { database, sqlite } = createTestDatabase();
    const academicYear = { id: "", name: "Year", archived: false };
    await database.academicYears.add(academicYear);
    const subject = { id: "", academicYearId: academicYear.id, name: "Subject", color: "#4da3ff", archived: false };
    await database.subjects.add(subject);
    const saved = await createSession(
      { academicYear, subject, startTime: 1420, endTime: 6810, note: "Note" },
      database,
    );
    expect(saved).toMatchObject({
      id: "1",
      startTime: 1000,
      endTime: 7000,
      focusedDurationSeconds: 6,
      manual: true,
      note: "Note",
    });
    expect(sqlite.prepare("SELECT * FROM session_pauses").all()).toEqual([]);
    await database.academicYears.update(academicYear.id, { archived: true });
    await expect(createSession({ academicYear, subject, startTime: 1000, endTime: 2000 }, database)).rejects.toThrow(
      "active Academic Year",
    );
    sqlite.close();
  });
  it("formats durations and chart axes without changing persistence precision", () => {
    expect(formatDuration(4515)).toBe("1 hr 15 min");
    expect(formatDurationAxis(21)).toBe("21 sec");
    expect(formatDurationAxis(300)).toBe("5 min");
    expect(formatDurationAxis(4500)).toBe("1.3 hr");
  });
});
