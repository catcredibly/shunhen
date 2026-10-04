import type { AcademicYear, Subject, FocusSession, AppSetting } from "../types";
import type { FocusDatabase } from "../db";
import { noteMetrics } from "../notes";
import { COLOR_PALETTE, colorId, normalizeTiming } from "./model";
import { readSessionViews, yearView } from "./queries";

/** UI selectors serialize row IDs to strings. All SQL IDs and foreign keys are integers. */
export function rowId(value: string | number): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("Invalid SQLite row ID.");
  return id;
}

export abstract class Repository<T extends { id?: string; key?: string }> {
  constructor(
    readonly database: FocusDatabase,
    readonly table: "academic_years" | "subjects" | "sessions" | "settings",
  ) {}
  abstract toArray(): Promise<T[]>;
  abstract put(row: T): Promise<string>;
  async add(row: T) {
    return this.put(row);
  }
  async get(id: string): Promise<T | undefined> {
    return (await this.toArray()).find((row) => (row.id ?? row.key) === id);
  }
  async update(id: string, update: Partial<T>) {
    return this.database.transaction("rw", async (database) => {
      const repository = database.repository<T>(this.table);
      const row = await repository.get(id);
      if (row) await repository.put({ ...row, ...update });
    });
  }
  async delete(id: string) {
    await this.database.transaction("rw", async (database) => {
      await database.connection.execute(
        `DELETE FROM ${this.table} WHERE ${this.table === "settings" ? "key" : "id"}=?`,
        [this.table === "settings" ? id : rowId(id)],
      );
      if (this.table === "subjects" || this.table === "academic_years")
        await database.settings.clearMissingSubjectReferences();
    });
  }
  async clear() {
    await this.database.transaction("rw", async (database) => {
      await database.connection.execute(`DELETE FROM ${this.table}`);
      if (this.table === "subjects" || this.table === "academic_years")
        await database.settings.clearMissingSubjectReferences();
    });
  }
  async count() {
    return this.database.access(async (connection) =>
      Number((await connection.select(`SELECT COUNT(*) AS count FROM ${this.table}`))[0].count),
    );
  }
  async bulkPut(rows: T[]) {
    return this.database.transaction("rw", async (database) => {
      for (const row of rows) await database.repository<T>(this.table).put(row);
    });
  }
  async bulkAdd(rows: T[]) {
    return this.database.transaction("rw", async (database) => {
      for (const row of rows) await database.repository<T>(this.table).add(row);
    });
  }
  async bulkDelete(ids: string[]) {
    return this.database.transaction("rw", async (database) => {
      for (const id of ids) await database.repository<T>(this.table).delete(id);
    });
  }
}

