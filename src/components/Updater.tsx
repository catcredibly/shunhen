import { openExternalUrl } from "../externalLinks";
import { Row, Toggle } from "./SettingsControls";
import { useSettings } from "../hooks/useSettings";
import { meaningfulReleaseNotes } from "../releaseNotes";
import { ReleaseNotes } from "./ReleaseNotes";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { localeCode } from "../i18n";
import { updater, type UpdateState } from "../updater";
import { updatePreview } from "../updatePreview";

const useUpdater = () => useSyncExternalStore(updater.subscribe, updater.getSnapshot);
const busy = (state: UpdateState) => ["checking", "downloading", "installing", "restarting"].includes(state.phase);
function statusKey(state: UpdateState) {
  if (state.error === "check" && state.checkCategory === "manifest-missing")
    return "Update information is not available yet.";
  if (state.error === "install") return "Unable to install the update. Try again later.";
  if (state.error === "restart") return "Update installed. Restart Shunhen to finish.";
  return {
    checking: "Checking for updates…",
    current: "You're up to date.",
    available: "Update available",
    downloading: "Downloading update…",
    installing: "Installing update…",
    restarting: "Restarting…",
    error: "Unable to check for updates. Try again later.",
    idle: "",
  }[state.phase];
}

export function UpdateControls() {
  const { settings, setSetting } = useSettings();
  const { t } = useTranslation();
  const state = useUpdater();
  return (
    <section className="update-controls">
      <h3>{t("Updates")}</h3>
      <Row label={t("Check for updates")} hint={t("Check manually for a newer version of Shunhen.")}>
        <button className="secondary-action" disabled={busy(state)} onClick={() => void updater.check(true)}>
          {t(state.phase === "checking" ? "Checking for updates…" : "Check for updates")}
        </button>
      </Row>
      {statusKey(state) && <p role="status">{t(statusKey(state))}</p>}
      <Row label={t("Check for updates on launch")} hint={t("Automatically check for updates when Shunhen starts.")}>
        <Toggle
          label={t("Check for updates on launch")}
          checked={settings.checkForUpdatesOnLaunch}
          onChange={(value) => void setSetting("checkForUpdatesOnLaunch", value)}
        />
      </Row>
    </section>
  );
}

export function UpdatePrompt({ ready = true }: { ready?: boolean }) {
  const realState = useUpdater();
  const preview = useSyncExternalStore(updatePreview.subscribe, updatePreview.getSnapshot);
  const state = preview ?? realState;
  const actions = preview ? updatePreview : updater;
  useEffect(() => {
    if (!ready) return;
    let secondFrame = 0,
      backgroundTask = 0;
    // Let the normal, restored UI paint before starting any updater IPC/network work.
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        backgroundTask = window.setTimeout(() => updater.start(), 0);
      });
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
      window.clearTimeout(backgroundTask);
    };
  }, [ready]);
  return (
    <UpdateDialog
      key={preview ? "preview" : "production"}
      state={state}
      dismiss={preview ? updatePreview.close : updater.later}
      install={actions.install}
      dontShowAgain={preview ? updatePreview.dontShowAgain : updater.dontShowAgain}
    />
  );
}

/** Production and development preview share this complete presentation path. */
function UpdateDialog({
  state,
  dismiss,
  install,
  dontShowAgain,
}: {
  state: UpdateState;
  dismiss: () => void;
  install: () => Promise<void>;
  dontShowAgain: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [preferenceError, setPreferenceError] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (state.promptOpen && !dialog.current?.open) dialog.current?.showModal();
    if (!state.promptOpen && dialog.current?.open) dialog.current?.close();
  }, [state.promptOpen]);
  const notes = meaningfulReleaseNotes(state.notes);
  const progress = state.contentLength ? Math.min(1, state.downloaded / state.contentLength) : undefined;
  return (
    <dialog
      ref={dialog}
      className="modal update-dialog"
      aria-labelledby="update-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy(state)) dismiss();
      }}
    >
      <h2 id="update-title">{t("Update available")}</h2>
      <dl className="update-versions">
        <div>
          <dt>{t("Current version")}</dt>
          <dd>{state.currentVersion}</dd>
        </div>
        <div>
          <dt>{t("Available version")}</dt>
          <dd>{state.availableVersion}</dd>
        </div>
      </dl>
      {notes ? (
        <section className="update-notes" tabIndex={0} aria-label={t("What's new")}>
          <h3>{t("What's new")}</h3>
          <ReleaseNotes notes={notes} />
        </section>
      ) : (
        <p>{t("A new version of Shunhen is ready to install.")}</p>
      )}
      {state.availableVersion && (
        <a
          className="update-release-link"
          href={`https://github.com/catcredibly/shunhen/releases/tag/v${encodeURIComponent(state.availableVersion.replace(/^v/, ""))}`}
          onClick={(event) => {
            event.preventDefault();
            void openExternalUrl(event.currentTarget.href).catch(console.error);
          }}
        >
          {t("View release notes on GitHub")}
        </a>
      )}
      <p role="status">{state.phase === "available" ? "" : t(statusKey(state))}</p>
      {state.phase === "downloading" && (
        <>
          <progress aria-label={t("Downloading update…")} max={1} value={progress} />
          <small>
            {progress === undefined
              ? new Intl.NumberFormat(localeCode(), {
                  style: "unit",
                  unit: "megabyte",
                  maximumFractionDigits: 1,
                }).format(state.downloaded / 1_000_000)
              : progress.toLocaleString(localeCode(), { style: "percent", maximumFractionDigits: 0 })}
          </small>
        </>
      )}
      {preferenceError && (
        <p role="alert" className="field-error">
          {t("Unable to save update preference. Try again.")}
        </p>
      )}
      <div className="modal-actions">
        {state.automaticPrompt && (
          <button
            disabled={busy(state)}
            onClick={() => {
              setPreferenceError(false);
              void dontShowAgain().catch(() => setPreferenceError(true));
            }}
          >
            {t("Don't show again")}
          </button>
        )}
        <button disabled={busy(state)} onClick={dismiss}>
          {t("Later")}
        </button>
        <button
          className="primary-action"
          disabled={busy(state)}
          onClick={() => {
            void install();
          }}
        >
          {t(state.error === "restart" ? "Restart Shunhen" : "Update now")}
        </button>
      </div>
    </dialog>
  );
}
