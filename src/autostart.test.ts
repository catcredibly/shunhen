import { createTestDatabase } from "./storage/testDatabase";
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FocusDatabase } from "./db";
import { startupState, synchronizeStartup } from "./autostart";
import { restoreBackup, BACKUP_FORMAT, BACKUP_VERSION } from "./importExport/backup";
import type { FocusBackup } from "./importExport/types";

const native = vi.hoisted(() => ({ enabled: false, enable: vi.fn(), disable: vi.fn(), read: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/plugin-autostart", () => ({
  enable: native.enable,
  disable: native.disable,
  isEnabled: native.read,
}));
let database: FocusDatabase;
beforeEach(() => {
  database = createTestDatabase(`autostart-${crypto.randomUUID()}`).database;
  native.enabled = false;
  native.enable.mockReset().mockImplementation(async () => {
    native.enabled = true;
  });
  native.disable.mockReset().mockImplementation(async () => {
    native.enabled = false;
  });
  native.read.mockReset().mockImplementation(async () => native.enabled);
});
afterEach(() => database.delete());
const stored = async () => (await database.settings.get("launchAtStartup"))?.value;
const backup = (value?: boolean): FocusBackup => ({
  format: BACKUP_FORMAT,
  formatVersion: BACKUP_VERSION,
  exportedAt: new Date().toISOString(),
  appVersion: "2.4.0",
  data: {
    academicYears: [],
    subjects: [],
    sessions: [],
    settings: value === undefined ? [] : [{ key: "launchAtStartup", value: String(value) }],
  },
});
describe("native startup synchronization", () => {
  it.each([true, false])(
    "reconciles stale preferences with native %s without changing registration",
    async (enabled) => {
      native.enabled = enabled;
      await database.settings.put({ key: "launchAtStartup", value: String(!enabled) });
      await synchronizeStartup(database);
      expect(await stored()).toBe(String(enabled));
      expect(native.enable).not.toHaveBeenCalled();
      expect(native.disable).not.toHaveBeenCalled();
    },
  );
  it("keeps fresh installs disabled", async () => {
    await synchronizeStartup(database);
    expect(await stored()).toBe("false");
    expect(native.enable).not.toHaveBeenCalled();
  });
  it("persists verified enable and disable results", async () => {
    await synchronizeStartup(database, true);
    expect(await stored()).toBe("true");
    await synchronizeStartup(database, false);
    expect(await stored()).toBe("false");
  });
  it("rejects a successful call that did not change native state", async () => {
    native.enable.mockResolvedValue(undefined);
    await expect(synchronizeStartup(database, true)).rejects.toThrow();
    expect(await stored()).toBe("false");
  });
  it("reconciles an operation that changes state and then throws", async () => {
    native.enable.mockImplementation(async () => {
      native.enabled = true;
      throw new Error("failed");
    });
    await expect(synchronizeStartup(database, true)).rejects.toThrow();
    expect(await stored()).toBe("true");
  });
  it("exposes observed native state even if persistence fails", async () => {
    vi.spyOn(database.settings, "put").mockRejectedValue(new Error("storage unavailable"));
    await expect(synchronizeStartup(database, true)).rejects.toThrow();
    expect(startupState.snapshot()).toBe(true);
    expect(native.enabled).toBe(true);
  });
  it("does not overwrite stored state when native reads fail", async () => {
    await database.settings.put({ key: "launchAtStartup", value: "true" });
    native.read.mockRejectedValue(new Error("unavailable"));
    await expect(synchronizeStartup(database)).rejects.toThrow();
    expect(await stored()).toBe("true");
  });
});
describe("backup startup restore", () => {
  it.each([true, false])("applies native state when replacing with %s", async (enabled) => {
    native.enabled = !enabled;
    await restoreBackup(backup(enabled), "replace", "use-imported", database);
    expect(native.enabled).toBe(enabled);
    expect(await stored()).toBe(String(enabled));
  });
  it("keeps native state for keep-existing conflicts", async () => {
    await database.settings.put({ key: "launchAtStartup", value: "false" });
    await restoreBackup(backup(true), "merge", "keep-existing", database);
    expect(native.enable).not.toHaveBeenCalled();
    expect(await stored()).toBe("false");
  });
  it("preserves native state when a replace backup omits the preference", async () => {
    native.enabled = true;
    await restoreBackup(backup(), "replace", "use-imported", database);
    expect(await stored()).toBe("true");
  });
  it("aborts restore and persists actual state when native mutation fails", async () => {
    await database.settings.put({ key: "theme", value: "light" });
    native.enable.mockRejectedValue(new Error("denied"));
    await expect(restoreBackup(backup(true), "replace", "use-imported", database)).rejects.toThrow();
    expect(await stored()).toBe("false");
    expect((await database.settings.get("theme"))?.value).toBe("light");
  });
  it("rolls native state back after a failed restore transaction", async () => {
    vi.spyOn(database, "transaction").mockRejectedValueOnce(new Error("database failure"));
    await expect(restoreBackup(backup(true), "replace", "use-imported", database)).rejects.toThrow();
    expect(native.enabled).toBe(false);
    expect(await stored()).toBe("false");
  });
  it("persists actual state and reports failure if rollback also fails", async () => {
    vi.spyOn(database, "transaction").mockRejectedValueOnce(new Error("database failure"));
    native.disable.mockRejectedValue(new Error("rollback failure"));
    await expect(restoreBackup(backup(true), "replace", "use-imported", database)).rejects.toThrow();
    expect(native.enabled).toBe(true);
    expect(await stored()).toBe("true");
  });
});