export class AcademicYearRepository extends Repository<AcademicYear> {
  constructor(database: FocusDatabase) {
    super(database, "academic_years");
  }
  toArray(): Promise<AcademicYear[]> {
    return this.database.access(async (connection) =>
      (await connection.select("SELECT * FROM academic_years ORDER BY id")).map(yearView),
    );
  }
  async get(id: string) {
    if (!/^\d+$/.test(id)) return;
    return this.database.access(async (connection) => {
      const row = (await connection.select("SELECT * FROM academic_years WHERE id=?", [rowId(id)]))[0];
      return row ? yearView(row) : undefined;
    });
  }
  async put(row: AcademicYear) {
    return this.database.access(async (connection) => {
      const id = row.id ? rowId(row.id) : null;
      const result = await connection.execute(
        "INSERT INTO academic_years(id,name,start_date,end_date,archived) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,start_date=excluded.start_date,end_date=excluded.end_date,archived=excluded.archived",
        [id, row.name, row.startDate || null, row.endDate || null, row.archived],
      );
      row.id = String(id ?? result.id);
      return row.id;
    });
  }
}
export class SubjectRepository extends Repository<Subject> {
  constructor(database: FocusDatabase) {
    super(database, "subjects");
  }
  toArray() {
    return this.database.access(async (connection) =>
      (await connection.select("SELECT * FROM subjects ORDER BY id")).map((row) => ({
        id: String(row.id),
        academicYearId: String(row.academic_year_id),
        name: String(row.name),
        color: COLOR_PALETTE[Number(row.color_id)],
        archived: Boolean(row.archived),
      })),
    );
  }
  async put(row: Subject) {
    return this.database.access(async (connection) => {
      const id = row.id ? rowId(row.id) : null;
      const result = await connection.execute(
        "INSERT INTO subjects(id,academic_year_id,name,color_id,archived) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET academic_year_id=excluded.academic_year_id,name=excluded.name,color_id=excluded.color_id,archived=excluded.archived",
        [id, rowId(row.academicYearId), row.name, colorId(row.color), row.archived],
      );
      row.id = String(id ?? result.id);
      return row.id;
    });
  }
}
export class SettingsRepository extends Repository<AppSetting> {
  constructor(database: FocusDatabase) {
    super(database, "settings");
  }
  toArray() {
    return this.database.access((connection) =>
      connection.select<AppSetting>("SELECT key,value FROM settings ORDER BY key"),
    );
  }
  async clearMissingSubjectReferences() {
    const connection = this.database.connection;
    const missing = await connection.select(
      "SELECT key FROM settings WHERE key IN ('defaultSubjectId','lastSubjectId') AND value <> '' AND NOT EXISTS(SELECT 1 FROM subjects WHERE CAST(id AS TEXT)=settings.value)",
    );
    for (const row of missing) await this.put({ key: String(row.key), value: "" });
    if (missing.some((row) => row.key === "defaultSubjectId"))
      await this.put({ key: "subjectPickerMode", value: "remember" });
  }
  async get(key: string) {
    return this.database.access(
      async (connection) =>
        (await connection.select<AppSetting>("SELECT key,value FROM settings WHERE key=?", [key]))[0],
    );
  }
  async put(row: AppSetting) {
    await this.database.access((connection) =>
      connection.execute(
        "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [row.key, row.value],
      ),
    );
    return row.key;
  }
}
export class SessionRepository extends Repository<FocusSession> {
  constructor(database: FocusDatabase) {
    super(database, "sessions");
  }
  toArray() {
    return this.database.access((connection) => readSessionViews(connection));
  }
  async getBySource(sourceIdentity: string) {
    return this.database.access(async (connection) => {
      const source = (
        await connection.select("SELECT session_id FROM session_sources WHERE source_key=?", [sourceIdentity])
      )[0];
      return source ? (await readSessionViews(connection, Number(source.session_id)))[0] : undefined;
    });
  }
  async get(id: string) {
    const key = /^\d+$/.test(id)
      ? id
      : (
          await this.database.access((connection) =>
            connection.select("SELECT session_id FROM session_sources WHERE source_key IN (?,?,?)", [
              id,
              `session:${id}`,
              `legacy-session:${id}`,
            ]),
          )
        )[0]?.session_id;
    return key === undefined
      ? undefined
      : (await this.database.access((connection) => readSessionViews(connection, Number(key))))[0];
  }
  async add(row: FocusSession) {
    return this.save(row, false);
  }
  async put(row: FocusSession) {
    return this.save(row, true);
  }
  private async save(row: FocusSession, allowUpdate: boolean): Promise<string> {
    if (!noteMetrics(row.note ?? "").valid) throw new Error("Note exceeds the allowed limits.");
    const timing = normalizeTiming(row);
    return this.database.transaction("rw", async (database) => {
      const connection = database.connection;
      const previousSource =
        allowUpdate && /^\d+$/.test(row.id)
          ? (
              await connection.select("SELECT MIN(source_key) AS source_key FROM session_sources WHERE session_id=?", [
                rowId(row.id),
              ])
            )[0]?.source_key
          : undefined;
      const sourceIdentity =
        row.sourceIdentity ??
        (previousSource
          ? String(previousSource)
          : `session:${/^\d+$/.test(row.id) || !row.id ? crypto.randomUUID() : row.id}`);
      const source = (
        await connection.select("SELECT session_id FROM session_sources WHERE source_key=?", [sourceIdentity])
      )[0];
      let id: number | null = allowUpdate && /^\d+$/.test(row.id) ? rowId(row.id) : null;
      if (source) {
        if (!allowUpdate) return String(source.session_id);
        id = Number(source.session_id);
      }
      if (id !== null) await connection.execute("DELETE FROM session_pauses WHERE session_id=?", [id]);
      const result = await connection.execute(
        "INSERT INTO sessions(id,subject_id,started_at,elapsed_seconds,note,manual) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET subject_id=excluded.subject_id,started_at=excluded.started_at,elapsed_seconds=excluded.elapsed_seconds,note=excluded.note,manual=excluded.manual",
        [id, rowId(row.subjectId), timing.startedAt, timing.elapsedSeconds, row.note ?? null, row.manual === true],
      );
      id ??= result.id;
      for (const pause of timing.pauses)
        await connection.execute(
          "INSERT INTO session_pauses(session_id,offset_seconds,duration_seconds) VALUES(?,?,?)",
          [id, pause.offsetSeconds, pause.durationSeconds],
        );
      await connection.execute(
        "INSERT INTO session_sources(source_key,session_id) VALUES(?,?) ON CONFLICT(source_key) DO NOTHING",
        [sourceIdentity, id],
      );
      return String(id);
    });
  }
  async update(id: string, update: Partial<FocusSession>) {
    if (
      Object.keys(update).every((key) =>
        ["subjectId", "subjectName", "academicYearId", "academicYearName"].includes(key),
      ) &&
      update.subjectId
    ) {
      await this.database.access((connection) =>
        connection.execute("UPDATE sessions SET subject_id=? WHERE id=?", [rowId(update.subjectId!), rowId(id)]),
      );
      return;
    }
    await super.update(id, update);
  }
}
