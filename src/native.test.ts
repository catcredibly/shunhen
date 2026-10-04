import "fake-indexeddb/auto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "./db";
import { createTestDatabase } from "./storage/testDatabase";
import { loadSettings, saveSetting } from "./settings";
import {
  setPopoutDocked,
  syncPopoutLayout,
  toggleTimerAutoHide,
  refreshTimerAutoHideTab,
  hideTimerAutomatically,
  rememberFloatingPosition,
  reconcileAutoHideSetting,
  revealTimerFromShortcut,
  cancelShortcutRevealTimer,
} from "./native";

const native = vi.hoisted(() => ({
  invoke: vi.fn(),
  geometry: {
    positioningSupported: true,
    x: 250,
    y: 300,
    width: 400,
    height: 200,
    scale: 1,
    visible: true,
    tabVisible: false,
    requested: true,
    generation: 0,
    workArea: { x: 0, y: 0, width: 1920, height: 1040 },
  },
  failPosition: false,
  ticket: null as { generation: number; sequence: number } | null,
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: native.invoke }));
const storage = createTestDatabase();
beforeEach(async () => {
  vi.spyOn(db.connection, "request").mockImplementation(storage.request);
  await db.settings.clear();
  native.failPosition = false;
  native.ticket = null;
  vi.stubGlobal("localStorage", {
    getItem: () =>
      JSON.stringify({ running: true, paused: false, sessionId: "live-session", targetEnd: Date.now() + 3600000 }),
  });
  Object.assign(native.geometry, {
    positioningSupported: true,
    x: 250,
    y: 300,
    width: 400,
    height: 200,
    visible: true,
    tabVisible: false,
    requested: true,
    workArea: { x: 0, y: 0, width: 1920, height: 1040 },
  });
  const lockTails = new Map<string, Promise<unknown>>();
  vi.stubGlobal("navigator", {
    locks: {
      request: (name: string, operation: () => Promise<unknown>) => {
        const result = (lockTails.get(name) ?? Promise.resolve()).catch(() => undefined).then(operation);
        lockTails.set(name, result);
        return result;
      },
    },
  });
  native.invoke.mockReset().mockImplementation(async (command: string, args: Record<string, unknown> = {}) => {
    if (command === "arm_shortcut_reveal") {
      if (native.ticket) vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      return native.ticket;
    }
    if (command === "hide_timer_popout" || command === "expire_shortcut_reveal")
      Object.assign(native.geometry, { visible: false, tabVisible: false, requested: false });
    if (command === "get_timer_geometry") return structuredClone(native.geometry);
    if (command === "set_timer_position" && native.failPosition) throw new Error("move failed");
    if (
      command === "set_timer_position" ||
      command === "set_timer_position_unchecked" ||
      command === "restore_timer_bounds"
    )
      Object.assign(native.geometry, args);
    if (command === "set_timer_size")
      Object.assign(
        native.geometry,
        args.layout === "compact" ? { width: 320, height: 78 } : { width: 380, height: 190 },
      );
    if (command === "show_timer_auto_hide_tab") Object.assign(native.geometry, { visible: false, tabVisible: true });
    if (command === "cancel_timer_auto_hide") Object.assign(native.geometry, { visible: true, tabVisible: false });
  });
});
describe("serialized native popout transitions", () => {
  it("geometry refresh cannot reopen a closed popout", async () => {
    Object.assign(native.geometry, { requested: false, visible: false, tabVisible: true });
    await refreshTimerAutoHideTab();
    expect(native.invoke.mock.calls.map(([command]) => command)).toEqual(["sync_popout_session", "get_timer_geometry"]);
  });
  it.each(["popoutAutoHideEdge", "popoutDockMonitor", "popoutAutoHideTabSize"] as const)(
    "keeps hidden state after changing %s",
    async (key) => {
      await saveSetting("popoutDockAutoHide", true);
      await saveSetting("popoutDockingEnabled", true);
      await saveSetting("popoutDocked", true);
      Object.assign(native.geometry, { visible: false, tabVisible: true });
      if (key === "popoutAutoHideEdge") await saveSetting(key, "top");
      if (key === "popoutDockMonitor") await saveSetting(key, "display:1");
      if (key === "popoutAutoHideTabSize") await saveSetting(key, "large");
      await syncPopoutLayout();
      expect(native.geometry).toMatchObject({ visible: false, tabVisible: true });
      expect(
        native.invoke.mock.calls.some(([command]) => ["open_timer_popout", "cancel_timer_auto_hide"].includes(command)),
      ).toBe(false);
      if (key === "popoutAutoHideEdge")
        expect(native.invoke).toHaveBeenCalledWith(
          "show_timer_auto_hide_tab",
          expect.objectContaining({ edge: "top" }),
        );
    },
  );
  it("preserves hidden state and edge axis through a corner change", async () => {
    await saveSetting("popoutDockAutoHide", true);
    await saveSetting("popoutAutoHideEdge", "top");
    Object.assign(native.geometry, { visible: false, tabVisible: true });
    await setPopoutDocked(true, "bottom-right");
    expect((await loadSettings()).popoutAutoHideEdge).toBe("bottom");
    expect(native.geometry).toMatchObject({ visible: false, tabVisible: true });
  });
  it("refreshes using the actual current monitor and its resized work area", async () => {
    await saveSetting("popoutDockAutoHide", true);
    Object.assign(native.geometry, {
      visible: false,
      tabVisible: true,
      x: -1500,
      y: -900,
      workArea: { x: -1600, y: -1000, width: 1600, height: 900 },
    });
    await refreshTimerAutoHideTab();
    expect(native.invoke).toHaveBeenCalledWith("get_timer_geometry", { monitorId: "current" });
    expect(native.invoke).toHaveBeenCalledWith(
      "show_timer_auto_hide_tab",
      expect.objectContaining({ edge: "left", generation: 0 }),
    );
  });
  it("resizes compact while preserving an auto-hidden window", async () => {
    await saveSetting("popoutLayout", "compact");
    await saveSetting("popoutDockAutoHide", true);
    Object.assign(native.geometry, { visible: false, tabVisible: true });
    await syncPopoutLayout(true);
    expect(native.geometry).toMatchObject({ width: 320, height: 78, visible: false, tabVisible: true });
    expect(native.invoke).toHaveBeenCalledWith("set_timer_size", { size: "medium", layout: "compact" });
  });
  it("does not reopen a closed popout when changing its layout", async () => {
    await saveSetting("popoutLayout", "compact");
    Object.assign(native.geometry, { requested: false, visible: false });
    await syncPopoutLayout(true);
    expect(native.invoke.mock.calls.map(([command]) => command)).toEqual(["sync_popout_session", "get_timer_geometry"]);
  });
  it("restores separate floating bounds after queued dock/undock and stale layout work", async () => {
    await Promise.all([setPopoutDocked(true), setPopoutDocked(false), syncPopoutLayout()]);
    expect(native.geometry).toMatchObject({ x: 250, y: 300, width: 400, height: 200 });
    expect((await loadSettings()).popoutDocked).toBe(false);
  });
  it("does not persist Dock when native placement fails", async () => {
    native.failPosition = true;
    await expect(setPopoutDocked(true)).rejects.toThrow("move failed");
    expect((await loadSettings()).popoutDocked).toBe(false);
    expect(native.geometry).toMatchObject({ x: 250, y: 300, width: 400, height: 200 });
  });
  it("toggles floating auto-hide without moving, resizing or docking the real window", async () => {
    await saveSetting("popoutDockAutoHide", true);
    await toggleTimerAutoHide();
    expect(native.geometry).toMatchObject({ visible: false, tabVisible: true });
    await toggleTimerAutoHide();
    expect(native.geometry).toMatchObject({
      x: 250,
      y: 300,
      width: 400,
      height: 200,
      visible: true,
      tabVisible: false,
      requested: true,
      workArea: { x: 0, y: 0, width: 1920, height: 1040 },
    });
    expect((await loadSettings()).popoutDocked).toBe(false);
    expect(native.invoke.mock.calls.some(([command]) => command === "set_timer_position")).toBe(false);
  });
});

