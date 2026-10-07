import { readHistorySnapshot, readYearsAlphabetically, readSubjectsAlphabetically } from "../storage/queries";
import { LinkedScopeSelectors } from "./LinkedScopeSelectors";
import { ALL_SCOPE, subjectSelection, type LinkedScope } from "../linkedScope";
import { FilterSelect } from "./FilterSelect";
import { academicYearOptions, orderedAcademicYears, alphabetical, subjectOptions } from "../selectorOptions";
import { HistoryLoading } from "./PageSkeletons";
import { inHistoryScope, historyStatusAfterScope, matchesHistoryStatus } from "../historyFilters";
import { sessionInvalidReason, invalidReasonText } from "../sessionValidity";
import { historyPagination, enteredHistoryPage } from "../historyPagination";
import { NoteViewer, NoteSnippet, NotePreview } from "./HistoryNotes";
import { NoteEditor } from "./NoteEditor";
import { readableNote, noteSearchTerms, noteMetrics } from "../notes";
import { showToast } from "../toasts";
import { cycleSubjectColor, nextSubjectColor } from "../subjectColors";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "../hooks/useLiveQuery";
import {
  FileText,
  TriangleAlert,
  CaseSensitive,
  Search,
  X,
  Archive,
  CalendarDays,
  Check,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { db } from "../db";
import { createSession, formatDuration } from "../data";
import type { AcademicYear, FocusSession, Subject } from "../types";
import { localDateInputValue } from "../timerState";
import {
  canDeleteManagedRecord,
  deleteAcademicYearCascade,
  deleteSession,
  deleteSessions,
  deleteSubjectCascade,
  isSessionEffectivelyArchived,
  moveSessions,
  setAcademicYearArchived,
  setSubjectArchived,
  saveSubject,
  saveSessionEdit,
  saveAcademicYearEdit,
} from "../management";
import { managementViewState } from "../managementViewState";
import { useSettings } from "../hooks/useSettings";
import { useTranslation } from "react-i18next";
import { localeCode } from "../i18n";
import {
  editedSessionTimes,
  manualEndOffset,
  sessionDayOffset,
  sessionEditTiming,
  durationParts,
  sessionSpanSeconds,
} from "../sessionDuration";

const activeTimerRelationship = () => {
  try {
    const timer = JSON.parse(localStorage.getItem("focus.activeTimer") ?? "null");
    return timer?.sessionId && timer?.startedAt
      ? { subjectId: String(timer.subjectId ?? ""), academicYearId: String(timer.academicYearId ?? "") }
      : undefined;
  } catch {
    return undefined;
  }
};
const dateText = (value?: string) =>
  value
    ? new Date(`${value}T00:00:00`).toLocaleDateString(localeCode(), {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "No dates set";

function PageHeader({ title, subtitle, action }: { title: string; subtitle: string; action?: React.ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
      {action}
    </header>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    root.current?.querySelector<HTMLElement>("button, input, select, textarea")?.focus();
    return () => previous?.focus();
  }, []);
  return (
    <div
      ref={root}
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={onClose}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape") {
          event.preventDefault();
          onClose();
        }
        if (event.key !== "Tab") return;
        const controls = Array.from(
          root.current?.querySelectorAll<HTMLElement>(
            "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex='0']",
          ) ?? [],
        ).filter((element) => element.getClientRects().length > 0);
        const first = controls[0],
          last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        }
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
    >
      <section className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {children}
      </section>
    </div>
  );
}

function DeleteConfirmation({
  title,
  children,
  onCancel,
  onDelete,
  deleteLabel = "Delete",
}: {
  title: string;
  children: React.ReactNode;
  onCancel: () => void;
  onDelete: () => Promise<void>;
  deleteLabel?: string;
}) {
  const { t } = useTranslation();
  return (
    <Modal title={title} onClose={onCancel}>
      <div className="delete-confirmation">
        <p>{children}</p>
        <p>{t("This action cannot be undone.")}</p>
      </div>
      <div className="modal-actions">
        <button type="button" onClick={onCancel}>
          {t("Cancel")}
        </button>
        <button type="button" className="danger-action" onClick={onDelete}>
          {t(deleteLabel)}
        </button>
      </div>
    </Modal>
  );
}

function InvalidConfirmation({
  message,
  onCancel,
  onConfirm,
  title = "Session will be invalid",
}: {
  title?: string;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Modal title={t(title)} onClose={onCancel}>
      <p className="modal-copy">{message}</p>
      <div className="modal-actions">
        <button onClick={onCancel}>{t("Cancel")}</button>
        <button className="primary-action" onClick={onConfirm}>
          {t("Save Anyway")}
        </button>
      </div>
    </Modal>
  );
}

