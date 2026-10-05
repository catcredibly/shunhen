import { readHistorySessions } from "../storage/queries";
import { validSessions } from "../sessionValidity";
import { NoteEditor } from "./NoteEditor";
import { FilterSelect } from "./FilterSelect";
import { selectableSubjects, subjectOptions } from "../selectorOptions";
import { TimerSetup } from "./TimerSetup";
import { TimerLoading } from "./PageSkeletons";
import { defaultSessionSubject } from "../subjectDefaults";
import { Check, ExternalLink, Maximize2, Minimize2, Pause, Play, Plus, Square } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "../hooks/useLiveQuery";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { db } from "../db";
import { formatDuration } from "../data";
import { formatTimerDateTime } from "../dateTime";
import { goalProgress } from "../goals";
import { useMainTimer as useTimer } from "../hooks/TimerContext";
import { StartSessionButton } from "./StartSessionButton";
import { currentStreak, todaySummary } from "../timerState";
import { useSettings } from "../hooks/useSettings";
import { normaliseDuration, saveSetting, timerDefaultDuration } from "../settings";
import type { FocusSettings } from "../settings";
import type { AcademicYear, FocusSession, Subject } from "../types";
import { openTimerPopout } from "../native";
import { IconButton } from "./IconButton";
import { TimerExtendMenu } from "./TimerExtendMenu";

const pad = (value: number | string) => String(value || 0).padStart(2, "0");

export function TimerPage({ onNavigate }: { onNavigate: (page: string) => void }) {
  const sessions = useLiveQuery(() => readHistorySessions(db), []);
  const allYears = useLiveQuery(() => db.academicYears.toArray(), []);
  const allSubjects = useLiveQuery(() => db.subjects.toArray(), []);
  if (sessions === undefined || allYears === undefined || allSubjects === undefined) return <TimerLoading />;
  return <LoadedTimerPage onNavigate={onNavigate} sessions={sessions} allYears={allYears} allSubjects={allSubjects} />;
}

