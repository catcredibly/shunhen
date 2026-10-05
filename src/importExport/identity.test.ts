import { expect, it } from "vitest";
import { createTestDatabase } from "../storage/testDatabase";
import { readNormalized } from "../storage/snapshot";
import { createBackup, validateBackup, restoreBackup, analyzeBackup } from "./backup";
import { exportSessionsCsv, previewCsv, importCsvPreview } from "./csv";
import { planParents, canonicalSession } from "./duplicates";
import type { NormalizedData } from "../storage/model";

async function seeded() {
  const test = createTestDatabase();
  const year = { id: "", name: "Year", archived: false };
  await test.database.academicYears.add(year);
  const subject = { id: "", academicYearId: year.id, name: "Subject", color: "#4da3ff", archived: false };
  await test.database.subjects.add(subject);
  const id = await test.database.sessions.putNormalized({
    subjectId: Number(subject.id),
    startedAt: 100,
    elapsedSeconds: 60,
    pauses: [],
    manual: false,
  });
  return { ...test, year, subject, session: (await test.database.sessions.get(id))! };
}
it("keeps Session identity stable through edits, enforces one mapping, and cascades deletion", async () => {
  const test = await seeded();
  try {
    const identity = test.session.sourceIdentity!;
    expect(identity).toMatch(/^session:[0-9a-f-]{36}$/);
    await test.database.sessions.update(test.session.id, {
      startTime: 200000,
      endTime: 260000,
      focusIntervals: [{ startTime: 200000, endTime: 260000 }],
      note: "Edited",
    });
    expect((await test.database.sessions.get(test.session.id))?.sourceIdentity).toBe(identity);
    await expect(
      test.database.sessions.putNormalized({
        id: Number(test.session.id),
        subjectId: Number(test.subject.id),
        startedAt: 200,
        elapsedSeconds: 60,
        pauses: [],
        manual: false,
        sourceIdentity: "session:another",
      }),
    ).rejects.toThrow("cannot be changed");
    expect(() =>
      test.sqlite.prepare("INSERT INTO session_sources VALUES(?,?)").run("session:alias", Number(test.session.id)),
    ).toThrow();
    expect((await createBackup(test.database)).sessions[0].sourceIdentity).toBe(identity);
    expect((await createBackup(test.database)).sessions[0].sourceIdentity).toBe(identity);
    const secondSubject = { ...test.subject, id: "", name: "Moved" };
    await test.database.subjects.add(secondSubject);
    await test.database.sessions.update(test.session.id, { subjectId: secondSubject.id });
    expect((await test.database.sessions.get(test.session.id))?.sourceIdentity).toBe(identity);
    await test.database.sessions.delete(test.session.id);
    expect(test.sqlite.prepare("SELECT * FROM session_sources").all()).toEqual([]);
  } finally {
    test.sqlite.close();
  }
});

it("classifies JSON by identity and resolved destination, preserves local IDs through conflict updates", async () => {
  const source = await seeded(),
    target = await seeded();
  try {
    const backup = validateBackup(await createBackup(source.database));
    expect((await restoreBackup(backup, "merge", "keep-existing", target.database)).sessionsImported).toBe(1);
    expect(await target.database.sessions.count()).toBe(2); // same input/local integer ID, distinct identities
    const imported = (await target.database.sessions.getBySource(source.session.sourceIdentity!))!;
    expect(imported.id).not.toBe(source.session.id);
    const before = await analyzeBackup(backup, target.database);
    expect(before.conflicts).toBe(0);
    expect((await restoreBackup(backup, "merge", "keep-existing", target.database)).sessionsImported).toBe(0);
    backup.data.sessions[0].note = "Changed";
    expect((await analyzeBackup(backup, target.database)).conflicts).toBeGreaterThan(0);
    const kept = await restoreBackup(backup, "merge", "keep-existing", target.database);
    expect(kept.conflicts).toBe(1);
    expect((await target.database.sessions.get(imported.id))?.note).toBeUndefined();
    const updated = await restoreBackup(backup, "merge", "use-imported", target.database);
    expect(updated.conflicts).toBe(1);
    expect(await target.database.sessions.get(imported.id)).toMatchObject({
      id: imported.id,
      sourceIdentity: source.session.sourceIdentity,
      note: "Changed",
    });
    expect(await target.database.sessions.count()).toBe(2);
  } finally {
    source.sqlite.close();
    target.sqlite.close();
  }
});