export function AcademicYearsPage() {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const years = useLiveQuery(() => readYearsAlphabetically(db), []) ?? [];
  const subjects = useLiveQuery(() => db.subjects.toArray(), []) ?? [];
  const sessions = useLiveQuery(() => db.sessions.toArray(), []) ?? [];
  const [archived, setArchivedState] = useState(managementViewState.academicYearsArchived);
  const setArchived = (value: boolean) => {
    managementViewState.academicYearsArchived = value;
    setArchivedState(value);
  };
  const [editing, setEditing] = useState<AcademicYear | null | undefined>();
  const [deleting, setDeleting] = useState<AcademicYear>();
  const [warning, setWarning] = useState("");
  const [pendingYear, setPendingYear] = useState<{ year: AcademicYear; count: number }>();
  const academicYearIsActive = (id: string) => activeTimerRelationship()?.academicYearId === id;
  const save = async (form: FormData) => {
    const name = String(form.get("name") ?? "").trim();
    if (!name) return;
    const year: AcademicYear = {
      id: editing?.id ?? "",
      name,
      startDate: String(form.get("startDate") || "") || undefined,
      endDate: String(form.get("endDate") || "") || undefined,
      archived: editing?.archived ?? false,
    };
    const count = await saveAcademicYearEdit(year);
    if (count) {
      setPendingYear({ year, count });
      return;
    }
    setEditing(undefined);
  };
  return (
    <main className="page">
      <PageHeader
        title={t("Academic Years")}
        subtitle={t("Organise subjects without forcing calendar ranges to be exclusive.")}
        action={
          <button className="primary-action" onClick={() => setEditing(null)}>
            <Plus size={17} /> {t("Add Academic Year")}
          </button>
        }
      />
      <div className="tabs">
        <button className={!archived ? "active" : ""} onClick={() => setArchived(false)}>
          {t("Active")}
        </button>
        <button className={archived ? "active" : ""} onClick={() => setArchived(true)}>
          {t("Archived")}
        </button>
      </div>
      <div className="data-list">
        {years
          .filter((y) => y.archived === archived)
          .map((year) => {
            const yearSubjects = subjects.filter((s) => s.academicYearId === year.id);
            const ids = new Set(yearSubjects.map((s) => s.id));
            const total = sessions
              .filter((s) => ids.has(s.subjectId) && !s.archived)
              .reduce((n, s) => n + s.focusedDurationSeconds, 0);
            return (
              <article className="data-row" key={year.id}>
                <CalendarDays />
                <div className="row-main">
                  <strong>{year.name}</strong>
                  <span>
                    {year.startDate ? `${dateText(year.startDate)} - ${dateText(year.endDate)}` : t("Flexible dates")}
                  </span>
                  <small>
                    {t("{{count}} subjects", { count: yearSubjects.length })} · {formatDuration(total)}
                  </small>
                </div>
                <div className="row-actions">
                  <button title={t("Edit")} onClick={() => setEditing(year)}>
                    <Pencil />
                  </button>
                  <button
                    title={t(year.archived ? "Restore" : "Archive")}
                    onClick={async () => {
                      if (!year.archived && academicYearIsActive(year.id)) {
                        setWarning(
                          t(
                            "This Academic Year is used by the active timer. Finish or discard the timer before archiving it.",
                          ),
                        );
                        return;
                      }
                      await setAcademicYearArchived(year.id, !year.archived);
                    }}
                  >
                    {year.archived ? <RotateCcw /> : <Archive />}
                  </button>
                  {canDeleteManagedRecord(year.archived, settings.allowDirectActiveDeletion) && (
                    <button
                      className="danger-icon"
                      title={t("Delete permanently")}
                      onClick={() =>
                        academicYearIsActive(year.id)
                          ? setWarning(
                              t(
                                "This Academic Year is used by the active timer. Finish or discard the timer before deleting it.",
                              ),
                            )
                          : setDeleting(year)
                      }
                    >
                      <Trash2 />
                    </button>
                  )}
                </div>
              </article>
            );
          })}
      </div>
      {!years.some((y) => y.archived === archived) && (
        <div className="empty-state">
          <h2>{t(archived ? "No archived Academic Years" : "Create your first Academic Year")}</h2>
          <p>
            {t(
              archived
                ? "Archived Academic Years will remain available here."
                : "Add a year, course period, or Independent Study.",
            )}
          </p>
        </div>
      )}
      {editing !== undefined && (
        <Modal title={t(editing ? "Edit Academic Year" : "New Academic Year")} onClose={() => setEditing(undefined)}>
          <form action={save} className="form">
            <label>
              {t("Name")}
              <input name="name" defaultValue={editing?.name} required autoFocus />
            </label>
            <div className="form-grid">
              <label>
                {t("Start date")}
                <input type="date" name="startDate" defaultValue={editing?.startDate} />
              </label>
              <label>
                {t("End date")}
                <input type="date" name="endDate" defaultValue={editing?.endDate} />
              </label>
            </div>
            <div className="modal-actions">
              <button type="button" onClick={() => setEditing(undefined)}>
                {t("Cancel")}
              </button>
              <button className="primary-action">{t("Save")}</button>
            </div>
          </form>
        </Modal>
      )}
      {deleting &&
        (() => {
          const affectedSubjects = subjects.filter((subject) => subject.academicYearId === deleting.id);
          const ids = new Set(affectedSubjects.map((subject) => subject.id));
          const affectedSessions = sessions.filter(
            (session) => session.academicYearId === deleting.id || ids.has(session.subjectId),
          );
          const total = affectedSessions.reduce((sum, session) => sum + session.focusedDurationSeconds, 0);
          return (
            <DeleteConfirmation
              title={t("Delete Academic Year?")}
              deleteLabel="Delete Academic Year and Data"
              onCancel={() => setDeleting(undefined)}
              onDelete={async () => {
                await deleteAcademicYearCascade(deleting.id);
                setDeleting(undefined);
              }}
            >
              {t("Permanently delete Academic Year with data", {
                name: deleting.name,
                subjects: affectedSubjects.length,
                sessions: affectedSessions.length,
                duration: formatDuration(total),
              })}
            </DeleteConfirmation>
          );
        })()}
      {warning && (
        <Modal title={t("Active timer protected")} onClose={() => setWarning("")}>
          <p>{warning}</p>
          <div className="modal-actions">
            <button className="primary-action" onClick={() => setWarning("")}>
              {t("OK")}
            </button>
          </div>
        </Modal>
      )}
      {pendingYear && (
        <InvalidConfirmation
          message={t(
            pendingYear.count === 1
              ? "1 session will become invalid. It will remain in History but will be excluded from Analytics."
              : "{{count}} sessions will become invalid. They will remain in History but will be excluded from Analytics.",
            { count: pendingYear.count },
          )}
          onCancel={() => setPendingYear(undefined)}
          onConfirm={async () => {
            await saveAcademicYearEdit(pendingYear.year, true);
            setPendingYear(undefined);
            setEditing(undefined);
          }}
        />
      )}
    </main>
  );
}

