import type { LegacyData } from "./model";

export type LegacySource = { data: LegacyData; close: () => void };
/** Open without a version: never run Dexie upgrades or mutate the source. An
 * aborted creation probe distinguishes fresh installs without leaving a DB. */
export async function readLegacy(name = "focus"): Promise<LegacySource | undefined> {
  if (typeof indexedDB === "undefined") return;
  if (indexedDB.databases && !(await indexedDB.databases()).some((database) => database.name === name)) return;
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    let absent = false,
      abandoned = false;
    request.onupgradeneeded = () => {
      absent = true;
      request.transaction!.abort();
    };
    request.onerror = () => (absent ? resolve(undefined) : reject(request.error));
    request.onblocked = () => {
      abandoned = true;
      reject(new Error("Legacy database is blocked."));
    };
    request.onsuccess = () => {
      const database = request.result;
      if (abandoned) {
        database.close();
        return;
      }
      const names = ["academicYears", "subjects", "sessions", "settings"].filter((store) =>
        database.objectStoreNames.contains(store),
      );
      if (!["academicYears", "subjects", "sessions"].every((store) => names.includes(store))) {
        database.close();
        reject(new Error("Legacy schema is incomplete."));
        return;
      }
      const transaction = database.transaction(names, "readonly");
      const data: LegacyData = { academicYears: [], subjects: [], sessions: [], settings: [] };
      for (const name of names) {
        const rows = transaction.objectStore(name).getAll();
        rows.onsuccess = () => {
          Object.assign(data, { [name]: rows.result });
        };
      }
      transaction.oncomplete = () => resolve({ data, close: () => database.close() });
      transaction.onerror = transaction.onabort = () => {
        database.close();
        reject(transaction.error ?? new Error("Cannot read legacy database."));
      };
    };
  });
}
export async function deleteLegacy(name = "focus") {
  if (typeof indexedDB === "undefined") return;
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Legacy database cleanup is blocked."));
  });
}
