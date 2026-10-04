import { isTauri } from "@tauri-apps/api/core";
import { enable, disable, isEnabled } from "@tauri-apps/plugin-autostart";
import { db, type FocusDatabase } from "./db";

let pending: Promise<unknown> = Promise.resolve();
let observedState: boolean | undefined;
const listeners = new Set<() => void>();
export const startupState = {
  snapshot: () => observedState,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
async function readNativeState() {
  const actual = await isEnabled();
  if (observedState !== actual) {
    observedState = actual;
    listeners.forEach((listener) => listener());
  }
  return actual;
}
/** Serialize native changes and persist only observed native state. */
export function synchronizeStartup<T = void>(
  database: FocusDatabase = db,
  requested?: boolean,
  commit?: (verified: boolean) => Promise<T>,
): Promise<T | undefined> {
  const operation = async () => {
    if (!isTauri()) {
      const value = requested ?? (await database.settings.get("launchAtStartup"))?.value === "true";
      if (commit) return commit(value);
      if (requested !== undefined) await database.settings.put({ key: "launchAtStartup", value: String(value) });
      return;
    }
    const previous = await readNativeState();
    const persist = async () => {
      const actual = await readNativeState();
      await database.settings.put({ key: "launchAtStartup", value: String(actual) });
      return actual;
    };
    let committing = false;
    try {
      if (requested !== undefined && requested !== previous) await (requested ? enable() : disable());
      const verified = await readNativeState();
      if (requested !== undefined && verified !== requested) throw new Error("Autostart state did not change.");
      if (commit) {
        committing = true;
        return await commit(verified);
      }
      await database.settings.put({ key: "launchAtStartup", value: String(verified) });
    } catch (error) {
      const failures: unknown[] = [error];
      // A failed restore transaction must also restore the previous native state.
      if (committing) {
        try {
          if ((await readNativeState()) !== previous) await (previous ? enable() : disable());
        } catch (failure) {
          failures.push(failure);
        }
      }
      try {
        // A backup owns its Settings writes in one transaction. Failure must not
        // insert a new preference outside that rolled-back transaction.
        if (commit) await readNativeState();
        else await persist();
      } catch (failure) {
        failures.push(failure);
      }
      throw new AggregateError(failures, "Unable to synchronize launch at startup.");
    }
  };
  const result = pending.then(operation);
  pending = result.catch(() => undefined);
  return result;
}