export function SubjectsPage() {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const years = useLiveQuery(() => db.academicYears.toArray(), []) ?? [];
  const subjects = useLiveQuery(() => readSubjectsAlphabetically(db), []) ?? [];
  const sessions = useLiveQuery(() => db.sessions.toArray(), []) ?? [];
  const [yearIds, setYearIds] = useState<string[]>([]);
  const [archived, setArchivedState] = useState(managementViewState.subjectsArchived);
  const setArchived = (value: boolean) => {
    managementViewState.subjectsArchived = value;
    setArchivedState(value);
  };
  const [deleting, setDeleting] = useState<Subject>();
  const [editing, setEditing] = useState<Subject | null | undefined>();
  const [editingYearId, setEditingYearId] = useState("");
  const openSubjectEditor = (subject: Subject | null) => {
    setEditing(subject);
    setEditingYearId(
      subject?.academicYearId ??
        (yearIds.length === 1 && years.some((year) => year.id === yearIds[0] && !year.archived) ? yearIds[0] : ""),
    );
  };
  const [warning, setWarning] = useState("");
  const save = async (form: FormData) => {
    const name = String(form.get("name") ?? "").trim();
    const academicYearId = String(form.get("year"));
    if (!name || !academicYearId) return;
    await saveSubject({
      id: editing?.id ?? "",
      academicYearId,
      name,
      color: editing?.color ?? nextSubjectColor(subjects, academicYearId),
      archived: editing?.archived ?? false,
    });
    setEditing(undefined);
  };
  const visible = subjects.filter(
    (s) =>
      (s.archived || Boolean(years.find((year) => year.id === s.academicYearId)?.archived)) === archived &&
      (!yearIds.length || yearIds.includes(s.academicYearId)),
  );
  const subjectIsActive = (id: string) => activeTimerRelationship()?.subjectId === id;
  return (
    <main className="page">
      <PageHeader
        title={t("Subjects")}
        subtitle={t("Manage lightweight subjects within each Academic Year.")}
        action={
          <button
            className="primary-action"
            disabled={!years.some((y) => !y.archived)}
            onClick={() => openSubjectEditor(null)}
          >
            <Plus /> {t("Add Subject")}
          </button>
        }
      />
      <div className="filter-bar">
        <label>
          {t("Academic Year")}
          <FilterSelect
            entity="academicYear"
            label={t("Academic Year")}
            multiple
            value={yearIds}
            onChange={setYearIds}
            options={[{ value: "", label: t("All Academic Years") }, ...academicYearOptions(years)]}
          />
        </label>
      </div>
      <div className="tabs">
        <button className={!archived ? "active" : ""} onClick={() => setArchived(false)}>
          {t("Active")}
        </button>
        <button className={archived ? "active" : ""} onClick={() => setArchived(true)}>
          {t("Archived")}
        </button>
      </div>
      <div className="data-list">
        {visible.map((subject) => {
          const used = sessions.filter((s) => s.subjectId === subject.id);
          const total = used.reduce((n, s) => n + s.focusedDurationSeconds, 0);
          const active = subjectIsActive(subject.id);
          return (
            <article className="data-row" key={subject.id}>
              <button
                type="button"
                className="list-dot subject-color-dot"
                style={{ background: subject.color }}
                title={t("Change color")}
                aria-label={t("Change color for {{subject}}", { subject: subject.name })}
                onClick={() =>
                  void cycleSubjectColor(subject.id).catch((error) => {
                    console.error(error);
                    showToast("Unable to change color. Please try again.", "error");
                  })
                }
              />
              <div className="row-main">
                <strong>{subject.name}</strong>
                <span>{years.find((y) => y.id === subject.academicYearId)?.name ?? t("Unknown Academic Year")}</span>
                <small>
                  {t("{{count}} sessions", { count: used.length })} · {formatDuration(total)}
                </small>
              </div>
              <div className="row-actions">
                <button title={t("Edit")} onClick={() => openSubjectEditor(subject)}>
                  <Pencil />
                </button>
                <button
                  title={t(
                    subject.archived || Boolean(years.find((year) => year.id === subject.academicYearId)?.archived)
                      ? "Restore"
                      : "Archive",
                  )}
                  disabled={Boolean(years.find((year) => year.id === subject.academicYearId)?.archived)}
                  onClick={() =>
                    active && !subject.archived
                      ? setWarning(
                          t(
                            "This Subject is used by the active timer. Finish or discard the timer before archiving it.",
                          ),
                        )
                      : void setSubjectArchived(subject.id, !subject.archived)
                  }
                >
                  {subject.archived || Boolean(years.find((year) => year.id === subject.academicYearId)?.archived) ? (
                    <RotateCcw />
                  ) : (
                    <Archive />
                  )}
                </button>
                {canDeleteManagedRecord(
                  subject.archived || Boolean(years.find((year) => year.id === subject.academicYearId)?.archived),
                  settings.allowDirectActiveDeletion,
                ) && (
                  <button
                    className="danger-icon"
                    title={t("Delete permanently")}
                    onClick={() =>
                      active
                        ? setWarning(
                            t(
                              "This Subject is used by the active timer. Finish or discard the timer before deleting it.",
                            ),
                          )
                        : setDeleting(subject)
                    }
                  >
                    <Trash2 />
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {!visible.length && (
        <div className="empty-state">
          <h2>{t(archived ? "No archived Subjects" : "Add a Subject to start tracking focus time")}</h2>
        </div>
      )}
      {editing !== undefined && (
        <Modal title={t(editing ? "Edit Subject" : "New Subject")} onClose={() => setEditing(undefined)}>
          <form action={save} className="form">
            <label>
              {t("Name")}
              <input name="name" defaultValue={editing?.name} required autoFocus />
            </label>
            <label>
              {t("Academic Year")}
              <FilterSelect
                entity="academicYear"
                label={t("Academic Year")}
                name="year"
                value={editingYearId}
                onChange={setEditingYearId}
                options={[
                  { value: "", label: t("Choose Academic Year") },
                  ...academicYearOptions(years.filter((year) => !year.archived || year.id === editing?.academicYearId)),
                ]}
              />
            </label>
            <div className="modal-actions">
              <button type="button" onClick={() => setEditing(undefined)}>
                {t("Cancel")}
              </button>
              <button className="primary-action" disabled={!editingYearId}>
                {t("Save")}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {deleting &&
        (() => {
          const affected = sessions.filter((session) => session.subjectId === deleting.id);
          const total = affected.reduce((sum, session) => sum + session.focusedDurationSeconds, 0);
          return (
            <DeleteConfirmation
              title={t("Delete Subject?")}
              deleteLabel="Delete Subject and Data"
              onCancel={() => setDeleting(undefined)}
              onDelete={async () => {
                await deleteSubjectCascade(deleting.id);
                setDeleting(undefined);
              }}
            >
              {t("Permanently delete Subject with data", {
                name: deleting.name,
                sessions: affected.length,
                duration: formatDuration(total),
              })}
            </DeleteConfirmation>
          );
        })()}
      {warning && (
        <Modal title={t("Active timer protected")} onClose={() => setWarning("")}>
          <p>{warning}</p>
          <div className="modal-actions">
            <button className="primary-action" onClick={() => setWarning("")}>
              {t("OK")}
            </button>
          </div>
        </Modal>
      )}
    </main>
  );
}

const timeInputValue = (stamp: number) => new Date(stamp).toTimeString().slice(0, 5);
const durationInputFields = (seconds: number) => {
  const parts = durationParts(seconds);
  return { hours: String(parts.hours).padStart(2, "0"), minutes: String(parts.minutes).padStart(2, "0") };
};

function SessionEndField({
  manual,
  end,
  onEnd,
  offset,
  onOffset,
  decrementAllowed,
  valid,
}: {
  manual: boolean;
  end: string;
  onEnd: (value: string) => void;
  offset: number;
  onOffset: (value: number) => void;
  decrementAllowed: boolean;
  valid: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    increment = useRef<HTMLButtonElement>(null);
  const label = offset === 0 ? t("Same day") : t(offset === 1 ? "+1 day" : "+{{count}} days", { count: offset });
  useEffect(() => {
    if (!open) return;
    increment.current?.focus();
    const outside = (event: PointerEvent) => {
      if (!host.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", key, true);
    };
  }, [open]);
  return (
    <div
      className="session-end-control"
      ref={host}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
      }}
    >
      <div className="session-end-heading">
        {manual ? (
          <button
            type="button"
            className="end-day-label tooltip-host"
            ref={trigger}
            onClick={() => setOpen(!open)}
            aria-label={t("Change end day")}
            aria-haspopup="dialog"
            aria-expanded={open}
          >
            {t("End")}
            <span className="focus-tooltip" role="tooltip">
              {t("Change end day")}
            </span>
          </button>
        ) : (
          <span>{t("End")}</span>
        )}
        {offset > 0 && <small className="muted"> · {label}</small>}
      </div>
      <input
        aria-label={t("End")}
        type="time"
        value={end}
        onChange={(event) => onEnd(event.target.value)}
        readOnly={!manual}
        tabIndex={manual ? undefined : -1}
        className={`${!valid ? "input-error" : ""} ${manual ? "" : "session-end-readonly"}`}
        required
      />
      {open && manual && (
        <div role="dialog" aria-label={t("End date")} className="end-day-popover">
          <strong>{t("End date")}</strong>
          <div>
            <button
              type="button"
              disabled={!decrementAllowed}
              aria-label={t("Previous day")}
              onClick={() => onOffset(offset - 1)}
            >
              −
            </button>
            <span aria-live="polite">{label}</span>
            <button
              type="button"
              ref={increment}
              disabled={offset >= 9}
              aria-label={t("Next day")}
              onClick={() => onOffset(Math.min(9, offset + 1))}
            >
              +
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SessionEditor({
  session,
  years,
  subjects,
  onClose,
}: {
  session: FocusSession | null;
  years: AcademicYear[];
  subjects: Subject[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const initialYearId = session?.academicYearId ?? "";
  const initialSubjectId =
    session?.subjectId ??
    subjects.find((subject) => subject.academicYearId === initialYearId && !subject.archived)?.id ??
    "";
  const [openedAt] = useState(() => Date.now());
  const initialEnd = session?.endTime ?? openedAt;
  // This editor has one date field; keep the suggested start on that same day.
  const initialStart = session?.startTime ?? Math.max(new Date(openedAt).setHours(0, 0, 0, 0), openedAt - 3_600_000);
  const manual = !session || session.manual === true;
  const [academicYearId, setAcademicYearId] = useState(initialYearId);
  const [subjectId, setSubjectId] = useState(initialSubjectId);
  const [date, setDate] = useState(localDateInputValue(initialStart));
  const [start, setStart] = useState(timeInputValue(initialStart));
  const [end, setEnd] = useState(timeInputValue(initialEnd));
  const [explicitOffset, setExplicitOffset] = useState<number | undefined>(() => {
    if (!session) return undefined;
    const stored = sessionDayOffset(session.startTime, session.endTime);
    return stored === manualEndOffset(timeInputValue(session.startTime), timeInputValue(session.endTime))
      ? undefined
      : stored;
  });
  const dayOffset = manualEndOffset(start, end, explicitOffset);
  const [note, setNote] = useState(session?.note ?? "");
  const [invalidPending, setInvalidPending] = useState(false);
  const [saveError, setSaveError] = useState("");
  const availableSubjects = alphabetical(
    subjects.filter((subject) => subject.academicYearId === academicYearId && (session || !subject.archived)),
  );
  const entered = editedSessionTimes(date, start, end, session ?? undefined, dayOffset);
  const { startTime, endTime } =
    session && !manual ? sessionEditTiming(session, entered.startTime, entered.endTime) : entered;
  const validSpan =
    Number.isFinite(startTime) &&
    Number.isFinite(endTime) &&
    endTime > startTime &&
    Number.isInteger(dayOffset) &&
    dayOffset >= 0;
  const focusedDurationSeconds = manual ? sessionSpanSeconds(startTime, endTime) : session!.focusedDurationSeconds;
  const duration = durationInputFields(focusedDurationSeconds);
  const relationshipValid = Boolean(
    academicYearId &&
    subjectId &&
    availableSubjects.some((subject) => subject.id === subjectId) &&
    (session || years.some((year) => year.id === academicYearId && !year.archived)),
  );
  const save = async (event?: React.FormEvent<HTMLFormElement>, confirmed = false) => {
    event?.preventDefault();
    setSaveError("");
    if (!academicYearId) {
      setSaveError(t("Choose an Academic Year."));
      return;
    }
    if (!relationshipValid) {
      setSaveError(t("Choose a Subject from the selected Academic Year."));
      return;
    }
    if (!validSpan) {
      setSaveError(t("End time must be after start time."));
      return;
    }
    if (!noteMetrics(note).valid) return;
    const reason = sessionInvalidReason(
      { startTime, endTime },
      years.find((year) => year.id === academicYearId),
    );
    const previousReason =
      session &&
      sessionInvalidReason(
        session,
        years.find((year) => year.id === session.academicYearId),
      );
    if (!confirmed && reason && reason !== previousReason) {
      setInvalidPending(true);
      return;
    }
    setInvalidPending(false);
    try {
      if (session) {
        const result = await saveSessionEdit(
          session.id,
          {
            academicYearId,
            subjectId,
            startTime,
            endTime,

            note,
          },
          { invalid: confirmed },
        );
        if (result !== "saved") {
          if (result === "invalid") setInvalidPending(true);
          return;
        }
      } else {
        const subject = subjects.find((item) => item.id === subjectId)!;
        const academicYear = years.find((item) => item.id === academicYearId)!;
        await createSession({
          subject,
          academicYear,
          startTime,
          endTime,

          note,
        });
      }
      onClose();
    } catch (error) {
      setSaveError(t(error instanceof Error ? error.message : "Invalid session"));
    }
  };

  return (
    <>
      {invalidPending && (
        <InvalidConfirmation
          message={t(
            "This session falls outside its Academic Year's date range. It will remain in History but will not be included in Analytics.",
          )}
          onCancel={() => setInvalidPending(false)}
          onConfirm={() => save(undefined, true)}
        />
      )}
      <form onSubmit={save} className="form session-editor">
        <label>
          {t("Academic Year")}
          <FilterSelect
            entity="academicYear"
            label={t("Academic Year")}
            value={academicYearId}
            onChange={(next) => {
              setAcademicYearId(next);
              if (!subjects.some((subject) => subject.id === subjectId && subject.academicYearId === next))
                setSubjectId("");
            }}
            options={[
              { value: "", label: t("Choose Academic Year") },
              ...academicYearOptions(years.filter((year) => session || !year.archived)),
            ]}
          />
        </label>
        <label>
          {t("Subject")}
          <FilterSelect
            entity="subject"
            label={t("Subject")}
            value={subjectId}
            onChange={setSubjectId}
            disabled={!academicYearId}
            options={[
              { value: "", label: t("Choose Subject") },
              ...subjectOptions(years, availableSubjects, academicYearId ? [academicYearId] : []),
            ]}
          />
        </label>
        <label>
          {t("Date")}
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
        </label>
        <div className="form-grid">
          <label>
            {t("Start")}
            <input type="time" value={start} onChange={(event) => setStart(event.target.value)} required />
          </label>
          <SessionEndField
            manual={manual}
            end={manual ? end : timeInputValue(endTime)}
            onEnd={setEnd}
            offset={manual ? dayOffset : sessionDayOffset(startTime, endTime)}
            onOffset={setExplicitOffset}
            decrementAllowed={
              dayOffset > 0 && editedSessionTimes(date, start, end, undefined, dayOffset - 1).endTime > startTime
            }
            valid={validSpan}
          />
        </div>
        {!validSpan && <p className="field-error">{t("End time must be after start time.")}</p>}
        {!manual && (
          <div className="duration-field">
            <span className="field-label">{t("Focus time")}</span>
            <div className="duration-editor-fields is-locked">
              {(["hours", "minutes"] as const).map((part) => (
                <div className="duration-part" key={part}>
                  <input aria-label={t(part === "hours" ? "Hours" : "Minutes")} value={duration[part]} readOnly />
                  <small>{t(part === "hours" ? "HH" : "MM")}</small>
                </div>
              ))}
            </div>
          </div>
        )}
        <label>
          {t("Note")}
          <NoteEditor value={note} onChange={setNote} />
        </label>
        {saveError && <p className="field-error">{saveError}</p>}
        <div className="modal-actions">
          <button type="button" data-note-exit onClick={onClose}>
            {t("Cancel")}
          </button>
          <button className="primary-action" disabled={!noteMetrics(note).valid || !relationshipValid || !validSpan}>
            {t("Save")}
          </button>
        </div>
      </form>
    </>
  );
}

export function HistoryPage({ initialInvalid = false }: { initialInvalid?: boolean }) {
  const { t } = useTranslation();
  const { settings, loaded: settingsLoaded, setSetting } = useSettings();
  const snapshot = useLiveQuery(async () => {
    if (!settingsLoaded) return;
    return readHistorySnapshot(db);
  }, [settingsLoaded]);
  const loadedYears = snapshot?.years,
    loadedSubjects = snapshot?.subjects,
    loadedSessions = snapshot?.sessions;
  const years = loadedYears ?? [],
    subjects = loadedSubjects ?? [],
    sessions = loadedSessions ?? [];
  const [status, setStatusState] = useState(initialInvalid ? "invalid" : managementViewState.historyStatus);
  const setStatus = (value: string) => {
    managementViewState.historyStatus = value;
    setStatusState(value);
  };
  const [scope, setScope] = useState<LinkedScope>(ALL_SCOPE);
  const yearIds = scope.yearIds;
  const subjectIds = useMemo(() => subjectSelection(scope, subjects), [scope, loadedSubjects]);
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<FocusSession | null | undefined>();
  const [deleting, setDeleting] = useState<FocusSession>();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [moving, setMoving] = useState(false);
  const activeYears = orderedAcademicYears(years).filter((year) => !year.archived);
  const [moveYearId, setMoveYearId] = useState("");
  const [moveSubjectId, setMoveSubjectId] = useState("");
  const pageSize = settings.historyPageSize;
  const [matchCase, setMatchCase] = useState(false);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [viewingNote, setViewingNote] = useState<{ note: string; anchor: HTMLElement }>();
  useEffect(() => {
    if (!query.trim()) {
      setSearch("");
      return;
    }
    const timeout = window.setTimeout(() => setSearch(query), 200);
    return () => window.clearTimeout(timeout);
  }, [query]);
  const terms = useMemo(() => noteSearchTerms(search, matchCase), [search, matchCase]);
  const readable = useMemo(
    () =>
      new Map(
        sessions.map((session) => [
          session.id,
          matchCase ? readableNote(session.note ?? "") : readableNote(session.note ?? "").toLocaleLowerCase(),
        ]),
      ),
    [sessions, matchCase],
  );
  const invalid = useMemo(
    () =>
      new Map(
        sessions.map((session) => [
          session.id,
          sessionInvalidReason(
            session,
            years.find((year) => year.id === session.academicYearId),
          ),
        ]),
      ),
    [sessions, years],
  );
  const invalidCount = sessions.filter(
    (session) => inHistoryScope(session, { yearIds, subjectIds }) && invalid.get(session.id),
  ).length;
  useEffect(() => {
    if (loadedYears && loadedSessions && historyStatusAfterScope(status, invalidCount) !== status) {
      setStatus("all");
      setPage(0);
    }
  }, [status, invalidCount, loadedSessions, loadedYears]);
  const filtered = useMemo(
    () =>
      sessions.filter(
        (session) =>
          matchesHistoryStatus(
            status,
            Boolean(invalid.get(session.id)),
            isSessionEffectivelyArchived(session, subjects, years),
          ) &&
          inHistoryScope(session, { yearIds, subjectIds }) &&
          terms.every((term) => readable.get(session.id)?.includes(term)),
      ),
    [sessions, status, yearIds, subjectIds, subjects, years, terms, readable, invalid],
  );
  const initialViewShown = useRef(false);
  const dataReady =
    settingsLoaded && loadedYears !== undefined && loadedSubjects !== undefined && loadedSessions !== undefined;
  const ready = dataReady && (initialViewShown.current || historyStatusAfterScope(status, invalidCount) === status);
  useEffect(() => {
    if (ready) initialViewShown.current = true;
  }, [ready]);
  const pagination = historyPagination(filtered.length, pageSize, page);
  const [pageDraft, setPageDraft] = useState("1");
  useEffect(() => {
    setPage(pagination.page);
    setPageDraft(String(pagination.page + 1));
  }, [pagination.page, pageSize, yearIds, subjectIds, status, search]);
  const commitPage = () => {
    const next = enteredHistoryPage(pageDraft, pagination.page, pagination.pages);
    setPage(next);
    setPageDraft(String(next + 1));
  };
  if (!ready) return <HistoryLoading searchOpen={searchOpen} />;
  return (
    <main className="page">
      <PageHeader
        title={t("History")}
        subtitle={t("Review and correct completed focus sessions.")}
        action={
          <div className="header-actions">
            <button
              className="secondary-action"
              onClick={() => {
                setSelecting((value) => !value);
                setSelected(new Set());
              }}
            >
              {t(selecting ? "Cancel" : "Select")}
            </button>
            <button
              className="primary-action"
              disabled={
                !subjects.some(
                  (subject) =>
                    !subject.archived && years.some((year) => year.id === subject.academicYearId && !year.archived),
                )
              }
              onClick={() => setEditing(null)}
            >
              <Plus /> {t("Add Session")}
            </button>
          </div>
        }
      />
      <div className="filter-bar history-filters">
        <LinkedScopeSelectors
          years={years}
          subjects={subjects}
          value={scope}
          onChange={(next) => {
            setScope(next);
            setPage(0);
          }}
        />
        <label>
          {t("Status")}
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(0);
            }}
          >
            <option value="active">{t("Active")}</option>
            <option value="archived">{t("Archived")}</option>
            <option value="all">{t("All")}</option>
            {invalidCount > 0 && <option value="invalid">{t("Invalid")}</option>}
          </select>
        </label>
        {invalidCount > 0 && (
          <button
            className="invalid-session-indicator"
            title={t(invalidCount === 1 ? "1 invalid session" : "{{count}} invalid sessions", { count: invalidCount })}
            aria-label={t(invalidCount === 1 ? "1 invalid session" : "{{count}} invalid sessions", {
              count: invalidCount,
            })}
            onClick={() => {
              setStatus("invalid");
              setPage(0);
            }}
          >
            <TriangleAlert size={17} />
            {invalidCount}
          </button>
        )}
        <div className={`history-note-search ${searchOpen ? "is-open" : ""}`}>
          {searchOpen ? (
            <div
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node) && !query.trim()) setSearchOpen(false);
              }}
            >
              <Search size={16} />
              <input
                autoFocus
                aria-label={t("Search notes")}
                placeholder={t("Search notes")}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(0);
                }}
              />
              <button
                aria-label={t("Match case")}
                title={t("Match case")}
                aria-pressed={matchCase}
                onClick={() => {
                  setMatchCase(!matchCase);
                  setPage(0);
                }}
              >
                <CaseSensitive size={18} />
              </button>
              {query && (
                <button
                  aria-label={t("Clear note search")}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setQuery("");
                    setSearch("");
                    setPage(0);
                  }}
                >
                  <X size={16} />
                </button>
              )}
            </div>
          ) : (
            <button aria-label={t("Search notes")} title={t("Search notes")} onClick={() => setSearchOpen(true)}>
              <Search size={18} />
            </button>
          )}
        </div>
      </div>
      {selecting && (
        <div className="selection-toolbar">
          <strong>{t("{{count}} selected", { count: selected.size })}</strong>
          <button onClick={() => setSelected(new Set(filtered.map((session) => session.id)))}>{t("Select all")}</button>
          <button
            disabled={!selected.size}
            onClick={() => {
              const first = activeYears[0];
              setMoveYearId(first?.id ?? "");
              setMoveSubjectId("");
              setMoving(true);
            }}
          >
            {t("Move")}
          </button>
          <button className="danger-outline" disabled={!selected.size} onClick={() => setConfirmBulk(true)}>
            <Trash2 /> {t("Delete")}
          </button>
          <button
            onClick={() => {
              setSelecting(false);
              setSelected(new Set());
            }}
          >
            {t("Cancel")}
          </button>
        </div>
      )}
      <div className="history-table">
        <div className="history-head">
          <span>{t("Date")}</span>
          <span>{t("Time")}</span>
          <span>{t("Duration")}</span>
          <span>{t("Subject")}</span>
          <span>{t("Academic Year")}</span>
          <span className="history-note-column">{t("Notes")}</span>
          <span>{t("Status")}</span>
          <span />
        </div>
        {filtered.slice(pagination.page * pageSize, (pagination.page + 1) * pageSize).map((s) => (
          <div className="history-row" key={s.id}>
            <span>
              {selecting && (
                <input
                  className="history-checkbox"
                  type="checkbox"
                  aria-label={t("Select Session {{id}}", { id: s.id })}
                  checked={selected.has(s.id)}
                  onChange={() =>
                    setSelected((current) => {
                      const next = new Set(current);
                      if (next.has(s.id)) next.delete(s.id);
                      else next.add(s.id);
                      return next;
                    })
                  }
                />
              )}{" "}
              {new Date(s.startTime).toLocaleDateString(localeCode(), {
                day: "numeric",
                month: "short",
                year: "numeric",
              })}
            </span>
            <span>
              {new Date(s.startTime).toLocaleTimeString(localeCode(), {
                hour: "2-digit",
                minute: "2-digit",
              })}{" "}
              -{" "}
              {new Date(s.endTime).toLocaleTimeString(localeCode(), {
                hour: "2-digit",
                minute: "2-digit",
              })}
              {localDateInputValue(s.endTime) !== localDateInputValue(s.startTime) && (
                <small className="overnight-label">
                  {" "}
                  ·{" "}
                  <span className="day-offset-full">
                    {t(sessionDayOffset(s.startTime, s.endTime) === 1 ? "+1 day" : "+{{count}} days", {
                      count: sessionDayOffset(s.startTime, s.endTime),
                    })}
                  </span>
                  <span
                    className="day-offset-compact"
                    aria-label={t("+{{count}} days", { count: sessionDayOffset(s.startTime, s.endTime) })}
                  >
                    +{sessionDayOffset(s.startTime, s.endTime)}
                  </span>
                </small>
              )}
            </span>
            <strong>{formatDuration(s.focusedDurationSeconds)}</strong>
            <TruncatedValue value={s.subjectName} />
            <TruncatedValue value={s.academicYearName} />
            <NotePreview note={s.note ?? ""} />
            <span
              title={invalid.get(s.id) ? t(invalidReasonText[invalid.get(s.id)!]) : undefined}
              tabIndex={invalid.get(s.id) ? 0 : undefined}
              aria-label={invalid.get(s.id) ? t(invalidReasonText[invalid.get(s.id)!]) : undefined}
              className={`badge ${invalid.get(s.id) ? "badge--invalid" : isSessionEffectivelyArchived(s, subjects, years) ? "badge--archived" : ""}`}
            >
              {t(
                invalid.get(s.id)
                  ? "Invalid"
                  : isSessionEffectivelyArchived(s, subjects, years)
                    ? "Archived"
                    : "Active",
              )}
            </span>
            <div className="row-actions history-actions">
              <span className="history-note-slot">
                {s.note?.trim() && (
                  <button
                    className="note-indicator"
                    aria-label={t("View note")}
                    title={t("View note")}
                    onClick={(event) => setViewingNote({ note: s.note!, anchor: event.currentTarget })}
                  >
                    <FileText />
                  </button>
                )}
              </span>
              <button title={t("Edit")} onClick={() => setEditing(s)}>
                <Pencil />
              </button>
              <button className="danger-icon" title={t("Delete permanently")} onClick={() => setDeleting(s)}>
                <Trash2 />
              </button>
            </div>
            {terms.length > 0 && <NoteSnippet note={s.note ?? ""} terms={terms} matchCase={matchCase} />}
          </div>
        ))}
      </div>
      {!filtered.length && (
        <div className="empty-state">
          <h2>
            {t(
              yearIds.length || subjectIds.length || terms.length || sessions.length
                ? "No results found"
                : status === "archived"
                  ? "No archived sessions"
                  : "Completed focus sessions will appear here",
            )}
          </h2>
        </div>
      )}
      <div className="pagination history-pagination">
        <span>
          {t("Showing {{start}}–{{end}} of {{total}} sessions", {
            start: pagination.start,
            end: pagination.end,
            total: filtered.length,
          })}
        </span>
        <div className="history-pagination-controls">
          <label>
            {t("Rows per page")}
            <select
              value={pageSize}
              onChange={(event) => void setSetting("historyPageSize", Number(event.target.value) as 10 | 25 | 50)}
            >
              {[10, 25, 50].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          <button disabled={!pagination.page} onClick={() => setPage(pagination.page - 1)}>
            {t("Previous")}
          </button>
          <label>
            {t("Page")}
            <input
              aria-label={t("Page")}
              inputMode="numeric"
              value={pageDraft}
              onChange={(event) => setPageDraft(event.target.value)}
              onBlur={commitPage}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  commitPage();
                  event.currentTarget.blur();
                }
              }}
            />
            {t("of {{pages}}", { pages: pagination.pages })}
          </label>
          <button disabled={pagination.page === pagination.pages - 1} onClick={() => setPage(pagination.page + 1)}>
            {t("Next")}
          </button>
        </div>
      </div>
      {viewingNote && <NoteViewer {...viewingNote} onClose={() => setViewingNote(undefined)} />}
      {editing !== undefined && (
        <Modal title={t(editing ? "Edit Session" : "Add Session")} onClose={() => setEditing(undefined)}>
          <SessionEditor session={editing} years={years} subjects={subjects} onClose={() => setEditing(undefined)} />
        </Modal>
      )}
      {deleting && (
        <DeleteConfirmation
          title={t("Delete Session?")}
          onCancel={() => setDeleting(undefined)}
          onDelete={async () => {
            await deleteSession(deleting.id);
            setDeleting(undefined);
          }}
        >
          {t("This permanently removes this Session.")}
        </DeleteConfirmation>
      )}
      {confirmBulk && (
        <DeleteConfirmation
          title={t("Delete {{count}} Sessions?", { count: selected.size })}
          deleteLabel={t("Delete {{count}} Sessions", { count: selected.size })}
          onCancel={() => setConfirmBulk(false)}
          onDelete={async () => {
            await deleteSessions([...selected]);
            setSelected(new Set());
            setSelecting(false);
            setConfirmBulk(false);
          }}
        >
          {t("These Sessions will be permanently removed.")}
        </DeleteConfirmation>
      )}
      {moving && (
        <Modal title={t("Move {{count}} Sessions", { count: selected.size })} onClose={() => setMoving(false)}>
          <div className="form">
            <label>
              {t("Academic Year")}
              <FilterSelect
                entity="academicYear"
                label={t("Academic Year")}
                value={moveYearId}
                onChange={(next) => {
                  setMoveYearId(next);
                  if (
                    !subjects.some(
                      (subject) => subject.id === moveSubjectId && subject.academicYearId === next && !subject.archived,
                    )
                  )
                    setMoveSubjectId("");
                }}
                options={[{ value: "", label: t("Choose Academic Year") }, ...academicYearOptions(activeYears)]}
              />
            </label>
            <label>
              {t("Subject")}
              <FilterSelect
                entity="subject"
                label={t("Subject")}
                value={moveSubjectId}
                disabled={!moveYearId}
                onChange={setMoveSubjectId}
                options={[
                  { value: "", label: t("Choose Subject") },
                  ...subjectOptions(
                    activeYears,
                    subjects.filter((subject) => !subject.archived),
                    moveYearId ? [moveYearId] : [],
                  ),
                ]}
              />
            </label>
            <p>{t("Only the Subject and Academic Year assignment will change.")}</p>
            <div className="modal-actions">
              <button onClick={() => setMoving(false)}>{t("Cancel")}</button>
              <button
                className="primary-action"
                disabled={!moveSubjectId}
                onClick={async () => {
                  await moveSessions([...selected], moveSubjectId);
                  setMoving(false);
                  setSelected(new Set());
                  setSelecting(false);
                }}
              >
                {t("Move Sessions")}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </main>
  );
}

function TruncatedValue({ value }: { value: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [truncated, setTruncated] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setTruncated(element.scrollWidth > element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [value]);
  return (
    <span
      ref={ref}
      className="history-truncated"
      tabIndex={truncated ? 0 : undefined}
      title={truncated ? value : undefined}
    >
      {value}
    </span>
  );
}
