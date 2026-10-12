import { closeAfterCheckpoint } from "./timerRecovery";
import { AnalyticsLoading } from "./components/PageSkeletons";
import { TimerProvider } from "./hooks/TimerContext";
import { cancelShortcutRevealTimer, reconcileAutoHideSetting, revealTimerFromShortcut } from "./native";
import { registerRevealShortcut } from "./shortcuts";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Sidebar } from "./components/Sidebar";
import { TimerPage } from "./components/TimerPage";
import { PopoutTimer } from "./components/PopoutTimer";
import { PopoutMenu } from "./components/PopoutMenu";
import { AutoHideTab } from "./components/AutoHideTab";
import { AcademicYearsPage, HistoryPage, SubjectsPage } from "./components/ManagementPages";
import { ImportExportPage } from "./components/ImportExportPage";
import { SettingsPage } from "./components/SettingsPage";
import { UpdatePrompt } from "./components/Updater";
import { ToastHost } from "./components/ToastHost";
import { useSettings } from "./hooks/useSettings";
import i18n from "./i18n";
import { useTranslation } from "react-i18next";
import { hasActiveTimer } from "./settings";
import { usePopoutLifecycle } from "./hooks/usePopoutLifecycle";
import { useSidebarLayout } from "./hooks/useSidebarLayout";

const closeMainWindow = () => closeAfterCheckpoint(() => invoke("close_main_window")).catch(console.error);

const AnalyticsPage = lazy(() =>
  import("./components/AnalyticsPage").then((module) => ({ default: module.AnalyticsPage })),
);