it("ignores delayed hides after Auto-hide was disabled without querying native geometry", async () => {
  await saveSetting("popoutDockAutoHide", false);
  await hideTimerAutomatically();
  expect(native.invoke).not.toHaveBeenCalled();
});

describe("unsupported positioning capability (frontend policy only)", () => {
  it("preserves a remembered position rather than saving unavailable coordinates", async () => {
    await saveSetting("popoutPositionX", 123);
    native.geometry.positioningSupported = false;
    await rememberFloatingPosition();
    expect((await loadSettings()).popoutPositionX).toBe(123);
  });
  it("does not hide or persist a new dock request when placement is unavailable", async () => {
    native.geometry.positioningSupported = false;
    await saveSetting("popoutDockAutoHide", true);
    await hideTimerAutomatically();
    await expect(setPopoutDocked(true)).rejects.toThrow("Docking is unavailable");
    expect((await loadSettings()).popoutDocked).toBe(false);
    expect(native.invoke.mock.calls.some(([command]) => command === "show_timer_auto_hide_tab")).toBe(false);
  });
});

it("reveals a hidden requested popout immediately when Auto-hide is disabled", async () => {
  Object.assign(native.geometry, { visible: false, tabVisible: true });
  await saveSetting("popoutDockAutoHide", false);
  await reconcileAutoHideSetting();
  expect(native.geometry).toMatchObject({ visible: true, tabVisible: false });
  expect(
    native.invoke.mock.calls.some(([command]) =>
      ["set_timer_size", "set_timer_position", "open_timer_popout"].includes(command),
    ),
  ).toBe(false);
});
it("disabled Auto-hide reconciliation never opens an explicitly closed popout", async () => {
  Object.assign(native.geometry, { requested: false, visible: false, tabVisible: false });
  await reconcileAutoHideSetting();
  expect(native.invoke.mock.calls.some(([command]) => command === "cancel_timer_auto_hide")).toBe(false);
});
it.each([true, false])("shortcut toggles visibility regardless of Auto-hide=%s", async (enabled) => {
  await saveSetting("popoutDockAutoHide", enabled);
  Object.assign(native.geometry, { visible: false, tabVisible: true });
  await revealTimerFromShortcut();
  expect(native.geometry).toMatchObject({ visible: true, tabVisible: false });
  await revealTimerFromShortcut();
  expect(native.geometry).toMatchObject({ visible: false, tabVisible: enabled, requested: enabled });
  expect(native.invoke.mock.calls.filter(([command]) => command === "cancel_timer_auto_hide")).toHaveLength(1);
  expect(native.invoke.mock.calls.some(([command]) => command === "show_timer_auto_hide_tab")).toBe(enabled);
});

