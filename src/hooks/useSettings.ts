import { initializeSettings } from "../settingsInitialization";
import { startupState, synchronizeStartup } from "../autostart";
import { db } from "../db";
import { useLiveQuery } from "./useLiveQuery";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { DEFAULT_SETTINGS, reconcileDefaultSubject, loadSettings, saveSetting, type FocusSettings } from "../settings";

// Match the early HTML paint while SQLite loads; this is only a theme hint,
// never a replacement for persisted settings or a reason to delay rendering.
const initialSettings: FocusSettings = {
  ...DEFAULT_SETTINGS,
  theme: typeof document !== "undefined" && document.documentElement.dataset.theme === "light" ? "light" : "dark",
};

export function useSettings() {
  const [migrated, setMigrated] = useState(false);
  // SQLite live queries are read-only; complete compatibility writes outside them.
  useEffect(() => {
    let active = true;
    void initializeSettings()
      .then(() => {
        if (active) setMigrated(true);
      })
      .catch(console.error);
    return () => {
      active = false;
    };
  }, []);
  const stored = useLiveQuery(async () => {
    if (!migrated) return;
    await db.subjects.toArray();
    await db.academicYears.toArray();
    return loadSettings(undefined, false);
  }, [migrated]);
  useEffect(() => {
    if (stored) void reconcileDefaultSubject().catch(console.error);
  }, [stored]);
  const nativeStartup = useSyncExternalStore(startupState.subscribe, startupState.snapshot);
  const settings =
    nativeStartup === undefined
      ? (stored ?? initialSettings)
      : { ...(stored ?? initialSettings), launchAtStartup: nativeStartup };
  const setSetting = useCallback(async <K extends keyof FocusSettings>(key: K, value: FocusSettings[K]) => {
    if (key === "launchAtStartup") await synchronizeStartup(db, value as boolean);
    else await saveSetting(key, value);
  }, []);
  return {
    settings,
    loaded: stored !== undefined,
    setSetting,
  };
}
