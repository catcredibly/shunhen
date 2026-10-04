import { invoke, isTauri } from "@tauri-apps/api/core";
import { activePopoutSession, synchronizePopoutSession } from "./popoutLifecycle";
import { db } from "./db";
import { loadSettings, saveSetting, type DockCorner, type DockEdge, type FocusSettings } from "./settings";
import {
  cornerPosition,
  defaultEdgeForCorner,
  dockEdgeOffset,
  edgeOffset,
  nearestEdge,
  type WorkArea,
} from "./popoutPlacement";

export type TimerGeometry = {
  positioningSupported?: boolean;
  shortcutActive?: boolean;
  revealSequence?: number;
  menuVisible?: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  visible: boolean;
  tabVisible: boolean;
  requested: boolean;
  generation: number;
  workArea: WorkArea;
};
export const timerGeometry = (monitorId = "current") => invoke<TimerGeometry>("get_timer_geometry", { monitorId });
let lastFloatingEdge: DockEdge | undefined;
export function resetPopoutTransientState() {
  lastFloatingEdge = undefined;
}

// Serialize native + persistence transitions across webviews. Read fresh settings
// inside the lock so stale React effects cannot undo an explicit Dock command.
export function withPopoutGeometry<T>(operation: () => Promise<T>): Promise<T> {
  return navigator.locks.request("focus.popout.geometry", operation);
}
async function persist(values: Partial<FocusSettings>) {
  await db.transaction("rw", async (db) => {
    for (const [key, value] of Object.entries(values)) await saveSetting(key as keyof FocusSettings, value, db);
  });
}
async function placeDocked(settings: FocusSettings) {
  const target = await timerGeometry(settings.popoutDockMonitor);
  if (target.positioningSupported === false) {
    await invoke("set_timer_size", { size: settings.popoutSize, layout: settings.popoutLayout });
    return;
  }
  // Enter the target display before sizing in its logical pixels.
  if (settings.popoutDockMonitor !== "current")
    await invoke("set_timer_position_unchecked", { x: target.workArea.x + 24, y: target.workArea.y + 24 });
  await invoke("set_timer_size", { size: settings.popoutSize, layout: settings.popoutLayout });
  const geometry = await timerGeometry(settings.popoutDockMonitor);
  const position = cornerPosition(geometry.workArea, geometry, settings.popoutDockCorner, 12 * geometry.scale);
  await invoke("set_timer_position", { x: Math.round(position.x), y: Math.round(position.y) });
}
export async function setPopoutDocked(docked: boolean, corner?: DockCorner) {
  return withPopoutGeometry(async () => {
    const settings = await loadSettings();
    const next = {
      ...settings,
      popoutDocked: docked,
      popoutDockingEnabled: docked,
      popoutDockCorner: corner ?? settings.popoutDockCorner,
    };
    next.popoutAutoHideEdge = defaultEdgeForCorner(next.popoutDockCorner, settings.popoutAutoHideEdge);
    if (next.popoutDockCorner !== settings.popoutDockCorner)
      next.popoutAutoHideOffset = dockEdgeOffset(next.popoutDockCorner, next.popoutAutoHideEdge);
    const changes: Partial<FocusSettings> = {
      popoutDocked: docked,
      popoutDockingEnabled: docked,
      popoutDockCorner: next.popoutDockCorner,
      ...(docked
        ? { popoutAutoHideEdge: next.popoutAutoHideEdge, popoutAutoHideOffset: next.popoutAutoHideOffset }
        : {}),
    };
    if (!isTauri()) {
      await persist(changes);
      return;
    }
    await synchronizePopoutSession();
    const previous = await timerGeometry();
    if (docked && previous.positioningSupported === false)
      throw new Error("Docking is unavailable on this display backend.");
    // Configuration never requests visibility. Closed windows are configured only
    // in storage, and hidden windows remain hidden throughout repositioning.
    if (!previous.requested) {
      await persist(changes);
      return;
    }
    const wasDocked = settings.popoutDockingEnabled && settings.popoutDocked;
    try {
      if (docked) await placeDocked(next);
      else if (wasDocked && settings.popoutPositionX !== null && settings.popoutPositionY !== null) {
        await invoke("restore_timer_bounds", {
          x: settings.popoutPositionX,
          y: settings.popoutPositionY,
          width: settings.popoutFloatingWidth ?? previous.width,
          height: settings.popoutFloatingHeight ?? previous.height,
        });
      }
      if (docked && !wasDocked)
        Object.assign(changes, {
          popoutPositionX: previous.x,
          popoutPositionY: previous.y,
          popoutFloatingWidth: previous.width,
          popoutFloatingHeight: previous.height,
        });
      await persist(changes);
      if (previous.tabVisible) await hide(next, await timerGeometry(), previous.generation);
    } catch (error) {
      await invoke("restore_timer_bounds", {
        x: previous.x,
        y: previous.y,
        width: previous.width,
        height: previous.height,
      }).catch(() => undefined);
      throw error;
    }
  });
}
export async function syncPopoutLayout(resize = false) {
  if (!isTauri()) return;
  return withPopoutGeometry(async () => {
    await synchronizePopoutSession();
    const settings = await loadSettings(),
      geometry = await timerGeometry();
    if (!geometry.requested) return;
    await invoke("set_timer_always_on_top", { enabled: settings.popoutAlwaysOnTop });
    await invoke("set_timer_taskbar", { visible: settings.popoutShowInTaskbar });
    if (settings.popoutDockingEnabled && settings.popoutDocked) await placeDocked(settings);
    else if (resize) await invoke("set_timer_size", { size: settings.popoutSize, layout: settings.popoutLayout });
    if (geometry.tabVisible) {
      if (settings.popoutDockAutoHide) await hide(settings, await timerGeometry(), geometry.generation);
      else await invoke("cancel_timer_auto_hide", { generation: geometry.generation });
    }
  });
}
export async function openTimerPopout(_settings?: FocusSettings, shortcut = false) {
  if (!isTauri()) return;
  const intendedSession = activePopoutSession();
  // Capture Close's generation before entering the geometry queue. An explicit
  // Close during placement invalidates this request, even while its timer runs.
  const ticket = invoke<number>("prepare_timer_popout", {
    sessionId: intendedSession?.sessionId ?? null,
    deadline: intendedSession?.deadline ?? null,
  });
  return withPopoutGeometry(async () => {
    const generation = await ticket;
    const session = await synchronizePopoutSession();
    if (!session || session.sessionId !== intendedSession?.sessionId) return;
    const settings = await loadSettings();
    await invoke("set_timer_always_on_top", { enabled: settings.popoutAlwaysOnTop });
    await invoke("set_timer_taskbar", { visible: settings.popoutShowInTaskbar });
    if (settings.popoutDockingEnabled && settings.popoutDocked) await placeDocked(settings);
    else {
      await invoke("set_timer_size", { size: settings.popoutSize, layout: settings.popoutLayout });
      if (settings.popoutRememberPosition && settings.popoutPositionX !== null && settings.popoutPositionY !== null)
        await invoke("set_timer_position", { x: settings.popoutPositionX, y: settings.popoutPositionY });
    }
    const latest = await synchronizePopoutSession();
    if (latest?.sessionId === session.sessionId)
      await invoke("open_timer_popout", {
        sessionId: session.sessionId,
        generation,
        ...(shortcut ? { shortcut: true } : {}),
      });
  });
}
async function hide(
  settings: FocusSettings,
  geometry: TimerGeometry,
  generation = geometry.generation,
  normal = false,
) {
  if (geometry.positioningSupported === false) return;
  if (
    (!settings.popoutDockAutoHide && !geometry.tabVisible) ||
    !geometry.requested ||
    (!geometry.visible && !geometry.tabVisible)
  )
    return;
  await invoke("show_timer_auto_hide_tab", {
    ...autoHidePlacement(settings, geometry),
    generation,
    ...(normal ? { requirePointerOutside: true, expectedSequence: geometry.revealSequence } : {}),
  });
}
function autoHidePlacement(settings: FocusSettings, geometry: TimerGeometry) {
  const docked = settings.popoutDockingEnabled && settings.popoutDocked;
  const edge = docked
    ? settings.popoutAutoHideEdge
    : nearestEdge(geometry, geometry.workArea, geometry, lastFloatingEdge, geometry.scale);
  if (!docked) lastFloatingEdge = edge;
  if (import.meta.env.DEV)
    console.debug("[popout geometry]", {
      bounds: { x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height },
      scale: geometry.scale,
      workArea: geometry.workArea,
      corner: docked ? settings.popoutDockCorner : null,
      edge,
    });
  const offset = docked ? settings.popoutAutoHideOffset : edgeOffset(geometry, geometry.workArea, geometry, edge);
  return { edge, offset, tabSize: settings.popoutAutoHideTabSize };
}

