import { synchronizeStartup } from "./autostart";
import { db } from "./db";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { isEnabled } from "@tauri-apps/plugin-autostart";
import { DEFAULT_SETTINGS, loadSettings, saveSetting, resetAllSettings, type FocusSettings } from "./settings";
import { syncPopoutLayout, reconcileAutoHideSetting, hideTimerAutomatically, timerGeometry } from "./native";
import { registerRevealShortcut } from "./shortcuts";

/** Register first, then commit preferences; roll native changes back on failure. */
export async function resetPreferences() {
  if (!isTauri()) return resetAllSettings();
  const applyDefaults = async () => {
    const wasEnabled = await isEnabled();
    const previous = await loadSettings();
    const geometry = await timerGeometry();
    // Windows auto-launch deletes a registry value; deleting an absent value fails.
    await synchronizeStartup(db, DEFAULT_SETTINGS.launchAtStartup);
    let persisted = false;
    try {
      await resetAllSettings();
      persisted = true;
      await syncPopoutLayout(true);
      await reconcileAutoHideSetting();
    } catch (error) {
      const rollbackErrors: unknown[] = [];
      const rollback = async (operation: () => Promise<unknown>) => {
        try {
          await operation();
        } catch (failure) {
          rollbackErrors.push(failure);
        }
      };
      if (persisted) {
        await rollback(async () => {
          await db.transaction("rw", async (db) => {
            for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof FocusSettings)[]) {
              if (key !== "lastBackupAt") await saveSetting(key, previous[key], db);
            }
          });
        });
        await rollback(() => syncPopoutLayout(true));
        if (geometry.tabVisible && previous.popoutDockAutoHide) await rollback(hideTimerAutomatically);
      }
      await rollback(() => synchronizeStartup(db, wasEnabled));
      if (rollbackErrors.length)
        throw new AggregateError(
          [error, ...rollbackErrors],
          "Unable to restore all native settings after reset failure.",
        );
      throw error;
    }
  };
  if (await invoke<boolean>("reveal_shortcut_available"))
    await registerRevealShortcut(DEFAULT_SETTINGS.popoutRevealShortcut, applyDefaults);
  else await applyDefaults(); // Preserve the configured default on backends without global shortcuts.
}