it("deduplicates identical identities within JSON and rejects conflicting identities before replacement", async () => {
  const test = await seeded();
  try {
    const backup = await createBackup(test.database);
    backup.sessions.push({ ...backup.sessions[0], id: 99 });
    const parsed = validateBackup(backup);
    expect(parsed.repeatedSessions).toBe(1);
    expect(parsed.data.sessions).toHaveLength(1);
    expect((await restoreBackup(parsed, "replace", "use-imported", test.database)).duplicatesSkipped).toBe(1);
    const before = await readNormalized(test.database);
    backup.sessions[1].note = "Conflicting";
    expect(() => validateBackup(backup)).toThrow("Conflicting Session identities");
    expect(await readNormalized(test.database)).toEqual(before);
  } finally {
    test.sqlite.close();
  }
});

it("trusted CSV agrees with JSON on duplicates and conflicts, with both conflict policies", async () => {
  const test = await seeded();
  try {
    const csv = exportSessionsCsv([test.session]);
    const duplicate = await previewCsv(csv, undefined, undefined, test.database);
    expect(duplicate.rows[0]).toMatchObject({ duplicate: true, duplicateKind: "identity", conflict: false });
    const changed = exportSessionsCsv([{ ...test.session, note: "Changed" }]);
    const preview = await previewCsv(changed, undefined, undefined, test.database);
    expect(preview.rows[0]).toMatchObject({ duplicate: false, conflict: true, errors: [] });
    expect((await importCsvPreview(preview, test.database)).conflicts).toBe(1);
    expect((await test.database.sessions.get(test.session.id))?.note).toBeUndefined();
    expect((await importCsvPreview(preview, test.database, "use-imported")).conflicts).toBe(1);
    expect(await test.database.sessions.get(test.session.id)).toMatchObject({
      id: test.session.id,
      sourceIdentity: test.session.sourceIdentity,
      note: "Changed",
    });
    // A preview is never authoritative after the database changes.
    expect((await importCsvPreview(preview, test.database, "use-imported")).duplicatesSkipped).toBe(1);
  } finally {
    test.sqlite.close();
  }
});

it("checks repeated CSV identities across the entire file before writes", async () => {
  const test = await seeded(),
    target = createTestDatabase();
  try {
    const repeated = await previewCsv(
      exportSessionsCsv([test.session, test.session]),
      undefined,
      undefined,
      target.database,
    );
    expect(repeated.rows[1].duplicate).toBe(true);
    expect((await importCsvPreview(repeated, target.database)).sessionsImported).toBe(1);
    const conflict = await previewCsv(
      exportSessionsCsv([test.session, { ...test.session, note: "Different" }]),
      undefined,
      undefined,
      target.database,
    );
    expect(conflict.identityConflict).toBe(true);
    expect(conflict.rows.every((row) => row.errors.includes("Conflicting Session identities in import."))).toBe(true);
    const before = await readNormalized(target.database);
    await expect(importCsvPreview(conflict, target.database, "use-imported")).rejects.toThrow("Conflicting");
    expect(await readNormalized(target.database)).toEqual(before);
  } finally {
    test.sqlite.close();
    target.sqlite.close();
  }
});

it("ignores arbitrary generic CSV IDs and source columns, and counts fallback multiplicity", async () => {
  const { database, sqlite } = createTestDatabase();
  try {
    const header = "ID,Year,Subject,Start,End,Notes,Source Identity";
    const record = "1,Year,Subject,2026-01-01T12:00:00,2026-01-01T12:01:00,Same,session:untrusted";
    const two = await previewCsv([header, record, record].join("\n"), undefined, undefined, database);
    expect(two.rows.every((row) => row.session?.sourceIdentity === undefined)).toBe(true);
    expect((await importCsvPreview(two, database)).sessionsImported).toBe(2);
    const three = await previewCsv([header, record, record, record].join("\n"), undefined, undefined, database);
    expect(three.rows.map((row) => row.duplicate)).toEqual([true, true, false]);
    expect(three.rows[0].duplicateKind).toBe("fingerprint");
    expect((await importCsvPreview(three, database)).sessionsImported).toBe(1);
    const identities = (await database.sessions.toArray()).map((row) => row.sourceIdentity!);
    expect(new Set(identities).size).toBe(3);
    expect(identities.every((identity) => /^session:[0-9a-f-]{36}$/.test(identity))).toBe(true);
    const unrelated = await previewCsv(
      [header, record.replace("Same", "Different")].join("\n"),
      undefined,
      undefined,
      database,
    );
    expect((await importCsvPreview(unrelated, database)).sessionsImported).toBe(1);
  } finally {
    sqlite.close();
  }
});