export async function hideTimerAutomatically(expected?: { generation: number; revealSequence?: number }) {
  if (!isTauri()) return;
  return withPopoutGeometry(async () => {
    // Re-read inside the queue: a timeout scheduled before Disable is obsolete.
    const settings = await loadSettings();
    if (!settings.popoutDockAutoHide) return;
    await synchronizePopoutSession();
    const geometry = await timerGeometry();
    if (
      expected &&
      (expected.generation !== geometry.generation || expected.revealSequence !== geometry.revealSequence)
    )
      return;
    if (!geometry.shortcutActive) await hide(settings, geometry, geometry.generation, true);
  });
}
export async function revealTimerAutomatically() {
  return withPopoutGeometry(async () => {
    await synchronizePopoutSession();
    const geometry = await timerGeometry();
    if (geometry.requested && geometry.tabVisible)
      await invoke("cancel_timer_auto_hide", { generation: geometry.generation });
  });
}
export async function refreshTimerAutoHideTab() {
  if (!isTauri()) return;
  return withPopoutGeometry(async () => {
    await synchronizePopoutSession();
    const geometry = await timerGeometry();
    if (geometry.requested && geometry.tabVisible) {
      const settings = await loadSettings();
      if (settings.popoutDockAutoHide) await hide(settings, geometry);
      else await invoke("cancel_timer_auto_hide", { generation: geometry.generation });
    }
  });
}
export async function toggleTimerAutoHide() {
  return withPopoutGeometry(async () => {
    const settings = await loadSettings(),
      geometry = await timerGeometry();
    if (
      geometry.positioningSupported === false ||
      !settings.popoutDockAutoHide ||
      !geometry.requested ||
      !activePopoutSession()
    )
      return;
    if (geometry.tabVisible) {
      await invoke("cancel_timer_auto_hide", { generation: geometry.generation });
      return "revealed" as const;
    }
    await hide(settings, geometry);
    return "hidden" as const;
  });
}
export async function rememberFloatingPosition() {
  return withPopoutGeometry(async () => {
    const settings = await loadSettings();
    if (settings.popoutDocked && settings.popoutDockingEnabled) return;
    const geometry = await timerGeometry();
    if (geometry.positioningSupported === false) return;
    await persist({
      popoutPositionX: geometry.x,
      popoutPositionY: geometry.y,
      popoutFloatingWidth: geometry.width,
      popoutFloatingHeight: geometry.height,
    });
  });
}

