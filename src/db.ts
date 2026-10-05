import {
  AcademicYearRepository,
  SubjectRepository,
  SessionRepository,
  SettingsRepository,
  type Repository,
} from "./storage/repositories";
import { Connection, withStorageLock, type Request } from "./storage/connection";

export class FocusDatabase {
  readonly academicYears = new AcademicYearRepository(this);
  readonly subjects = new SubjectRepository(this);
  readonly sessions = new SessionRepository(this);
  readonly settings = new SettingsRepository(this);
  readonly connection: Connection;
  constructor(
    readonly name = "focus",
    request?: Request,
    token?: string,
  ) {
    this.connection = new Connection(request, token);
  }
  async open() {
    await this.access((connection) => connection.select("SELECT 1"));
  }
  close() {
    /* The native application owns the connection. */
  }
  async delete() {
    await this.transaction("rw", async (database) => {
      await database.academicYears.clear();
      await database.settings.clear();
    });
  }
  async access<T>(callback: (connection: Connection) => Promise<T>): Promise<T> {
    if (this.connection.token) return callback(this.connection);
    return withStorageLock(() => callback(this.connection));
  }
  repository<T extends { id?: string; key?: string }>(table: string): Repository<T> {
    const repository =
      table === "academic_years"
        ? this.academicYears
        : table === "subjects"
          ? this.subjects
          : table === "sessions"
            ? this.sessions
            : this.settings;
    return repository as unknown as Repository<T>;
  }
  /** Nested calls share the explicit scoped connection, never ambient context. */
  async transaction<T>(_mode: "r" | "rw", callback: (database: FocusDatabase) => Promise<T> | T): Promise<T> {
    if (this.connection.token) return callback(this);
    return withStorageLock(() => this.runTransaction(callback));
  }
  async runTransaction<T>(callback: (database: FocusDatabase) => Promise<T> | T): Promise<T> {
    const token = crypto.randomUUID();
    await this.connection.request("begin", token);
    const scoped = new FocusDatabase(this.name, this.connection.request, token);
    try {
      const value = await callback(scoped);
      await this.connection.request("commit", token);
      return value;
    } catch (error) {
      try {
        await this.connection.request("rollback", token);
      } catch {
        /* Preserve the original failure; native window teardown also rolls back. */
      }
      throw error;
    }
  }
}
export const db = new FocusDatabase();