export default function App() {
  const { hidden: sidebarHidden, collapsed, toggle: toggleSidebar } = useSidebarLayout();
  const [invalidHistory, setInvalidHistory] = useState(false);
  const [page, setPage] = useState(() =>
    import.meta.env.DEV && new URLSearchParams(window.location.search).get("analyticsDemo") === "1"
      ? "Analytics"
      : "Timer",
  );
  useEffect(() => {
    if (page !== "History") setInvalidHistory(false);
  }, [page]);
  const isPopoutMenu = window.location.hash.includes("popout-menu");
  const isAutoHideTab = window.location.hash.includes("auto-hide-tab");
  const isPopout = window.location.hash.includes("popout") || isAutoHideTab;
  usePopoutLifecycle(!isPopout);
  const { settings, loaded } = useSettings();
  const { t } = useTranslation();
  const [closeWarning, setCloseWarning] = useState(false);
  const [secondInstanceWarning, setSecondInstanceWarning] = useState(false);
  const initialWindowStateApplied = useRef(false);

  useEffect(() => {
    if (!isTauri() || isPopout) return;
    // Analytics needs room for five metrics and its fixed weekday/time grid.
    void invoke("set_main_minimum_width", { width: ["Analytics", "History"].includes(page) ? 1040 : 420 }).catch(
      console.error,
    );
  }, [page, isPopout]);

  useEffect(() => {
    if (isTauri() && !isPopout && loaded)
      void registerRevealShortcut(settings.popoutShortcutEnabled ? settings.popoutRevealShortcut : "").catch(
        () => undefined,
      );
  }, [isPopout, loaded, settings.popoutRevealShortcut, settings.popoutShortcutEnabled]);

  useEffect(() => {
    if (!isPopout && loaded) void reconcileAutoHideSetting().catch(console.error);
  }, [isPopout, loaded, settings.popoutDockAutoHide, settings.popoutShortcutEnabled]);
  useEffect(() => {
    if (!isTauri() || isPopout) return;
    const cancellation = listen<number>("focus://cancel-shortcut-reveal", ({ payload }) =>
      cancelShortcutRevealTimer(payload),
    );
    const subscription = listen("focus://reveal-shortcut", () => {
      void revealTimerFromShortcut().catch(console.error);
    });
    return () => {
      cancelShortcutRevealTimer();
      void cancellation.then((stop) => stop());
      void subscription.then((stop) => stop());
    };
  }, [isPopout]);

  useEffect(() => {
    void i18n.changeLanguage(settings.language);
  }, [settings.language]);
  useEffect(() => {
    document.documentElement.dataset.scale = settings.uiScale;
  }, [settings.uiScale]);

  useEffect(() => {
    if (!loaded) return;
    document.documentElement.dataset.theme = settings.theme;
    try {
      localStorage.setItem("focus.theme", settings.theme);
    } catch {
      /* The database remains authoritative. */
    }
  }, [loaded, settings.theme]);

  useEffect(() => {
    if (!isTauri() || isPopout || !loaded || initialWindowStateApplied.current) return;
    initialWindowStateApplied.current = true;
    const window = getCurrentWindow();
    void (settings.startMaximized ? window.maximize() : window.unmaximize()).catch(() => undefined);
  }, [isPopout, loaded, settings.startMaximized]);

  useEffect(() => {
    if (!isTauri() || isPopout) return;
    let stopClose: (() => void) | undefined;
    let stopSecond: (() => void) | undefined;
    void getCurrentWindow()
      .onCloseRequested((event) => {
        event.preventDefault();
        if (hasActiveTimer()) setCloseWarning(true);
        else void closeMainWindow();
      })
      .then((stop) => {
        stopClose = stop;
      });
    void listen("focus://second-instance", () => setSecondInstanceWarning(true)).then((stop) => {
      stopSecond = stop;
    });
    return () => {
      stopClose?.();
      stopSecond?.();
    };
  }, [isPopout]);

  if (isPopoutMenu) return <PopoutMenu />;
  if (isAutoHideTab) return <AutoHideTab />;
  if (isPopout) return <PopoutTimer />;

  return (
    <TimerProvider>
      <div
        className={`app-shell ${collapsed ? "app-shell--collapsed" : ""} ${sidebarHidden ? "app-shell--no-sidebar" : ""}`}
        data-accent={settings.accentColour}
        data-theme={settings.theme}
        data-scale={settings.uiScale}
      >
        {!sidebarHidden && (
          <Sidebar collapsed={collapsed} onToggle={toggleSidebar} active={page} onNavigate={setPage} />
        )}
        <UpdatePrompt ready={loaded} />
        <ToastHost />
        {page === "Timer" && <TimerPage onNavigate={setPage} />}
        {page === "Analytics" && (
          <Suspense fallback={<AnalyticsLoading />}>
            <AnalyticsPage />
          </Suspense>
        )}
        {page === "Academic Years" && <AcademicYearsPage />}
        {page === "Subjects" && <SubjectsPage />}
        {page === "History" && <HistoryPage initialInvalid={invalidHistory} />}
        {page === "Import / Export" && (
          <ImportExportPage
            onNavigate={(next) => {
              setInvalidHistory(false);
              setPage(next);
            }}
            onViewInvalid={() => {
              setInvalidHistory(true);
              setPage("History");
            }}
          />
        )}
        {page === "Settings" && <SettingsPage onNavigate={setPage} />}
        {!["Timer", "Analytics", "Academic Years", "Subjects", "History", "Import / Export", "Settings"].includes(
          page,
        ) && (
          <main className="page">
            <div className="empty-state">
              <h1>{t(page)}</h1>
              <p>{t("Coming in a later milestone.")}</p>
            </div>
          </main>
        )}
        {closeWarning && (
          <div className="modal-backdrop">
            <section className="modal" role="dialog" aria-modal="true">
              <h2>{t("Close Shunhen while a timer is active?")}</h2>
              <p>
                {t(
                  "The timer will be recovered the next time Shunhen opens. No Session will be finalized by closing the app.",
                )}
              </p>
              <div className="modal-actions">
                <button onClick={() => setCloseWarning(false)}>{t("Cancel")}</button>
                <button className="danger-action" onClick={() => void closeMainWindow()}>
                  {t("Close Shunhen")}
                </button>
              </div>
            </section>
          </div>
        )}
        {secondInstanceWarning && (
          <div className="modal-backdrop">
            <section className="modal" role="alertdialog" aria-modal="true">
              <h2>{t("Shunhen is already running")}</h2>
              <p>{t("The existing Shunhen window has been brought to the front.")}</p>
              <div className="modal-actions">
                <button className="primary-action" onClick={() => setSecondInstanceWarning(false)}>
                  {t("OK")}
                </button>
              </div>
            </section>
          </div>
        )}
      </div>
    </TimerProvider>
  );
}