/** A settings change may reveal an already requested window, never open a closed one. */
export async function reconcileAutoHideSetting() {
  if (!isTauri()) return;
  return withPopoutGeometry(async () => {
    const settings = await loadSettings();
    await invoke("reconcile_popout_preferences", {
      autoHide: settings.popoutDockAutoHide,
      shortcutEnabled: settings.popoutShortcutEnabled,
    });
    if (settings.popoutDockAutoHide) return;
    await synchronizePopoutSession();
    const geometry = await timerGeometry();
    if (geometry.requested && geometry.tabVisible)
      await invoke("cancel_timer_auto_hide", { generation: geometry.generation });
  });
}

let shortcutTimer: ReturnType<typeof setTimeout> | undefined;
let shortcutOperation = Promise.resolve();
let shortcutSequence: number | undefined;
export function cancelShortcutRevealTimer(sequence?: number) {
  if (sequence !== undefined && shortcutSequence !== undefined && sequence < shortcutSequence) return;
  clearTimeout(shortcutTimer);
  shortcutTimer = undefined;
}

/** Native generation/ticket checks also protect against callbacks already in flight. */
export function revealTimerFromShortcut(): Promise<void> {
  const operation = shortcutOperation
    .catch(() => undefined)
    .then(async () => {
      cancelShortcutRevealTimer();
      if (!isTauri() || !activePopoutSession()) return;
      if (!(await loadSettings()).popoutShortcutEnabled) return;
      const action = await withPopoutGeometry(async () => {
        const settings = await loadSettings();
        if (!settings.popoutShortcutEnabled) return "hidden";
        await invoke("reconcile_popout_preferences", { autoHide: settings.popoutDockAutoHide, shortcutEnabled: true });
        await invoke("cancel_shortcut_reveal");
        await synchronizePopoutSession();
        const geometry = await timerGeometry();
        if (geometry.menuVisible) return "hidden";
        if (geometry.visible) {
          if (settings.popoutDockAutoHide && geometry.positioningSupported !== false) await hide(settings, geometry);
          else await invoke("hide_timer_popout");
          return "hidden";
        }
        if (!geometry.requested) return "open";
        await invoke("cancel_timer_auto_hide", { generation: geometry.generation, shortcut: true });
        return "revealed";
      });
      if (action === "hidden") return;
      if (action === "open") await openTimerPopout(undefined, true);
      const settings = await loadSettings();
      const ticket = await invoke<{ generation: number; sequence: number } | null>("arm_shortcut_reveal");
      if (ticket && settings.popoutShortcutEnabled) {
        shortcutSequence = ticket.sequence;
        let remaining = settings.popoutRevealTimeoutSeconds;
        if (remaining === 0) return;
        let previous = Date.now();
        const schedule = () => {
          shortcutTimer = setTimeout(
            () => {
              const now = Date.now();
              remaining -= Math.max(0, now - previous) / 1000;
              previous = now;
              if (remaining > 0) {
                schedule();
                return;
              }
              shortcutTimer = undefined;
              void withPopoutGeometry(async () => {
                const latest = await loadSettings();
                await invoke("reconcile_popout_preferences", {
                  autoHide: latest.popoutDockAutoHide,
                  shortcutEnabled: latest.popoutShortcutEnabled,
                });
                const geometry = await timerGeometry();
                await invoke("expire_shortcut_reveal", { ...ticket, ...autoHidePlacement(latest, geometry) });
              }).catch(console.error);
            },
            Math.min(remaining, 2147483) * 1000,
          );
        };
        schedule();
      }
    });
  shortcutOperation = operation;
  return operation;
}