function LoadedTimerPage({
  onNavigate,
  sessions,
  allYears,
  allSubjects,
}: {
  onNavigate: (page: string) => void;
  sessions: FocusSession[];
  allYears: AcademicYear[];
  allSubjects: Subject[];
}) {
  const { t } = useTranslation();
  const timer = useTimer();
  const { settings } = useSettings();
  const [hours, setHours] = useState("01");
  const [minutes, setMinutes] = useState("15");
  const [seconds, setSeconds] = useState("00");
  const [extendOpen, setExtendOpen] = useState(false);
  const [subjectId, setSubjectId] = useState("");
  const [todayOpen, setTodayOpen] = useState(false);
  const shellRef = useRef<HTMLElement>(null);
  const [todayAvailable, setTodayAvailable] = useState(false);
  useEffect(() => {
    const node = shellRef.current;
    if (!node) return;
    // 520px Timer + 390px Today + 24px gap + 108px padding. Hysteresis prevents resize flicker.
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.borderBoxSize[0]?.inlineSize ?? node.getBoundingClientRect().width;
      setTodayAvailable((previous) => width >= (previous ? 1042 : 1058));
      if (width < 1042) setTodayOpen(false);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [timer.state.running]);
  const [discarding, setDiscarding] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenReveal, setFullscreenReveal] = useState(false);
  const subjects = selectableSubjects(allYears, allSubjects);
  const availableYears = allYears.filter((year) => !year.archived);
  const setupStep = !allYears.length ? 1 : !availableYears.length ? 3 : !subjects.length ? 4 : undefined;
  const [recoverySubjectId, setRecoverySubjectId] = useState("");
  const defaultDuration = timerDefaultDuration(settings);
  const selectedSubject = subjects.find((subject) => subject.id === subjectId);
  const selectedYear = allYears.find((year) => year.id === selectedSubject?.academicYearId);
  const analyticsSessions = validSessions(sessions, allYears);
  const summary = todaySummary(analyticsSessions);
  const goals = goalProgress(analyticsSessions, now.getTime());
  const recent = sessions.filter((session) => !session.archived).slice(0, 4);
  const duration = useMemo(
    () => normaliseDuration(Number(hours), Number(minutes), Number(seconds)).total,
    [hours, minutes, seconds],
  );

  useEffect(() => {
    if (!defaultDuration || timer.state.running) return;
    const value = normaliseDuration(0, 0, defaultDuration);
    setHours(pad(value.hours));
    setMinutes(pad(value.minutes));
    setSeconds(pad(value.seconds));
  }, [defaultDuration, timer.state.running]);
  const subjectDefaultsKey = `${settings.subjectPickerMode}:${settings.defaultSubjectId}:${settings.lastSubjectId}`;
  const lastDefaults = useRef("");
  useEffect(() => {
    if (timer.state.running) {
      lastDefaults.current = "";
      return;
    }
    if (lastDefaults.current !== subjectDefaultsKey || !subjects.some((subject) => subject.id === subjectId)) {
      setSubjectId(defaultSessionSubject(subjects, allYears, settings));
      lastDefaults.current = subjectDefaultsKey;
    }
  }, [subjectDefaultsKey, subjects, subjectId, timer.state.running]);

  const setNativeFullscreen = async (next: boolean) => {
    try {
      if (isTauri()) await invoke("set_main_fullscreen", { fullscreen: next });
      else await getCurrentWindow().setFullscreen(next);
      setFullscreen(next);
    } catch {
      setFullscreen(false);
    }
  };
  const toggleFullscreen = () => setNativeFullscreen(!fullscreen);
  const trackFullscreenReveal = (event: React.PointerEvent<HTMLElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const width = Math.min(260, Math.max(160, window.innerWidth * 0.18));
    const height = Math.min(180, Math.max(110, window.innerHeight * 0.16));
    setFullscreenReveal(event.clientX >= bounds.right - width && event.clientY <= bounds.top + height);
  };
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 10_000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    if (isTauri())
      void invoke<boolean>("is_main_fullscreen")
        .then(setFullscreen)
        .catch(() => setFullscreen(false));
  }, []);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "F11") {
        event.preventDefault();
        void toggleFullscreen();
      }
      if (event.key === "Escape" && fullscreen) {
        event.preventDefault();
        void setNativeFullscreen(false);
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [fullscreen]);
  useEffect(() => {
    document.documentElement.toggleAttribute("data-timer-fullscreen", fullscreen);
    return () => document.documentElement.removeAttribute("data-timer-fullscreen");
  }, [fullscreen]);
  const commitInput = () => {
    const value = normaliseDuration(Number(hours), Number(minutes), Number(seconds));
    setHours(pad(value.hours));
    setMinutes(pad(value.minutes));
    setSeconds(pad(value.seconds));
    return value.total;
  };
  const input = (value: string, setter: (value: string) => void) => setter(value.replace(/\D/g, ""));
  const inputKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") event.currentTarget.blur();
  };
  const openPopout = () => openTimerPopout(settings).catch(() => undefined);
  const startSession = async (stopwatch: boolean) => {
    const value = commitInput();
    if (!selectedSubject || !selectedYear || selectedYear.archived || (!stopwatch && value <= 0)) return;
    const subject = await db.subjects.get(selectedSubject.id);
    const year = subject ? await db.academicYears.get(subject.academicYearId) : undefined;
    if (!subject || subject.archived || !year || year.archived) return;
    await saveSetting("lastSubjectId", selectedSubject.id);
    if (stopwatch) timer.startStopwatch(subject, year);
    else {
      await saveSetting("lastTimerDurationSeconds", value);
      timer.start(value, subject, year);
    }
    if (settings.popoutAutoOpen) await openPopout();
  };
  const dateTime = formatTimerDateTime(now, settings.language, settings);
  const timerTools = (
    <div className={`timer-top-tools ${fullscreenReveal ? "timer-top-tools--visible" : ""}`}>
      <span className="fullscreen-tool">
        <IconButton
          label={t(fullscreen ? "Exit fullscreen (F11)" : "Fullscreen (F11)")}
          className="icon-button"
          onClick={() => void toggleFullscreen()}
        >
          {fullscreen ? <Minimize2 /> : <Maximize2 />}
        </IconButton>
      </span>
    </div>
  );
  const setupActive = !timer.state.running && Boolean(setupStep);
  useEffect(() => {
    if (setupActive) setTodayOpen(false);
  }, [setupActive]);
  const dateControl =
    todayAvailable && !setupActive ? (
      <span className="tooltip-host date-toggle-host">
        <button className="date date-toggle" aria-pressed={todayOpen} onClick={() => setTodayOpen((value) => !value)}>
          {dateTime || t("Today")}
        </button>
        <span className="focus-tooltip" role="tooltip">
          {t(todayOpen ? "Hide Today pane" : "Show Today pane")}
        </span>
      </span>
    ) : (
      <span className="date">{dateTime}</span>
    );

  const recoveryDialogs = (
    <>
      {timer.recovery === "running" && (
        <Dialog title={t("Recover timer")}>
          <p>{t("Shunhen closed while this timer was running. How would you like to continue?")}</p>
          <div className="modal-actions modal-actions--stack">
            <button className="primary-action" onClick={timer.continueRecovery}>
              {t("Continue timer")}
            </button>
            <button onClick={timer.resumeCheckpoint}>{t("Resume from where I left off")}</button>
            <button className="danger-outline" onClick={() => setDiscarding(true)}>
              {t("Discard timer")}
            </button>
          </div>
        </Dialog>
      )}
      {discarding && (
        <Dialog title={t("Discard timer?")}>
          <p>{t("This unfinished timer and its unsaved focus time will be discarded.")}</p>
          <div className="modal-actions">
            <button onClick={() => setDiscarding(false)}>{t("Cancel")}</button>
            <button
              className="danger-action"
              onClick={() => {
                timer.discard();
                setDiscarding(false);
              }}
            >
              {t("Discard")}
            </button>
          </div>
        </Dialog>
      )}
      {timer.saveError && (
        <Dialog title={t("Couldn't save this session")}>
          <p>{t("Shunhen couldn't save this study session. Your session data has been preserved.")}</p>
          <div className="modal-actions">
            <button className="primary-action" disabled={!timer.noteValid} onClick={() => void timer.retrySave()}>
              {t("Retry")}
            </button>
          </div>
        </Dialog>
      )}
      {timer.recovery === "relationship" && (
        <Dialog title={t("Choose a Subject for this timer")}>
          <p>
            {t(
              "The original Subject or Academic Year is no longer active. Choose an active Subject before continuing.",
            )}
          </p>
          <FilterSelect
            entity="subject"
            label={t("Subject")}
            value={recoverySubjectId}
            onChange={setRecoverySubjectId}
            options={[{ value: "", label: t("Choose Subject") }, ...subjectOptions(allYears, allSubjects, [], true)]}
          />
          <div className="modal-actions">
            <button className="danger-outline" onClick={() => setDiscarding(true)}>
              {t("Discard timer")}
            </button>
            <button
              className="primary-action"
              disabled={!recoverySubjectId}
              onClick={() => {
                const subject = allSubjects.find((row) => row.id === recoverySubjectId);
                const year = allYears.find((row) => row.id === subject?.academicYearId);
                if (subject && year) timer.reassign(subject, year);
              }}
            >
              {t("Use Subject")}
            </button>
          </div>
        </Dialog>
      )}
      {stopping && (
        <Dialog title={t("Stop timer?")}>
          <p>{t("Elapsed focus time will be saved as a completed Session.")}</p>
          <div className="modal-actions modal-actions--stack">
            <button onClick={() => setStopping(false)}>{t("Cancel")}</button>
            <button
              className="danger-outline"
              onClick={() => {
                setStopping(false);
                setVoiding(true);
              }}
            >
              {t("Void Session")}
            </button>
            <button
              className="primary-action"
              disabled={!timer.noteValid}
              onClick={async () => {
                setStopping(false);
                await timer.stop();
              }}
            >
              {t("Stop and save")}
            </button>
          </div>
        </Dialog>
      )}
      {voiding && (
        <Dialog title={t("Void this Session?")}>
          <p>
            {t(
              "The recorded study time will be discarded and will not appear in History, Analytics, goals, or streaks.",
            )}
          </p>
          <div className="modal-actions">
            <button onClick={() => setVoiding(false)}>{t("Cancel")}</button>
            <button
              className="danger-action"
              onClick={() => {
                timer.discard();
                setVoiding(false);
              }}
            >
              {t("Void Session")}
            </button>
          </div>
        </Dialog>
      )}
    </>
  );

  if (timer.state.running)
    return (
      <main ref={shellRef} className={`timer-shell timer-shell--running ${todayOpen ? "timer-shell--today-open" : ""}`}>
        <section
          className="running-stage"
          onPointerMove={trackFullscreenReveal}
          onPointerLeave={() => setFullscreenReveal(false)}
        >
          {timerTools}
          {dateTime && dateControl}
          {timer.state.expiredWhileClosed && !timer.state.expiredNoticeDismissed && (
            <aside className="expired-timer-notice" role="status">
              <strong>{t("Timer finished while Shunhen was closed")}</strong>
              <span>
                {t("Your {{subject}} timer finished at {{time}}.", {
                  subject: timer.state.subject,
                  time: new Date(timer.state.finishedAt ?? 0).toLocaleTimeString(settings.language, {
                    hour: "numeric",
                    minute: "2-digit",
                  }),
                })}
              </span>
              <button aria-label={t("Dismiss")} onClick={timer.dismissExpiredNotice}>
                ×
              </button>
            </aside>
          )}
          <div className="running-subject subject-overflow" tabIndex={0} title={timer.state.subject}>
            <span className="subject-dot" style={{ background: timer.state.subjectColor }} />
            <span>{timer.state.subject}</span>
          </div>
          <div className="running-time">
            <span>{pad(timer.display.hours)}</span>
            <b>:</b>
            <span>{pad(timer.display.minutes)}</span>
            <b>:</b>
            <span>{pad(timer.display.seconds)}</span>
          </div>
          <div className="running-labels">
            <span>{t("Hours")}</span>
            <span>{t("Minutes")}</span>
            <span>{t("Seconds")}</span>
          </div>
          <div className="running-status">
            {timer.state.finished ? t("Finished") : timer.state.paused ? t("Paused") : ""}
          </div>
          <div className="running-controls">
            <button
              className="control-button"
              disabled={timer.state.finished && !timer.noteValid}
              onClick={timer.state.finished ? timer.finish : timer.pause}
            >
              {timer.state.finished ? (
                <Check size={25} />
              ) : timer.state.paused ? (
                <Play size={25} fill="currentColor" />
              ) : (
                <Pause size={25} fill="currentColor" />
              )}
              <span>{timer.state.finished ? t("Finish") : timer.state.paused ? t("Resume") : t("Pause")}</span>
            </button>
            <button className="control-button" data-note-exit onClick={() => setStopping(true)}>
              <Square size={22} fill="currentColor" />
              <span>{t("Stop")}</span>
            </button>
            {timer.state.mode !== "stopwatch" && (
              <div className="extend-wrap">
                <button
                  className={`control-button ${extendOpen ? "control-button--accent" : ""}`}
                  onClick={() => setExtendOpen((value) => !value)}
                >
                  <Plus size={27} />
                  <span>{t("Extend")}</span>
                </button>
                {extendOpen && (
                  <TimerExtendMenu
                    onClose={() => setExtendOpen(false)}
                    onExtend={(amount) => {
                      timer.extend(amount);
                      setExtendOpen(false);
                    }}
                  />
                )}
              </div>
            )}
            <button className="control-button" disabled={Boolean(timer.state.saveFailed)} onClick={openPopout}>
              <ExternalLink size={22} />
              <span>{t("Pop out")}</span>
            </button>
          </div>
          <NoteEditor value={timer.state.note} onChange={timer.setNote} />
        </section>
        {todayAvailable && todayOpen && (
          <TodayPanel
            summary={summary}
            sessions={analyticsSessions}
            recent={recent}
            dailySeconds={goals.dailySeconds}
            weeklySeconds={goals.weeklySeconds}
            settings={settings}
          />
        )}{" "}
        {recoveryDialogs}
      </main>
    );

  if (setupStep)
    return (
      <main ref={shellRef} className="timer-shell timer-shell--idle">
        <section className="timer-card timer-card--setup">
          {dateControl}
          {setupStep === 1 ? (
            <TimerSetup step={1} onNavigate={onNavigate} />
          ) : (
            <section className="timer-unavailable">
              <h2>{t(setupStep === 3 ? "No active Academic Years" : "No active subjects")}</h2>
              <p>
                {t(
                  setupStep === 3
                    ? "Create or update an academic year to continue."
                    : "Create or unarchive a Subject in a non-archived Academic Year to continue.",
                )}
              </p>
              <button
                className="secondary-action"
                onClick={() => onNavigate(setupStep === 3 ? "Academic Years" : "Subjects")}
              >
                {t(setupStep === 3 ? "Manage Academic Years" : "Manage Subjects")}
              </button>
              <button className="primary-action" disabled>
                {t("Start")}
              </button>
            </section>
          )}
        </section>
      </main>
    );

  return (
    <main ref={shellRef} className={`timer-shell timer-shell--idle ${todayOpen ? "timer-shell--today-open" : ""}`}>
      <section
        className="timer-card"
        onPointerMove={trackFullscreenReveal}
        onPointerLeave={() => setFullscreenReveal(false)}
      >
        {timerTools}
        {dateControl}
        <div className="time-entry">
          <label>
            <input
              inputMode="numeric"
              value={hours}
              onChange={(event) => input(event.target.value, setHours)}
              onBlur={commitInput}
              onKeyDown={inputKey}
            />
            <span>{t("Hours")}</span>
          </label>
          <b>:</b>
          <label>
            <input
              inputMode="numeric"
              value={minutes}
              onChange={(event) => input(event.target.value, setMinutes)}
              onBlur={commitInput}
              onKeyDown={inputKey}
            />
            <span>{t("Minutes")}</span>
          </label>
          <b>:</b>
          <label>
            <input
              inputMode="numeric"
              value={seconds}
              onChange={(event) => input(event.target.value, setSeconds)}
              onBlur={commitInput}
              onKeyDown={inputKey}
            />
            <span>{t("Seconds")}</span>
          </label>
        </div>
        <FilterSelect
          entity="subject"
          label={t("Subject")}
          className="subject-select"
          hideMultiSelect
          value={selectedSubject?.id ?? ""}
          onChange={setSubjectId}
          disabled={!subjects.length}
          options={[
            ...(!selectedSubject ? [{ value: "", label: t("Choose Subject") }] : []),
            ...subjectOptions(allYears, allSubjects, [], true),
          ]}
        />
        <NoteEditor value={timer.state.note} onChange={timer.setNote} />
        <StartSessionButton
          disabled={!timer.noteValid || !selectedSubject || !selectedYear || Boolean(selectedYear.archived)}
          timerDisabled={duration <= 0}
          onTimer={() => void startSession(false)}
          onStopwatch={() => void startSession(true)}
        />
      </section>
      {todayAvailable && todayOpen && (
        <TodayPanel
          summary={summary}
          sessions={analyticsSessions}
          recent={recent}
          dailySeconds={goals.dailySeconds}
          weeklySeconds={goals.weeklySeconds}
          settings={settings}
        />
      )}{" "}
      {recoveryDialogs}
    </main>
  );
}