it("namespaces recognized legacy IDs without mixing native identity domains", async () => {
  const { database, sqlite } = createTestDatabase();
  try {
    const csv =
      "Session ID,Academic Year,Subject,Start Date,Start Time,End Date,End Time,Focused Minutes,Archived,Note\nX,Year,Subject,2026-01-01,12:00,2026-01-01,12:01,1,false,";
    const preview = await previewCsv(csv, undefined, undefined, database);
    expect(preview.rows[0].session?.sourceIdentity).toBe("legacy-session:X");
    await importCsvPreview(preview, database);
    expect(await database.sessions.getBySource("session:X")).toBeUndefined();
    expect(await database.sessions.getBySource("legacy-session:X")).toBeDefined();
  } finally {
    sqlite.close();
  }
});

it("matches parent details one-to-one independently of query order and reports indistinguishable ties", () => {
  const empty: NormalizedData = { academicYears: [], subjects: [], sessions: [], settings: [] };
  const existing: NormalizedData = {
    ...empty,
    academicYears: [
      { id: 30, name: " Year ", archived: true },
      { id: 10, name: "YEAR", archived: false },
    ],
    subjects: [
      { id: 50, academicYearId: 10, name: "Subject", colorId: 1, archived: true },
      { id: 20, academicYearId: 10, name: " SUBJECT ", colorId: 0, archived: false },
    ],
  };
  const incoming: NormalizedData = {
    ...empty,
    academicYears: [
      { id: 1, name: "year", archived: false },
      { id: 2, name: "year", archived: true },
    ],
    subjects: [
      { id: 1, academicYearId: 1, name: "subject", colorId: 0, archived: false },
      { id: 2, academicYearId: 1, name: "subject", colorId: 1, archived: true },
    ],
  };
  const plan = planParents(incoming, existing);
  expect(plan.years.get(1)?.destination).toBe("10");
  expect(plan.years.get(2)?.destination).toBe("30");
  expect(plan.subjects.get(1)?.destination).toBe("20");
  expect(plan.subjects.get(2)?.destination).toBe("50");
  expect(
    planParents(
      { ...incoming, academicYears: [...incoming.academicYears].reverse(), subjects: [...incoming.subjects].reverse() },
      { ...existing, academicYears: [...existing.academicYears].reverse(), subjects: [...existing.subjects].reverse() },
    ),
  ).toEqual(plan);
  expect(() =>
    planParents(incoming, {
      ...existing,
      academicYears: existing.academicYears.map((row) => ({ ...row, archived: false })),
    }),
  ).toThrow("Ambiguous Academic Year");
  expect(() =>
    planParents(incoming, {
      ...existing,
      subjects: existing.subjects.map((row) => ({ ...row, colorId: 0, archived: false })),
    }),
  ).toThrow("Ambiguous Subject");
});

it("ambiguous merge relationships leave data intact while full replacement needs no local matching", async () => {
  const test = await seeded();
  try {
    const backup = validateBackup(await createBackup(test.database));
    await test.database.academicYears.add({ ...test.year, id: "", name: " YEAR " });
    const before = await readNormalized(test.database);
    const analysis = await analyzeBackup(backup, test.database);
    expect(analysis.ambiguities).toContain("Ambiguous Academic Year match.");
    await expect(restoreBackup(backup, "merge", "use-imported", test.database)).rejects.toThrow("Ambiguous");
    expect(await readNormalized(test.database)).toEqual(before);
    expect((await restoreBackup(backup, "replace", "use-imported", test.database)).sessionsImported).toBe(1);
  } finally {
    test.sqlite.close();
  }
});

