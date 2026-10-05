// Test-only bridge: execute the production SQL against an actual SQLite engine.
// Never imported by the application bundle.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { FocusDatabase } from "../db";
import type { Request } from "./connection";

export function createTestDatabase(name = "test") {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
  let owner: string | undefined;
  const request: Request = async (action, token, sql, parameters = []) => {
    if (action === "begin") {
      if (owner) throw new Error("Transaction active");
      sqlite.exec("BEGIN IMMEDIATE");
      owner = token;
      return;
    }
    if (token !== owner) throw new Error("Transaction owner mismatch");
    if (action === "commit" || action === "rollback") {
      sqlite.exec(action.toUpperCase());
      owner = undefined;
      return;
    }
    const statement = sqlite.prepare(sql!);
    const values = parameters.map((value) => (typeof value === "boolean" ? Number(value) : value));
    if (action === "select") return statement.all(...values);
    const result = statement.run(...values);
    return { id: Number(result.lastInsertRowid), affected: Number(result.changes) };
  };
  const database = new FocusDatabase(name, request);
  return { database, sqlite, request };
}