afterEach(() => {
  cancelShortcutRevealTimer();
  vi.useRealTimers();
});
it("uses the configured shortcut timeout and ignores older cancellation events", async () => {
  await saveSetting("popoutRevealTimeoutSeconds", 3);
  Object.assign(native.geometry, { visible: false, tabVisible: true });
  native.ticket = { generation: 0, sequence: 10 };
  await revealTimerFromShortcut();
  cancelShortcutRevealTimer(9);
  await vi.advanceTimersByTimeAsync(2999);
  expect(native.invoke.mock.calls.some(([command]) => command === "expire_shortcut_reveal")).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  await vi.waitFor(() =>
    expect(native.invoke).toHaveBeenCalledWith("expire_shortcut_reveal", expect.objectContaining(native.ticket!)),
  );
});
it("pointer cancellation removes the pending shortcut timeout", async () => {
  Object.assign(native.geometry, { visible: false, tabVisible: true });
  native.ticket = { generation: 0, sequence: 20 };
  await revealTimerFromShortcut();
  cancelShortcutRevealTimer(21);
  await vi.advanceTimersByTimeAsync(15000);
  expect(native.invoke.mock.calls.some(([command]) => command === "expire_shortcut_reveal")).toBe(false);
});

it("zero shortcut delay arms interaction protection without scheduling a timeout", async () => {
  await saveSetting("popoutRevealTimeoutSeconds", 0);
  Object.assign(native.geometry, { visible: false, tabVisible: true });
  native.ticket = { generation: 0, sequence: 30 };
  await revealTimerFromShortcut();
  expect(vi.getTimerCount()).toBe(0);
  expect(native.geometry.visible).toBe(true);
});
it("disabled shortcuts ignore queued key events and retain preferences", async () => {
  await saveSetting("popoutShortcutEnabled", false);
  await revealTimerFromShortcut();
  expect(native.invoke).not.toHaveBeenCalled();
  expect((await loadSettings()).popoutRevealShortcut).toBe("Ctrl+Alt+KeyF");
});

it("untouched shortcut state suppresses normal Auto-hide", async () => {
  await saveSetting("popoutDockAutoHide", true);
  Object.assign(native.geometry, { shortcutActive: true });
  await hideTimerAutomatically();
  expect(native.invoke.mock.calls.some(([command]) => command === "show_timer_auto_hide_tab")).toBe(false);
  Object.assign(native.geometry, { shortcutActive: false });
  await hideTimerAutomatically();
  expect(native.geometry).toMatchObject({ requested: true, visible: false, tabVisible: true });
});
it("shortcut timeout reconciles current Auto-hide preferences before native expiry", async () => {
  Object.assign(native.geometry, { visible: false, tabVisible: true });
  native.ticket = { generation: 0, sequence: 40 };
  await revealTimerFromShortcut();
  await saveSetting("popoutDockAutoHide", true);
  await vi.advanceTimersByTimeAsync(5000);
  await vi.waitFor(() =>
    expect(native.invoke).toHaveBeenCalledWith("expire_shortcut_reveal", expect.objectContaining(native.ticket!)),
  );
  expect(native.invoke).toHaveBeenCalledWith("reconcile_popout_preferences", { autoHide: true, shortcutEnabled: true });
});

it("normal Auto-hide ignores a timeout from an older reveal", async () => {
  await saveSetting("popoutDockAutoHide", true);
  await hideTimerAutomatically({ generation: 0, revealSequence: -1 });
  expect(native.invoke.mock.calls.some(([command]) => command === "show_timer_auto_hide_tab")).toBe(false);
});

afterAll(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  storage.sqlite.close();
});