function TodayPanel({
  summary,
  sessions,
  recent,
  dailySeconds,
  weeklySeconds,
  settings,
}: {
  summary: ReturnType<typeof todaySummary>;
  sessions: FocusSession[];
  recent: FocusSession[];
  dailySeconds: number;
  weeklySeconds: number;
  settings: FocusSettings;
}) {
  const { t } = useTranslation();
  return (
    <aside className="today-panel">
      <h2>{t("Today")}</h2>
      <div className="metric-card">
        <span>{t("Focus time")}</span>
        <strong>{formatDuration(summary.focusedDurationSeconds)}</strong>
      </div>
      <div className="metric-card">
        <span>{t("Sessions")}</span>
        <strong>{summary.sessions.length}</strong>
      </div>
      <div className="metric-card">
        <span>{t("Current streak")}</span>
        <strong>{t("{{count}} days", { count: currentStreak(sessions) })}</strong>
      </div>
      {settings.dailyGoalEnabled && (
        <GoalProgress kind="daily" label={t("Daily goal")} current={dailySeconds} target={settings.dailyGoalSeconds} />
      )}{" "}
      {settings.weeklyGoalEnabled && (
        <GoalProgress
          kind="weekly"
          label={t("Weekly goal")}
          current={weeklySeconds}
          target={settings.weeklyGoalSeconds}
        />
      )}
      <h3>{t("Recent Sessions")}</h3>
      {recent.map((session) => (
        <div className="recent-row" key={session.id}>
          <span className="recent-dot" />
          <span className="subject-overflow" title={session.subjectName}>
            {session.subjectName}
          </span>
          <strong>{formatDuration(session.focusedDurationSeconds)}</strong>
          <small>
            {new Date(session.startTime).toLocaleTimeString(settings.language, { hour: "2-digit", minute: "2-digit" })}
          </small>
        </div>
      ))}
      {!recent.length && <p className="recent-empty">{t("No completed Sessions yet.")}</p>}
    </aside>
  );
}

function GoalProgress({
  label,
  current,
  target,
  kind,
}: {
  kind: "daily" | "weekly";
  label: string;
  current: number;
  target: number;
}) {
  const { t } = useTranslation();
  const reached = target > 0 && current >= target;
  return (
    <section className={`goal-progress goal-${kind}`}>
      <div>
        <span>{label}</span>
        <strong>{formatDuration(target)}</strong>
      </div>
      <progress max={Math.max(1, target)} value={Math.min(current, target)} />
      <small>
        {formatDuration(current)} / {formatDuration(target)}
      </small>
      <small>
        {reached
          ? t("Goal reached")
          : t("{{duration}} left", { duration: formatDuration(Math.max(0, target - current)) })}
      </small>
    </section>
  );
}

function Dialog({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="modal-backdrop">
      <section className="modal timer-dialog" role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </section>
    </div>
  );
}