it("canonical comparison ignores incidental property order and treats absent notes consistently", () => {
  const row = { startedAt: 1, elapsedSeconds: 10, pauses: [{ offsetSeconds: 2, durationSeconds: 1 }], manual: false };
  expect(canonicalSession(row, 4)).toBe(
    canonicalSession({ ...row, note: "", pauses: [{ durationSeconds: 1, offsetSeconds: 2 }] }, "4"),
  );
});

it("reserves exact parent matches before resolving unmatched conflicts", () => {
  const empty: NormalizedData = { academicYears: [], subjects: [], sessions: [], settings: [] };
  const existing = {
    ...empty,
    academicYears: [
      { id: 10, name: "Year", archived: false, startDate: "2026-01-01" },
      { id: 20, name: "Year", archived: true },
    ],
  };
  const incoming = {
    ...empty,
    academicYears: [
      { id: 1, name: "Year", archived: false, startDate: "2026-02-01" },
      { id: 2, name: "Year", archived: true },
    ],
  };
  const plan = planParents(incoming, existing);
  expect(plan.years.get(1)).toMatchObject({ destination: "10", conflict: true });
  expect(plan.years.get(2)).toMatchObject({ destination: "20", conflict: false });
});

it("reads the earlier v2 identity map but exports only per-Session canonical identities", async () => {
  const test = await seeded();
  try {
    const backup = await createBackup(test.database);
    backup.sessionIdentities = { [backup.sessions[0].id]: backup.sessions[0].sourceIdentity! };
    delete backup.sessions[0].sourceIdentity;
    expect(validateBackup(backup).data.sessions[0].sourceIdentity).toBe(test.session.sourceIdentity);
    backup.sessions[0].sourceIdentity = "1";
    expect(() => validateBackup(backup)).toThrow();
    expect(await createBackup(test.database)).not.toHaveProperty("sessionIdentities");
  } finally {
    test.sqlite.close();
  }
});

it.each(["year", "subject"])("rejects ambiguous CSV %s destinations before writes", async (kind) => {
  const test = await seeded();
  try {
    if (kind === "year") await test.database.academicYears.add({ ...test.year, id: "", name: " YEAR " });
    else await test.database.subjects.add({ ...test.subject, id: "", name: " SUBJECT " });
    const before = await readNormalized(test.database);
    const preview = await previewCsv(exportSessionsCsv([test.session]), undefined, undefined, test.database);
    expect(preview.rows[0].errors.some((error) => error.startsWith("Ambiguous "))).toBe(true);
    await expect(importCsvPreview(preview, test.database, "use-imported")).rejects.toThrow("Ambiguous");
    expect(await readNormalized(test.database)).toEqual(before);
  } finally {
    test.sqlite.close();
  }
});

it.each(["keep-existing", "use-imported"] as const)(
  "JSON preview and restore classification counts agree under %s",
  async (policy) => {
    const source = await seeded(),
      target = await seeded();
    try {
      const backup = validateBackup(await createBackup(source.database));
      await restoreBackup(backup, "merge", "use-imported", target.database);
      await target.database.settings.put({ key: "theme", value: "light" });
      backup.data.sessions[0].note = "Changed";
      const analysis = await analyzeBackup(backup, target.database);
      const result = await restoreBackup(backup, "merge", policy, target.database);
      expect(result.conflicts).toBe(analysis.conflicts);
      expect(result.duplicatesSkipped).toBe(analysis.duplicates);
    } finally {
      source.sqlite.close();
      target.sqlite.close();
    }
  },
);

it("uses an explicit CSV destination year even when year names are ambiguous", async () => {
  const test = await seeded();
  try {
    const other = { ...test.year, id: "", name: " YEAR " };
    await test.database.academicYears.add(other);
    const text = "Subject,Start,End\nSubject,2026-01-01T12:00:00,2026-01-01T12:01:00";
    const preview = await previewCsv(text, undefined, other.id, test.database);
    expect(preview.rows[0].errors).toEqual([]);
    expect((await importCsvPreview(preview, test.database)).sessionsImported).toBe(1);
    expect((await test.database.sessions.toArray()).find((row) => row.academicYearId === other.id)).toBeDefined();
  } finally {
    test.sqlite.close();
  }
});
