import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { db } from "./db";
import { createTestDatabase } from "./storage/testDatabase";
import { DEFAULT_SETTINGS, loadSettings, saveSetting } from "./settings";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  enabled: vi.fn(),
  disable: vi.fn(),
  enable: vi.fn(),
  sync: vi.fn(),
  reconcile: vi.fn(),
  geometry: vi.fn(),
  hide: vi.fn(),
  registerReveal: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: mocks.invoke,
}));

vi.mock("@tauri-apps/plugin-autostart", () => ({
  isEnabled: mocks.enabled,
  disable: mocks.disable,
  enable: mocks.enable,
}));

vi.mock("./native", () => ({
  syncPopoutLayout: mocks.sync,
  reconcileAutoHideSetting: mocks.reconcile,
  timerGeometry: mocks.geometry,
  hideTimerAutomatically: mocks.hide,
}));

vi.mock("./shortcuts", () => ({
  registerRevealShortcut: mocks.registerReveal,
}));

import { resetPreferences } from "./resetPreferences";

const storage = createTestDatabase();
beforeEach(async () => {
  vi.spyOn(db.connection, "request").mockImplementation(storage.request);
  await db.settings.clear();

  for (const mock of Object.values(mocks)) {
    mock.mockReset().mockResolvedValue(undefined);
  }

  mocks.invoke.mockResolvedValue(true);
  mocks.enabled.mockResolvedValue(false);
  mocks.disable.mockImplementation(async () => {
    mocks.enabled.mockResolvedValue(false);
  });
  mocks.enable.mockImplementation(async () => {
    mocks.enabled.mockResolvedValue(true);
  });
  mocks.geometry.mockResolvedValue({ tabVisible: false });

  mocks.registerReveal.mockImplementation(async (_shortcut: string, applyDefaults: () => Promise<void>) => {
    await applyDefaults();
  });

  await saveSetting("popoutRevealShortcut", "Ctrl+KeyF");
  await saveSetting("accentColour", "miku");
  await saveSetting("lastBackupAt", "2026-09-26");
});

it("resets successfully when autostart was never enabled (absent Windows registry value)", async () => {
  mocks.disable.mockRejectedValue(new Error("registry value not found"));

  await resetPreferences();

  expect(mocks.disable).not.toHaveBeenCalled();
  expect(await loadSettings()).toEqual({
    ...DEFAULT_SETTINGS,
    lastBackupAt: "2026-09-26",
  });
  expect(mocks.sync).toHaveBeenCalledWith(true);
  expect(mocks.reconcile).toHaveBeenCalled();
});

it("disables enabled autostart and registers the canonical shortcut", async () => {
  mocks.enabled.mockResolvedValue(true);

  await resetPreferences();

  expect(mocks.registerReveal).toHaveBeenCalledWith(DEFAULT_SETTINGS.popoutRevealShortcut, expect.any(Function));
  expect(mocks.disable).toHaveBeenCalledTimes(1);
});

it("preserves preferences if replacement shortcut registration fails", async () => {
  mocks.registerReveal.mockRejectedValue(new Error("conflict"));

  await expect(resetPreferences()).rejects.toThrow("conflict");

  expect((await loadSettings()).accentColour).toBe("miku");
  expect(mocks.disable).not.toHaveBeenCalled();
});

it("rolls preferences and autostart back when native synchronization fails", async () => {
  mocks.enabled.mockResolvedValue(true);
  mocks.sync.mockRejectedValueOnce(new Error("window"));

  await expect(resetPreferences()).rejects.toThrow("window");

  expect((await loadSettings()).accentColour).toBe("miku");
  expect(mocks.enable).toHaveBeenCalled();
});

it("can reset on a backend without global shortcuts without claiming a native binding", async () => {
  mocks.invoke.mockResolvedValue(false);

  await resetPreferences();

  expect((await loadSettings()).popoutRevealShortcut).toBe(DEFAULT_SETTINGS.popoutRevealShortcut);
  expect(mocks.registerReveal).not.toHaveBeenCalled();
});

afterAll(() => {
  vi.restoreAllMocks();
  storage.sqlite.close();
});
