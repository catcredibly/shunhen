import type { FocusDatabase } from "../db";
import { validateData } from "./model";
import { readNormalized } from "./snapshot";

export async function validateDatabase(database: FocusDatabase) {
  await database.transaction("r", async (database) => {
    if ((await database.connection.select("PRAGMA foreign_key_check")).length)
      throw new Error("SQLite foreign key validation failed.");
    validateData(await readNormalized(database));
  });
}
