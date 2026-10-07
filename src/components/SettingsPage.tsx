import { OpacitySetting } from "./OpacitySetting";
import { Row, Toggle } from "./SettingsControls";
import { updatePreview } from "../updatePreview";
import { goalSubjectSelection, refineGoalSubjects } from "../goalScope";
import { LinkedScopeSelectors } from "./LinkedScopeSelectors";
import { selectableSubjects } from "../selectorOptions";
import { subjectOptions } from "../selectorOptions";
import { FilterSelect } from "./FilterSelect";
import { resetPreferences } from "../resetPreferences";
import { formatTimerDate, effectiveTimerDateFormat, timerDateFormats } from "../dateTime";
import { edgesForCorner, dockEdgeOffset } from "../popoutPlacement";
import { setPopoutDocked, reconcileAutoHideSetting } from "../native";
import { ShortcutRecorder } from "./ShortcutRecorder";
import {
  Bell,
  Clock3,
  Database,
  Download,
  Info,
  MonitorCog,
  Palette,
  Play,
  RotateCcw,
  Trash2,
  Volume2,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { isPermissionGranted, requestPermission } from "@tauri-apps/plugin-notification";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { exportFullBackup } from "../importExport/exportBackup";
import { useSettings } from "../hooks/useSettings";
import {
  saveSetting,
  clearAllFocusData,
  formatLastBackup,
  hasActiveTimer,
  normaliseDuration,
  goalDurationSeconds,
  normalizeGoalPart,
  GOAL_MAX_HOURS,
  DEFAULT_SIDEBAR_SUBTITLE,
  restoreSettingDefaults,
  type AccentColour,
  type FocusSettings,
} from "../settings";
import { previewCompletionSound, testCompletionNotification } from "../timerCompletion";
import { FocusLeaf } from "./FocusLeaf";
import { useLiveQuery } from "../hooks/useLiveQuery";
import { db } from "../db";
import packageMetadata from "../../package.json";
import { useTranslation } from "react-i18next";
import { UpdateControls } from "./Updater";

type Section = "General" | "Timer" | "Notifications & Sounds" | "Popout" | "Appearance" | "Data" | "About";
const sections: [Section, typeof MonitorCog][] = [
  ["General", MonitorCog],
  ["Timer", Clock3],
  ["Notifications & Sounds", Bell],
  ["Popout", Play],
  ["Appearance", Palette],
  ["Data", Database],
  ["About", Info],
];

export function SettingsPage({ onNavigate }: { onNavigate: (page: string) => void }) {
  const { t } = useTranslation();
  const [section, setSection] = useState<Section>("General");
  const { settings, setSetting } = useSettings();
  return (
    <main className="page settings-page">
      <header className="page-header">
        <div>
          <h1>{t("Settings")}</h1>
          <p>{t("Configure Shunhen for the way you study.")}</p>
        </div>
      </header>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label={t("Settings sections")}>
          {sections.map(([name, Icon]) => (
            <button key={name} className={section === name ? "active" : ""} onClick={() => setSection(name)}>
              <Icon />
              {t(name)}
            </button>
          ))}
        </nav>
        <section className="settings-content">
          {section === "General" && <General settings={settings} setSetting={setSetting} />}{" "}
          {section === "Timer" && <Timer settings={settings} setSetting={setSetting} />}{" "}
          {section === "Notifications & Sounds" && (
            <NotificationsAndSounds settings={settings} setSetting={setSetting} />
          )}{" "}
          {section === "Popout" && <Popout settings={settings} setSetting={setSetting} />}{" "}
          {section === "Appearance" && <Appearance settings={settings} setSetting={setSetting} />}{" "}
          {section === "Data" && <Data settings={settings} setSetting={setSetting} onNavigate={onNavigate} />}{" "}
          {section === "About" && <About />}
        </section>
      </div>
    </main>
  );
}

type SettingsProps = {
  settings: FocusSettings;
  setSetting: <K extends keyof FocusSettings>(key: K, value: FocusSettings[K]) => Promise<void>;
};

function SettingsHeader({ title, children }: { title: string; children: ReactNode }) {
  return (
    <header className="settings-section-header">
      <h2>{title}</h2>
      <p>{children}</p>
    </header>
  );
}
function RestoreSection({ keys }: { keys: (keyof FocusSettings)[] }) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <button className="settings-restore" onClick={() => setConfirming(true)}>
        <RotateCcw /> {t("Restore section defaults")}
      </button>
      {confirming && (
        <div className="modal-backdrop" onMouseDown={() => setConfirming(false)}>
          <section className="modal" onMouseDown={(event) => event.stopPropagation()}>
            <h2>{t("Restore section defaults?")}</h2>
            <p>{t("Only the settings in this section will be restored. Your study data will not be changed.")}</p>
            <div className="modal-actions">
              <button onClick={() => setConfirming(false)}>{t("Cancel")}</button>
              <button
                className="primary-action"
                onClick={async () => {
                  try {
                    await restoreSettingDefaults(keys);
                    setConfirming(false);
                  } catch (error) {
                    console.error(error);
                  }
                }}
              >
                {t("Restore defaults")}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function General({ settings, setSetting }: SettingsProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(settings.displayName);
  useEffect(() => setName(settings.displayName), [settings.displayName]);
  const [startupBusy, setStartupBusy] = useState(false);
  const startup = async (enabled: boolean) => {
    if (startupBusy) return;
    setStartupBusy(true);
    try {
      await setSetting("launchAtStartup", enabled);
    } catch (error) {
      console.error(error);
    } finally {
      setStartupBusy(false);
    }
  };
  return (
    <>
      <SettingsHeader title={t("General")}>{t("Basic app settings.")}</SettingsHeader>
      <Row label={t("Language")}>
        <select
          value={settings.language}
          onChange={(event) => void setSetting("language", event.target.value as FocusSettings["language"])}
        >
          <option value="en">English</option>
          <option value="zh-CN">简体中文</option>
          <option value="zh-TW">繁體中文</option>
          <option value="ja">日本語</option>
        </select>
      </Row>
      <Row label={t("Your name")} hint={t("Used in the sidebar greeting.")}>
        <input
          className="settings-input"
          value={name}
          maxLength={60}
          placeholder={t("Your name")}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => void setSetting("displayName", name.trim())}
        />
      </Row>
      <Row label={t("Greeting subtitle")} hint={t("Leave blank to use the default brand line.")}>
        <input
          className="settings-input"
          value={settings.sidebarSubtitle}
          maxLength={120}
          placeholder={DEFAULT_SIDEBAR_SUBTITLE}
          onChange={(event) => void setSetting("sidebarSubtitle", event.target.value)}
        />
      </Row>
      <Row label={t("Start Shunhen maximized")}>
        <Toggle
          label={t("Start Shunhen maximized")}
          checked={settings.startMaximized}
          onChange={(value) => void setSetting("startMaximized", value)}
        />
      </Row>
      <Row label={t("Launch Shunhen at Windows startup")} disabled={startupBusy}>
        <Toggle
          label={t("Launch Shunhen at Windows startup")}
          checked={settings.launchAtStartup}
          onChange={(value) => void startup(value)}
        />
      </Row>
      <RestoreSection keys={["displayName", "sidebarSubtitle", "language", "startMaximized", "launchAtStartup"]} />
      <ResetAllSettings />
    </>
  );
}

function ResetAllSettings() {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const dismiss = () => {
    if (!busy) setConfirming(false);
  };
  const reset = async () => {
    if (typed !== "RESET" || busy) return;
    setBusy(true);
    setError(false);
    try {
      await resetPreferences();
      setConfirming(false);
      setTyped("");
      setError(false);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="settings-subheading settings-group-heading">
        <strong>{t("Reset")}</strong>
      </div>
      <Row
        label={t("Reset all settings")}
        hint={t(
          "Restore every Shunhen preference to its default without deleting Sessions, Subjects, Academic Years, or study history.",
        )}
      >
        <button
          className="secondary-action"
          onClick={() => {
            setTyped("");
            setError(false);
            setConfirming(true);
          }}
        >
          <RotateCcw />
          {t("Reset all settings")}
        </button>
      </Row>
      {confirming && (
        <div
          className="modal-backdrop"
          onMouseDown={dismiss}
          onKeyDown={(event) => {
            if (event.key === "Escape") dismiss();
            if (event.key === "Enter" && typed === "RESET" && !busy) {
              event.preventDefault();
              void reset();
            }
          }}
        >
          <section
            className="modal typed-confirmation-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reset-settings-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2 id="reset-settings-title">{t("Reset all settings?")}</h2>
            <p>
              {t(
                "This will restore all Shunhen preferences to their defaults. Your Sessions, Subjects, Academic Years, and study history will not be deleted.",
              )}
            </p>
            <p>{t("Type RESET to continue.")}</p>
            <input
              autoFocus
              disabled={busy}
              aria-label={t("Type RESET to continue.")}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
            />
            {error && <p role="alert">{t("Unable to reset settings. Please try again.")}</p>}
            <div className="modal-actions">
              <button disabled={busy} onClick={dismiss}>
                {t("Cancel")}
              </button>
              <button className="secondary-action" disabled={busy || typed !== "RESET"} onClick={() => void reset()}>
                {t("Reset all settings")}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

function DurationEditor({ value, onChange }: { value: number; onChange: (seconds: number) => void }) {
  const { t } = useTranslation();
  const parts = { hours: Math.floor(value / 3600), minutes: Math.floor((value % 3600) / 60), seconds: value % 60 };
  const [draft, setDraft] = useState(parts);
  useEffect(() => setDraft(parts), [value]);
  const commit = () => {
    const next = normaliseDuration(draft.hours, draft.minutes, draft.seconds);
    setDraft(next);
    onChange(next.total);
  };
  return (
    <div className="duration-editor">
      <label>
        <input
          aria-label={t("Hours")}
          min="0"
          type="number"
          value={draft.hours}
          onChange={(event) => setDraft({ ...draft, hours: Number(event.target.value) })}
          onBlur={commit}
        />
        <span>{t("Hours")}</span>
      </label>
      <b>:</b>
      <label>
        <input
          aria-label={t("Minutes")}
          min="0"
          type="number"
          value={draft.minutes}
          onChange={(event) => setDraft({ ...draft, minutes: Number(event.target.value) })}
          onBlur={commit}
        />
        <span>{t("Minutes")}</span>
      </label>
      <b>:</b>
      <label>
        <input
          aria-label={t("Seconds")}
          min="0"
          type="number"
          value={draft.seconds}
          onChange={(event) => setDraft({ ...draft, seconds: Number(event.target.value) })}
          onBlur={commit}
        />
        <span>{t("Seconds")}</span>
      </label>
    </div>
  );
}

function GoalDurationEditor({
  value,
  onChange,
  maxHours,
}: {
  value: number;
  maxHours: number;
  onChange: (seconds: number) => void;
}) {
  const { t } = useTranslation();
  const format = (seconds: number) => ({
    hours: String(Math.floor(seconds / 3600)),
    minutes: String(Math.floor((seconds % 3600) / 60)),
  });
  const [draft, setDraft] = useState(() => format(value));
  useEffect(() => setDraft(format(value)), [value]);
  const commit = () => {
    const hours = Number(draft.hours),
      minutes = Number(draft.minutes);
    const total = goalDurationSeconds(hours, minutes, maxHours);
    setDraft(format(total));
    onChange(total);
  };
  return (
    <div className="goal-duration-editor">
      {(["hours", "minutes"] as const).map((part, index) => (
        <span className="goal-duration-part" key={part}>
          {index > 0 && <b aria-hidden="true">:</b>}
          <label>
            <input
              className="settings-value-input"
              type="text"
              inputMode="numeric"
              role="spinbutton"
              aria-label={t(part === "hours" ? "Hours" : "Minutes")}
              aria-valuemin={0}
              aria-valuemax={part === "minutes" ? 59 : maxHours}
              aria-valuenow={Number(draft[part])}
              value={draft[part]}
              onChange={(event) => setDraft({ ...draft, [part]: event.target.value.replace(/\D/g, "") })}
              onBlur={commit}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                  event.preventDefault();
                  const next = normalizeGoalPart(
                    part,
                    (Number(draft[part]) || 0) + (event.key === "ArrowUp" ? 1 : -1),
                    maxHours,
                  );
                  setDraft({ ...draft, [part]: String(next) });
                }
              }}
            />
            <small>{t(part === "hours" ? "Hours" : "Minutes")}</small>
          </label>
        </span>
      ))}
    </div>
  );
}

function AutoHideDelayEditor({
  value,
  onChange,
  minimum = 0,
  disabled = false,
  label = "Auto-hide delay in seconds",
}: {
  value: number;
  onChange: (seconds: number) => void;
  minimum?: number;
  disabled?: boolean;
  label?: string;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const parsed = Number(draft);
    const next = draft.trim() && Number.isFinite(parsed) ? Math.max(minimum, parsed) : value;
    setDraft(String(next));
    onChange(next);
  };
  return (
    <label className="seconds-editor">
      <input
        className="settings-value-input"
        aria-label={t(label)}
        type="number"
        disabled={disabled}
        min={minimum}
        step="0.1"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
      <span>{t("sec")}</span>
    </label>
  );
}

function Timer({ settings, setSetting }: SettingsProps) {
  const { t } = useTranslation();
  const years = useLiveQuery(() => db.academicYears.toArray(), []) ?? [];
  const subjects = useLiveQuery(() => db.subjects.toArray(), []) ?? [];
  return (
    <>
      <SettingsHeader title={t("Timer")}>{t("Behaviour during focus Sessions.")}</SettingsHeader>
      <div className="settings-subheading settings-group-heading">
        <strong>{t("General")}</strong>
      </div>
      <Row label={t("New timer duration")}>
        <select
          value={settings.timerDurationMode}
          onChange={(event) =>
            void setSetting("timerDurationMode", event.target.value as FocusSettings["timerDurationMode"])
          }
        >
          <option value="remember">{t("Remember last used")}</option>
          <option value="fixed">{t("Fixed default")}</option>
        </select>
      </Row>
      <Row label={t("Fixed default duration")} disabled={settings.timerDurationMode !== "fixed"}>
        <DurationEditor
          value={settings.fixedTimerDurationSeconds}
          onChange={(value) => void setSetting("fixedTimerDurationSeconds", value)}
        />
      </Row>
      <Row label={t("Default Subject behavior")}>
        <select
          value={settings.subjectPickerMode}
          onChange={(event) =>
            void setSetting("subjectPickerMode", event.target.value as FocusSettings["subjectPickerMode"])
          }
        >
          <option value="remember">{t("Remember last used")}</option>
          <option value="fixed">{t("Configured Subject")}</option>
        </select>
      </Row>
      <Row label={t("Default Subject")} disabled={settings.subjectPickerMode !== "fixed"}>
        <FilterSelect
          className="settings-default-subject"
          entity="subject"
          label={t("Default Subject")}
          disabled={settings.subjectPickerMode !== "fixed"}
          value={settings.defaultSubjectId}
          onChange={(value) => void setSetting("defaultSubjectId", value)}
          options={[{ value: "", label: t("Choose Subject") }, ...subjectOptions(years, subjects, [], true)]}
        />
      </Row>
      <div className="settings-subheading settings-group-heading">
        <strong>{t("Date and clock")}</strong>
      </div>
      <Row label={t("Show date")}>
        <Toggle
          label={t("Show date")}
          checked={settings.showDate}
          onChange={(value) => void setSetting("showDate", value)}
        />
      </Row>
      <Row label={t("Date format")} hint={formatTimerDate(new Date(), settings.language, settings.dateFormat, false)}>
        <select
          disabled={!settings.showDate}
          aria-label={t("Date format")}
          value={effectiveTimerDateFormat(settings.language, settings.dateFormat)}
          onChange={(event) => void setSetting("dateFormat", event.target.value as FocusSettings["dateFormat"])}
        >
          {timerDateFormats(settings.language).map((format) => (
            <option key={format} value={format}>
              {t({ full: "Full", standard: "Standard", compact: "Compact", numeric: "Numeric" }[format])}
            </option>
          ))}
        </select>
      </Row>
      <Row label={t("Show weekday")}>
        <Toggle
          label={t("Show weekday")}
          checked={settings.showWeekday}
          onChange={(value) => void setSetting("showWeekday", value)}
        />
      </Row>
      <Row label={t("Weekday style")} disabled={!settings.showWeekday}>
        <select
          aria-label={t("Weekday style")}
          value={settings.weekdayStyle}
          onChange={(event) => void setSetting("weekdayStyle", event.target.value as FocusSettings["weekdayStyle"])}
        >
          <option value="full">{t("Full")}</option>
          <option value="short">{t("Short")}</option>
        </select>
      </Row>
      <Row label={t("Show clock")}>
        <Toggle
          label={t("Show clock")}
          checked={settings.showClock}
          onChange={(value) => void setSetting("showClock", value)}
        />
      </Row>
      <Row label={t("Clock format")}>
        <select
          disabled={!settings.showClock}
          value={settings.clockFormat}
          onChange={(event) => void setSetting("clockFormat", event.target.value as FocusSettings["clockFormat"])}
        >
          <option value="system">{t("System format")}</option>
          <option value="12-hour">{t("12-hour")}</option>
          <option value="24-hour">{t("24-hour")}</option>
        </select>
      </Row>
      <div className="settings-subheading settings-group-heading">
        <strong>{t("Study goals")}</strong>
        <span>{t("Goals count finalized focus Sessions in your local day and week.")}</span>
      </div>
      <Row label={t("Daily goal")}>
        <Toggle
          label={t("Daily goal")}
          checked={settings.dailyGoalEnabled}
          onChange={(value) => void setSetting("dailyGoalEnabled", value)}
        />
      </Row>
      <Row label={t("Daily goal duration")} disabled={!settings.dailyGoalEnabled}>
        <GoalDurationEditor
          maxHours={GOAL_MAX_HOURS.dailyGoalSeconds}
          value={settings.dailyGoalSeconds}
          onChange={(value) => void setSetting("dailyGoalSeconds", value)}
        />
      </Row>
      <Row label={t("Weekly goal")}>
        <Toggle
          label={t("Weekly goal")}
          checked={settings.weeklyGoalEnabled}
          onChange={(value) => void setSetting("weeklyGoalEnabled", value)}
        />
      </Row>
      <Row label={t("Weekly goal duration")} disabled={!settings.weeklyGoalEnabled}>
        <GoalDurationEditor
          maxHours={GOAL_MAX_HOURS.weeklyGoalSeconds}
          value={settings.weeklyGoalSeconds}
          onChange={(value) => void setSetting("weeklyGoalSeconds", value)}
        />
      </Row>
      <div className="settings-subheading settings-group-heading">
        <strong>{t("Goal scope")}</strong>
        <span>{t("Choose which Academic Years and Subjects contribute to your goals.")}</span>
      </div>
      <LinkedScopeSelectors
        years={years.filter((year) => !year.archived)}
        subjects={selectableSubjects(years, subjects)}
        value={settings.goalScope}
        selectedSubjectIds={goalSubjectSelection(settings.goalScope, selectableSubjects(years, subjects))}
        onChange={(value, change) =>
          void setSetting(
            "goalScope",
            change === "subject"
              ? refineGoalSubjects(settings.goalScope, value, selectableSubjects(years, subjects))
              : value,
          )
        }
        requireNonEmptyScope
        multiOnly
        variant="settings"
        emptyYears={t("No active Academic Years available.")}
        emptySubjects={t("No active Subjects available.")}
      />
      <RestoreSection
        keys={[
          "goalScope",
          "timerDurationMode",
          "lastTimerDurationSeconds",
          "fixedTimerDurationSeconds",
          "subjectPickerMode",
          "defaultSubjectId",
          "lastSubjectId",
          "showDate",
          "dateFormat",
          "showWeekday",
          "weekdayStyle",
          "showClock",
          "clockFormat",
          "dailyGoalEnabled",
          "dailyGoalSeconds",
          "weeklyGoalEnabled",
          "weeklyGoalSeconds",
        ]}
      />
    </>
  );
}

function NotificationsAndSounds({ settings, setSetting }: SettingsProps) {
  const { t } = useTranslation();
  const [message, setMessage] = useState("");
  const notification = async (enabled: boolean) => {
    setMessage("");
    if (enabled && isTauri()) {
      const granted = await isPermissionGranted();
      if (!granted && (await requestPermission()) !== "granted") {
        setMessage(t("Notification permission was not granted."));
        return;
      }
    }
    await setSetting("completionNotification", enabled);
  };
  const preview = () => {
    setMessage("");
    try {
      previewCompletionSound(settings);
    } catch {
      setMessage(t("The completion sound could not be played."));
    }
  };
  const test = async () => {
    setMessage("");
    try {
      await testCompletionNotification();
      setMessage(t("Test notification sent."));
    } catch (error) {
      setMessage(t(error instanceof Error ? error.message : "The notification could not be sent."));
    }
  };
  return (
    <>
      <SettingsHeader title={t("Notifications & Sounds")}>
        {t("Choose how Shunhen tells you that a Session has finished.")}
      </SettingsHeader>
      <Row label={t("Show notification when timer finishes")}>
        <Toggle
          label={t("Show notification when timer finishes")}
          checked={settings.completionNotification}
          onChange={(value) => void notification(value)}
        />
      </Row>
      <Row label={t("Test notification")}>
        <button className="secondary-action" disabled={!settings.completionNotification} onClick={() => void test()}>
          <Bell /> {t("Send test")}
        </button>
      </Row>
      <Row label={t("Play sound when timer finishes")}>
        <Toggle
          label={t("Play sound when timer finishes")}
          checked={settings.completionSound}
          onChange={(value) => void setSetting("completionSound", value)}
        />
      </Row>
      <Row label={t("Completion sound")}>
        <select
          disabled={!settings.completionSound}
          value={settings.completionSoundChoice}
          onChange={(event) =>
            void setSetting("completionSoundChoice", event.target.value as FocusSettings["completionSoundChoice"])
          }
        >
          <option value="soft-chime">{t("Soft chime")}</option>
          <option value="bell">{t("Bell")}</option>
          <option value="digital">{t("Digital")}</option>
          <option value="gentle">{t("Gentle")}</option>
          <option value="bright">{t("Bright")}</option>
        </select>
      </Row>
      <Row label={t("Volume")} hint={`${settings.completionSoundVolume}%`}>
        <input
          aria-label={t("Volume")}
          disabled={!settings.completionSound}
          type="range"
          min="0"
          max="100"
          value={settings.completionSoundVolume}
          onChange={(event) => void setSetting("completionSoundVolume", Number(event.target.value))}
        />
      </Row>
      <Row label={t("Preview sound")}>
        <button className="secondary-action" disabled={!settings.completionSound} onClick={preview}>
          <Volume2 /> {t("Preview")}
        </button>
      </Row>
      {message && <div className="notice">{message}</div>}
      <RestoreSection
        keys={["completionNotification", "completionSound", "completionSoundChoice", "completionSoundVolume"]}
      />
    </>
  );
}

function Popout({ settings, setSetting }: SettingsProps) {
  const { t } = useTranslation();
  const [displays, setDisplays] = useState<{ id: string; label: string }[]>([]);
  const [dockError, setDockError] = useState(false);
  const [pendingAutoHide, setPendingAutoHide] = useState<{ value: boolean; settled: boolean } | null>(null);
  const autoHideRequest = useRef(0);
  const autoHideWrites = useRef(Promise.resolve());
  const autoHideEnabled = pendingAutoHide?.value ?? settings.popoutDockAutoHide;
  useEffect(() => {
    if (pendingAutoHide?.settled && pendingAutoHide.value === settings.popoutDockAutoHide) setPendingAutoHide(null);
  }, [pendingAutoHide, settings.popoutDockAutoHide]);
  const changeAutoHide = (value: boolean) => {
    const request = ++autoHideRequest.current;
    setPendingAutoHide({ value, settled: false });
    setDockError(false);
    autoHideWrites.current = autoHideWrites.current
      .catch(() => undefined)
      .then(async () => {
        await setSetting("popoutDockAutoHide", value);
        await reconcileAutoHideSetting();
      })
      .then(() => {
        if (request === autoHideRequest.current) setPendingAutoHide({ value, settled: true });
      })
      .catch(() => {
        if (request === autoHideRequest.current) {
          setPendingAutoHide(null);
          setDockError(true);
        }
      });
  };
  const docked = settings.popoutDockingEnabled && settings.popoutDocked;
  const changeMode = async (docked: boolean) => {
    setDockError(false);
    try {
      await setPopoutDocked(docked);
    } catch {
      setDockError(true);
    }
  };
  useEffect(() => {
    if (isTauri())
      void invoke<{ id: string; label: string }[]>("list_monitor_work_areas")
        .then(setDisplays)
        .catch(() => setDisplays([]));
  }, []);
  return (
    <>
      <SettingsHeader title={t("Popout")}>{t("Configure the floating timer window.")}</SettingsHeader>
      <div className="settings-subheading settings-group-heading">
        <strong>{t("Window")}</strong>
      </div>
      <Row label={t("Popout mode")} hint={dockError ? t("Unable to update the popout window. Try again.") : undefined}>
        <div className="settings-segmented" role="group" aria-label={t("Popout mode")}>
          {[true, false].map((docked) => (
            <button
              key={String(docked)}
              aria-pressed={(settings.popoutDockingEnabled && settings.popoutDocked) === docked}
              className={(settings.popoutDockingEnabled && settings.popoutDocked) === docked ? "selected" : ""}
              onClick={() => void changeMode(docked)}
            >
              {t(docked ? "Docked" : "Floating")}
            </button>
          ))}
        </div>
      </Row>
      <Row disabled={!docked} label={t("Dock position")}>
        <select
          aria-label={t("Dock position")}
          value={settings.popoutDockCorner}
          onChange={(event) => {
            const corner = event.target.value as FocusSettings["popoutDockCorner"];
            void setPopoutDocked(true, corner).catch(() => setDockError(true));
          }}
        >
          <option value="top-left">{t("Top Left")}</option>
          <option value="top-right">{t("Top Right")}</option>
          <option value="bottom-left">{t("Bottom Left")}</option>
          <option value="bottom-right">{t("Bottom Right")}</option>
        </select>
      </Row>
      <Row disabled={!docked} label={t("Monitor")}>
        <select
          aria-label={t("Monitor")}
          value={settings.popoutDockMonitor}
          disabled={!docked}
          onChange={(event) =>
            void setSetting("popoutDockMonitor", event.target.value as FocusSettings["popoutDockMonitor"])
          }
        >
          <option value="current">{t("Current monitor")}</option>
          {displays.map((display) => (
            <option key={display.id} value={display.id}>
              {display.label}
            </option>
          ))}
        </select>
      </Row>
      <div className="settings-subheading settings-group-heading">
        <strong>{t("Auto-hide")}</strong>
      </div>
      <Row label={t("Auto-hide")}>
        <Toggle label={t("Auto-hide")} checked={autoHideEnabled} onChange={changeAutoHide} />
      </Row>
      <Row disabled={!docked || !autoHideEnabled} label={t("Auto-hide edge")}>
        <select
          aria-label={t("Auto-hide edge")}
          value={docked ? settings.popoutAutoHideEdge : "automatic"}
          onChange={async (event) => {
            const edge = event.target.value as FocusSettings["popoutAutoHideEdge"];
            await db.transaction("rw", async (db) => {
              await saveSetting("popoutAutoHideOffset", dockEdgeOffset(settings.popoutDockCorner, edge), db);
              await saveSetting("popoutAutoHideEdge", edge, db);
            });
          }}
        >
          {!docked && <option value="automatic">{t("Automatic")}</option>}
          {edgesForCorner(settings.popoutDockCorner).map((edge) => (
            <option key={edge} value={edge}>
              {t({ top: "Top", right: "Right", bottom: "Bottom", left: "Left" }[edge])}
            </option>
          ))}
        </select>
      </Row>
      <Row
        disabled={!autoHideEnabled}
        label={t("Auto-hide delay")}
        hint={t("Seconds before the popout hides after you leave it.")}
      >
        <AutoHideDelayEditor
          value={settings.popoutAutoHideDelaySeconds}
          onChange={(value) => void setSetting("popoutAutoHideDelaySeconds", value)}
        />
      </Row>
      <Row disabled={!autoHideEnabled} label={t("Reveal tab size")}>
        <select
          value={settings.popoutAutoHideTabSize}
          onChange={(event) =>
            void setSetting("popoutAutoHideTabSize", event.target.value as FocusSettings["popoutAutoHideTabSize"])
          }
        >
          <option value="small">{t("Small")}</option>
          <option value="medium">{t("Medium")}</option>
          <option value="large">{t("Large")}</option>
        </select>
      </Row>
      <Row disabled={!autoHideEnabled} label={t("Show accent dot on reveal tab")}>
        <Toggle
          label={t("Show accent dot on reveal tab")}
          checked={settings.popoutAutoHideShowAccent}
          onChange={(value) => void setSetting("popoutAutoHideShowAccent", value)}
        />
      </Row>
      <div className="settings-subheading settings-group-heading">
        <strong>{t("Shortcut")}</strong>
      </div>
      <Row label={t("Show/hide shortcut")}>
        <Toggle
          label={t("Show/hide shortcut")}
          checked={settings.popoutShortcutEnabled}
          onChange={(value) => void setSetting("popoutShortcutEnabled", value)}
        />
      </Row>
      <Row disabled={!settings.popoutShortcutEnabled} label={t("Shortcut key")}>
        <ShortcutRecorder value={settings.popoutRevealShortcut} disabled={!settings.popoutShortcutEnabled} />
      </Row>
      <Row
        disabled={!settings.popoutShortcutEnabled}
        label={t("Shortcut hide delay")}
        hint={t("Seconds before hiding after shortcut. Set 0 for none.")}
      >
        <AutoHideDelayEditor
          value={settings.popoutRevealTimeoutSeconds}
          disabled={!settings.popoutShortcutEnabled}
          label="Shortcut hide delay"
          onChange={(value) => void setSetting("popoutRevealTimeoutSeconds", value)}
        />
      </Row>
      <div className="settings-subheading settings-group-heading">
        <strong>{t("Appearance & behavior")}</strong>
      </div>
      <Row label={t("Always on top by default")}>
        <Toggle
          label={t("Always on top by default")}
          checked={settings.popoutAlwaysOnTop}
          onChange={(v) => void setSetting("popoutAlwaysOnTop", v)}
        />
      </Row>
      <Row label={t("Show popout in taskbar")}>
        <Toggle
          label={t("Show popout in taskbar")}
          checked={settings.popoutShowInTaskbar}
          onChange={(v) => void setSetting("popoutShowInTaskbar", v)}
        />
      </Row>
      <Row label={t("Open popout automatically when a timer starts")}>
        <Toggle
          label={t("Open popout automatically")}
          checked={settings.popoutAutoOpen}
          onChange={(v) => void setSetting("popoutAutoOpen", v)}
        />
      </Row>
      <Row hint={t("Reopen the floating popout at its last saved position.")} label={t("Restore floating position")}>
        <Toggle
          label={t("Restore floating position")}
          checked={settings.popoutRememberPosition}
          onChange={(v) => void setSetting("popoutRememberPosition", v)}
        />
      </Row>
      <Row label={t("Show Subject")}>
        <Toggle
          label={t("Show Subject")}
          checked={settings.popoutShowSubject}
          onChange={(v) => void setSetting("popoutShowSubject", v)}
        />
      </Row>
      <Row label={t("Show clock beside Subject")}>
        <Toggle
          label={t("Show clock beside Subject")}
          checked={settings.popoutShowClock}
          onChange={(v) => void setSetting("popoutShowClock", v)}
        />
      </Row>
      <Row label={t("Popout layout")}>
        <select
          value={settings.popoutLayout}
          onChange={async (event) => {
            const layout = event.target.value as FocusSettings["popoutLayout"];
            await setSetting("popoutFloatingWidth", null);
            await setSetting("popoutFloatingHeight", null);
            await setSetting("popoutLayout", layout);
          }}
        >
          <option value="regular">{t("Regular")}</option>
          <option value="compact">{t("Compact")}</option>
        </select>
      </Row>
      <Row label={t("Popout size")}>
        <select
          value={settings.popoutSize}
          onChange={(event) => void setSetting("popoutSize", event.target.value as FocusSettings["popoutSize"])}
        >
          <option value="small">{t("Small")}</option>
          <option value="medium">{t("Medium")}</option>
          <option value="large">{t("Large")}</option>
        </select>
      </Row>
      <OpacitySetting
        label={t("Background opacity")}
        value={settings.popoutTransparency}
        step={5}
        onChange={(value) => setSetting("popoutTransparency", value)}
      />
      <OpacitySetting
        label={t("Border opacity")}
        value={settings.popoutBorderOpacity}
        step={1}
        onChange={(value) => setSetting("popoutBorderOpacity", value)}
      />
      <Row label={t("Hide controls until hovered")}>
        <Toggle
          label={t("Hide controls until hovered")}
          checked={settings.popoutHideControls}
          onChange={(v) => void setSetting("popoutHideControls", v)}
        />
      </Row>
      <Row label={t("Auto-hide controls after")}>
        <select
          value={settings.popoutAutoHide}
          disabled={!settings.popoutHideControls}
          onChange={(event) => void setSetting("popoutAutoHide", event.target.value as FocusSettings["popoutAutoHide"])}
        >
          <option value="500">{t("0.5 seconds")}</option>
          <option value="1000">{t("1 second")}</option>
          <option value="2000">{t("2 seconds")}</option>
          <option value="never">{t("Never")}</option>
        </select>
      </Row>
      <RestoreSection
        keys={[
          "popoutAlwaysOnTop",
          "popoutRememberPosition",
          "popoutShowSubject",
          "popoutShowClock",
          "popoutSize",
          "popoutLayout",
          "popoutHideControls",
          "popoutAutoHide",
          "popoutAutoOpen",
          "popoutShowInTaskbar",
          "popoutTransparency",
          "popoutBorderOpacity",
          "popoutPositionX",
          "popoutPositionY",
          "popoutFloatingWidth",
          "popoutFloatingHeight",
          "popoutShortcutEnabled",
          "popoutRevealShortcut",
          "popoutRevealTimeoutSeconds",
          "popoutDockingEnabled",
          "popoutDockCorner",
          "popoutDockMonitor",
          "popoutDocked",
          "popoutDockAutoHide",
          "popoutAutoHideDelaySeconds",
          "popoutAutoHideTabSize",
          "popoutAutoHideShowAccent",
          "popoutAutoHideEdge",
          "popoutAutoHideOffset",
        ]}
      />
    </>
  );
}

const accents: { name: string; value: AccentColour }[] = [
  { name: "Coral Red", value: "coral" },
  { name: "Orange", value: "orange" },
  { name: "Cherry Blossom Pink", value: "pink" },
  { name: "Muted Miku Blue", value: "miku" },
  { name: "Green", value: "green" },
  { name: "Cappuccino", value: "cappuccino" },
];
function Appearance({ settings, setSetting }: SettingsProps) {
  const { t } = useTranslation();
  return (
    <>
      <SettingsHeader title={t("Appearance")}>{t("Customize the Shunhen interface.")}</SettingsHeader>
      <Row label={t("Theme")}>
        <select
          value={settings.theme}
          onChange={(event) => void setSetting("theme", event.target.value as FocusSettings["theme"])}
        >
          <option value="dark">{t("Dark")}</option>
          <option value="light">{t("Light")}</option>
        </select>
      </Row>
      <Row label={t("Accent color")}>
        <div className="accent-options">
          {accents.map((accent) => (
            <button
              key={accent.value}
              title={t(accent.name)}
              aria-label={t(accent.name)}
              className={settings.accentColour === accent.value ? "active" : ""}
              data-accent={accent.value}
              onClick={() => void setSetting("accentColour", accent.value)}
            >
              <span />
            </button>
          ))}
        </div>
      </Row>
      <Row label={t("UI scale")}>
        <select
          value={settings.uiScale}
          onChange={(event) => void setSetting("uiScale", event.target.value as FocusSettings["uiScale"])}
        >
          <option value="small">{t("Small")}</option>
          <option value="medium">{t("Medium")}</option>
          <option value="large">{t("Large")}</option>
          <option value="extra-large">{t("Extra large")}</option>
        </select>
      </Row>
      <RestoreSection keys={["theme", "accentColour", "uiScale"]} />
    </>
  );
}

function Data({ settings, setSetting, onNavigate }: SettingsProps & { onNavigate: (page: string) => void }) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const clear = async () => {
    setBusy(true);
    setError("");
    try {
      await clearAllFocusData();
      window.location.reload();
    } catch (reason) {
      setError(t(reason instanceof Error ? reason.message : "Shunhen data could not be cleared."));
      setBusy(false);
    }
  };
  const startClear = () => {
    setError("");
    if (hasActiveTimer()) {
      setError(t("Finish or stop the current timer before clearing app data."));
      return;
    }
    setConfirming(true);
  };
  return (
    <div className="settings-data">
      <SettingsHeader title={t("Data")}>{t("Storage and data management.")}</SettingsHeader>
      <Row label={t("Storage")} hint={t("Your Shunhen data is stored locally on this device.")}>
        <span className="storage-value">{t("On this device")}</span>
      </Row>
      <Row
        label={t("Last full backup")}
        hint={settings.lastBackupAt ? formatLastBackup(settings.lastBackupAt, settings.language) : t("Never")}
      >
        <button className="secondary-action" onClick={() => void exportFullBackup()}>
          <Download /> {t("Back up now")}
        </button>
      </Row>
      <Row label={t("Import / Export")} hint={t("Move data between devices or restore a backup.")}>
        <button className="secondary-action" onClick={() => onNavigate("Import / Export")}>
          {t("Open Import / Export")}
        </button>
      </Row>
      <div className="settings-subheading">
        <strong>{t("Deletion safety")}</strong>
        <span>{t("Archive-first protection for Subjects and Academic Years.")}</span>
      </div>
      <Row
        label={t("Allow deleting active Academic Years and Subjects")}
        hint={t("Permanent deletion still requires confirmation and removes related study data.")}
      >
        <Toggle
          label={t("Allow deleting active Academic Years and Subjects")}
          checked={settings.allowDirectActiveDeletion}
          onChange={(value) => void setSetting("allowDirectActiveDeletion", value)}
        />
      </Row>
      <Row label={t("Restore section defaults")}>
        <RestoreSection keys={["allowDirectActiveDeletion"]} />
      </Row>
      <Row label={t("Clear all data")} hint={t("Permanently remove all local Shunhen data.")}>
        <button className="danger-outline" onClick={startClear}>
          <Trash2 /> {t("Clear all data")}
        </button>
      </Row>
      {error && <div className="notice notice--error">{error}</div>}
      {confirming && (
        <div className="modal-backdrop" onMouseDown={() => setConfirming(false)}>
          <section
            className="modal clear-data-modal typed-confirmation-modal"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <h2>{t("Clear all Shunhen data?")}</h2>
            <p>
              {t(
                "This permanently deletes all study history, Subjects, Academic Years, and Settings stored on this device.",
              )}
            </p>
            <p>{t("This cannot be undone without a backup. Type DELETE to continue.")}</p>
            <input
              autoFocus
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              aria-label={t("Type DELETE to confirm")}
            />
            <div className="modal-actions">
              <button onClick={() => setConfirming(false)}>{t("Cancel")}</button>
              <button className="danger-action" disabled={typed !== "DELETE" || busy} onClick={() => void clear()}>
                {busy ? t("Clearing...") : t("Clear all data")}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function About() {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const [version, setVersion] = useState(packageMetadata.version);
  useEffect(() => {
    if (isTauri())
      void getVersion()
        .then(setVersion)
        .catch(() => undefined);
  }, []);
  return (
    <div className="about-settings">
      <SettingsHeader title={t("About")}>{t("Application information.")}</SettingsHeader>
      <div className="about-body">
        <div className="about-identity">
          <FocusLeaf className="about-leaf" />
          <div>
            <h3>Shunhen</h3>
            <p>{t("Time well spent.")}</p>
            <span>V{version}</span>
          </div>
        </div>
        <section>
          <h3>{t("About Shunhen")}</h3>
          <p>{t("Shunhen is a local-first study timer and analytics app designed for long-term study tracking.")}</p>
        </section>
        <section>
          <h3>{t("Your data")}</h3>
          <p>
            {t(
              "Shunhen stores your study data locally on this device. Your data is not uploaded to a Shunhen account or cloud service.",
            )}
          </p>
        </section>
        <section>
          <h3>{t("Application")}</h3>
          <dl>
            <div>
              <dt>{t("Version")}</dt>
              <dd>{version}</dd>
            </div>
            <div>
              <dt>{t("Platform")}</dt>
              <dd>Windows</dd>
            </div>
            <div>
              <dt>{t("Data storage")}</dt>
              <dd>{t("Local device")}</dd>
            </div>
          </dl>
        </section>
        <section>
          <h3>{t("Built with")}</h3>
          <p>Tauri / React / TypeScript</p>
        </section>
        <UpdateControls />
        {import.meta.env.DEV && isTauri() && (
          <section>
            <h3>{t("Developer tools")}</h3>
            <p>{t("Development-only tools for previewing Shunhen UI states.")}</p>
            <Row label={t("Preview update dialog")}>
              <button className="secondary-action" onClick={() => updatePreview.open(version)}>
                {t("Preview update dialog")}
              </button>
            </Row>
          </section>
        )}
      </div>
    </div>
  );
}
