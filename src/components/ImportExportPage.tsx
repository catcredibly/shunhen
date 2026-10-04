import { readAnalyticsSnapshot } from "../storage/queries";
import { FilterSelect } from "./FilterSelect";
import { academicYearOptions } from "../selectorOptions";
import { showToast } from "../toasts";
import { useState } from "react";
import { useLiveQuery } from "../hooks/useLiveQuery";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  DatabaseBackup,
  Download,
  FileSpreadsheet,
  History,
  Upload,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { db } from "../db";
import type { AcademicYear } from "../types";
import { localeCode } from "../i18n";
import { analyzeBackup, backupFilename, parseBackupText, restoreBackup } from "../importExport/backup";
import { exportSessionsCsv, importCsvPreview, previewCsv } from "../importExport/csv";
import { exportFullBackup } from "../importExport/exportBackup";
import { chooseTextFile, saveTextFile } from "../importExport/files";
import type {
  BackupAnalysis,
  ConflictPolicy,
  CsvMapping,
  CsvPreview,
  ImportSummary,
  RestoreMode,
} from "../importExport/types";

type PreviewState =
  | { kind: "json"; analysis: BackupAnalysis; name: string }
  | { kind: "csv"; preview: CsvPreview; text: string; name: string };
const emptySummary: ImportSummary = {
  academicYearsCreated: 0,
  subjectsCreated: 0,
  sessionsImported: 0,
  duplicatesSkipped: 0,
  conflicts: 0,
  invalidRowsSkipped: 0,
};
const activeTimer = () => {
  try {
    const timer = JSON.parse(localStorage.getItem("focus.activeTimer") ?? "null");
    return Boolean(timer?.running || timer?.paused || (timer?.sessionId && timer?.startedAt));
  } catch {
    return false;
  }
};

export function ImportExportPage({
  onNavigate,
  onViewInvalid,
}: {
  onNavigate: (page: string) => void;
  onViewInvalid: () => void;
}) {
  const { t } = useTranslation();
  const years = useLiveQuery(() => db.academicYears.toArray(), []) ?? [];
  const [preview, setPreview] = useState<PreviewState>();
  const [result, setResult] = useState<ImportSummary>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<RestoreMode>("merge");
  const [policy, setPolicy] = useState<ConflictPolicy>("keep-existing");
  const [destinationYear, setDestinationYear] = useState("");
  const translateError = (reason: unknown, fallback: string) => t(reason instanceof Error ? reason.message : fallback);

  const exportJson = async () => {
    setBusy(true);
    setError("");
    try {
      await exportFullBackup();
    } catch (reason) {
      setError(translateError(reason, "Backup failed."));
    } finally {
      setBusy(false);
    }
  };
  const exportCsv = async () => {
    setBusy(true);
    setError("");
    try {
      const sessions = (await readAnalyticsSnapshot(db)).sessions;
      const date = backupFilename().replace("shunhen-backup-", "").replace(".json", "");
      if (await saveTextFile(`shunhen-sessions-${date}.csv`, exportSessionsCsv(sessions), "csv"))
        showToast("CSV exported successfully");
    } catch (reason) {
      setError(translateError(reason, "CSV export failed."));
    } finally {
      setBusy(false);
    }
  };
  const inspect = async (file: { name: string; text: string }) => {
    setError("");
    setResult(undefined);
    try {
      if (!/\.(json|csv)$/i.test(file.name)) throw new Error("Choose a .json or .csv file.");
      if (/\.json$/i.test(file.name))
        setPreview({ kind: "json", analysis: await analyzeBackup(parseBackupText(file.text)), name: file.name });
      else
        setPreview({
          kind: "csv",
          preview: await previewCsv(file.text, undefined, destinationYear || undefined),
          text: file.text,
          name: file.name,
        });
    } catch (reason) {
      setPreview(undefined);
      setError(translateError(reason, "The file could not be read."));
    }
  };
  const choose = async () => {
    const file = await chooseTextFile();
    if (file) await inspect(file);
  };
  const remap = async (mapping: CsvMapping, destination = destinationYear) => {
    if (preview?.kind !== "csv") return;
    setDestinationYear(destination);
    setPreview({ ...preview, preview: await previewCsv(preview.text, mapping, destination || undefined) });
  };
  const apply = async () => {
    if (!preview) return;
    if (activeTimer()) {
      setError(t("Finish or stop the current timer before importing app data."));
      return;
    }
    if (
      preview.kind === "json" &&
      mode === "replace" &&
      !confirm(t("Replace all persistent Shunhen data with this backup? This cannot be undone."))
    )
      return;
    setBusy(true);
    setError("");
    try {
      const summary =
        preview.kind === "json"
          ? await restoreBackup(preview.analysis.backup, mode, policy)
          : await importCsvPreview(preview.preview);
      setResult({ ...emptySummary, ...summary });
      setPreview(undefined);
    } catch (reason) {
      setError(translateError(reason, "Import failed. No partial changes were kept."));
    } finally {
      setBusy(false);
    }
  };

  if (result)
    return (
      <main className="page import-page">
        <header className="page-header">
          <div>
            <h1>{t("Import complete")}</h1>
            <p>{t("Your Shunhen data was updated in one transaction.")}</p>
          </div>
        </header>
        <section className="result-panel">
          <CheckCircle2 />
          <div className="result-grid">
            <span>
              {t("Academic Years created")}
              <strong>{result.academicYearsCreated}</strong>
            </span>
            <span>
              {t("Subjects created")}
              <strong>{result.subjectsCreated}</strong>
            </span>
            <span>
              {t("Sessions imported")}
              <strong>{result.sessionsImported}</strong>
            </span>
            <span>
              {t("Duplicates skipped")}
              <strong>{result.duplicatesSkipped}</strong>
            </span>
            <span>
              {t("Invalid rows skipped")}
              <strong>{result.invalidRowsSkipped}</strong>
            </span>
            <span>
              {t("Conflicts")}
              <strong>{result.conflicts}</strong>
            </span>
          </div>
          {!!result.invalidSessionsImported && (
            <p>
              {t(
                result.invalidSessionsImported === 1
                  ? "Imported 1 invalid session."
                  : "Imported {{count}} invalid sessions.",
                { count: result.invalidSessionsImported },
              )}
            </p>
          )}
          <div className="import-actions">
            {!!result.invalidSessionsImported && (
              <button className="secondary-action" onClick={onViewInvalid}>
                {t("View invalid sessions")}
              </button>
            )}
            <button className="secondary-action" onClick={() => setResult(undefined)}>
              <ArrowLeft /> {t("Import / Export")}
            </button>
            <button className="primary-action" onClick={() => onNavigate("History")}>
              <History /> {t("View History")}
            </button>
          </div>
        </section>
      </main>
    );
  if (preview)
    return (
      <main className="page import-page">
        <header className="page-header">
          <div>
            <h1>{t("Review import")}</h1>
            <p>{preview.name}</p>
          </div>
          <button className="secondary-action" onClick={() => setPreview(undefined)}>
            <ArrowLeft /> {t("Choose another file")}
          </button>
        </header>
        {preview.kind === "json" ? (
          <JsonPreview
            analysis={preview.analysis}
            mode={mode}
            setMode={setMode}
            policy={policy}
            setPolicy={setPolicy}
          />
        ) : (
          <CsvPreviewPanel
            data={preview.preview}
            years={years}
            destinationYear={destinationYear}
            onDestination={(id) => remap(preview.preview.mapping, id)}
            onMapping={(field, column) => remap({ ...preview.preview.mapping, [field]: column || undefined })}
          />
        )}{" "}
        {error && (
          <div className="notice notice--error">
            <AlertTriangle />
            {error}
          </div>
        )}
        <div className="confirm-bar">
          <span>{t("Nothing changes until you confirm.")}</span>
          <button className="primary-action" disabled={busy} onClick={apply}>
            {t(busy ? "Importing..." : "Confirm import")}
          </button>
        </div>
      </main>
    );
  return (
    <main
      className="page import-page"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const file = event.dataTransfer.files[0];
        if (file) void file.text().then((text) => inspect({ name: file.name, text }));
      }}
    >
      <header className="page-header">
        <div>
          <h1>{t("Import / Export")}</h1>
          <p>{t("Back up your data or import data from another source.")}</p>
        </div>
      </header>
      {error && (
        <div className="notice notice--error">
          <AlertTriangle />
          {error}
        </div>
      )}
      <div className="transfer-grid">
        <section className="transfer-section">
          <h2>{t("Export")}</h2>
          <article className="transfer-item">
            <DatabaseBackup />
            <div>
              <h3>{t("Full Backup (JSON)")}</h3>
              <p>{t("Complete backup of Academic Years, Subjects, Sessions, and Settings.")}</p>
            </div>
            <button className="primary-action" disabled={busy} onClick={exportJson}>
              <Download /> {t("Export backup")}
            </button>
          </article>
          <article className="transfer-item">
            <FileSpreadsheet />
            <div>
              <h3>{t("Sessions (CSV)")}</h3>
              <p>{t("Spreadsheet-friendly complete Session history for Excel and similar tools.")}</p>
            </div>
            <button className="secondary-action" disabled={busy} onClick={exportCsv}>
              <Download /> {t("Export CSV")}
            </button>
          </article>
        </section>
        <section className="transfer-section">
          <h2>{t("Import")}</h2>
          <div className="drop-zone">
            <Upload />
            <h3>{t("Import Data")}</h3>
            <p>{t("Restore a Shunhen backup or import Session records from CSV.")}</p>
            <button className="secondary-action" disabled={busy} onClick={choose}>
              {t("Choose file")}
            </button>
            <small>{t("or drop a .json or .csv file here")}</small>
          </div>
        </section>
      </div>
      <div className="storage-note">{t("Your data stays on this device. Export backups regularly.")}</div>
    </main>
  );
}

function JsonPreview({
  analysis,
  mode,
  setMode,
  policy,
  setPolicy,
}: {
  analysis: BackupAnalysis;
  mode: RestoreMode;
  setMode: (value: RestoreMode) => void;
  policy: ConflictPolicy;
  setPolicy: (value: ConflictPolicy) => void;
}) {
  const { t } = useTranslation();
  const backup = analysis.backup;
  return (
    <div className="preview-layout">
      <section className="preview-panel">
        <h2>{t("Shunhen backup")}</h2>
        <p>{t("Created {{date}}", { date: new Date(backup.exportedAt).toLocaleString(localeCode()) })}</p>
        <div className="preview-counts">
          <span>
            {t("Academic Years")}
            <strong>{backup.data.academicYears.length}</strong>
          </span>
          <span>
            {t("Subjects")}
            <strong>{backup.data.subjects.length}</strong>
          </span>
          <span>
            {t("Sessions")}
            <strong>{backup.data.sessions.length}</strong>
          </span>
          <span>
            {t("Settings")}
            <strong>{backup.data.settings.length}</strong>
          </span>
        </div>
        <div className="validation-summary">
          <CheckCircle2 /> {t("Backup structure and references are valid.")}
        </div>
      </section>
      <section className="preview-panel">
        <h2>{t("Restore mode")}</h2>
        <label className="choice">
          <input type="radio" checked={mode === "merge"} onChange={() => setMode("merge")} />
          <span>
            <strong>{t("Merge with existing data")}</strong>
            <small>{t("Add missing records and preserve existing data.")}</small>
          </span>
        </label>
        <label className="choice choice--danger">
          <input type="radio" checked={mode === "replace"} onChange={() => setMode("replace")} />
          <span>
            <strong>{t("Replace existing data")}</strong>
            <small>{t("Remove persistent local data and restore this backup.")}</small>
          </span>
        </label>
        {analysis.conflicts > 0 && mode === "merge" && (
          <>
            <h3>{t("{{count}} conflicts found", { count: analysis.conflicts })}</h3>
            <label className="choice">
              <input type="radio" checked={policy === "keep-existing"} onChange={() => setPolicy("keep-existing")} />{" "}
              {t("Keep existing records")}
            </label>
            <label className="choice">
              <input type="radio" checked={policy === "use-imported"} onChange={() => setPolicy("use-imported")} />{" "}
              {t("Use imported records")}
            </label>
          </>
        )}
        <p className="muted">{t("{{count}} identical records will be skipped.", { count: analysis.duplicates })}</p>
      </section>
    </div>
  );
}

const fields: [keyof CsvMapping, string][] = [
  ["academicYear", "Academic Year"],
  ["subject", "Subject"],
  ["startDate", "Start Date"],
  ["startTime", "Start Time"],
  ["endDate", "End Date"],
  ["endTime", "End Time"],
  ["startDateTime", "Start datetime"],
  ["endDateTime", "End datetime"],
  ["focusedMinutes", "Duration / Focused Minutes"],
  ["note", "Note"],
  ["archived", "Archived"],
];
function CsvPreviewPanel({
  data,
  years,
  destinationYear,
  onDestination,
  onMapping,
}: {
  data: CsvPreview;
  years: AcademicYear[];
  destinationYear: string;
  onDestination: (id: string) => void;
  onMapping: (field: keyof CsvMapping, column: string) => void;
}) {
  const { t } = useTranslation();
  const valid = data.rows.filter((row) => row.session && !row.errors.length && !row.duplicate).length;
  const duplicates = data.rows.filter((row) => row.duplicate).length;
  const invalid = data.rows.filter((row) => row.errors.length).length;
  return (
    <div className="preview-layout preview-layout--csv">
      <section className="preview-panel">
        <h2>{t(data.recognizedFocusCsv ? "Shunhen Sessions CSV" : "Map CSV columns")}</h2>
        {!data.recognizedFocusCsv && (
          <div className="mapping-grid">
            {fields.map(([field, label]) => (
              <label key={field}>
                {t(label)}
                <select value={data.mapping[field] ?? ""} onChange={(event) => onMapping(field, event.target.value)}>
                  <option value="">{t("Not mapped")}</option>
                  {data.headers.map((header) => (
                    <option key={header}>{header}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        )}
        {!data.mapping.academicYear && (
          <label className="destination-year">
            {t("Destination Academic Year")}
            <FilterSelect
              entity="academicYear"
              label={t("Destination Academic Year")}
              value={destinationYear}
              onChange={onDestination}
              options={[{ value: "", label: t("Select an Academic Year") }, ...academicYearOptions(years)]}
            />
          </label>
        )}
        <div className="preview-counts">
          <span>
            {t("Valid rows")}
            <strong>{valid}</strong>
          </span>
          <span>
            {t("Duplicates")}
            <strong>{duplicates}</strong>
          </span>
          <span>
            {t("Invalid rows")}
            <strong>{invalid}</strong>
          </span>
          <span>
            {t("New Subjects")}
            <strong>{data.subjectsToCreate.length}</strong>
          </span>
        </div>
        {data.academicYearsToCreate.length > 0 && (
          <p className="muted">
            {t("New Academic Years")}: {data.academicYearsToCreate.join(", ")}
          </p>
        )}
        {data.subjectsToCreate.length > 0 && (
          <p className="muted">
            {t("New Subjects")}:{" "}
            {data.subjectsToCreate
              .slice(0, 5)
              .map((subject) => `${subject.academicYearName} / ${subject.subjectName}`)
              .join(", ")}
          </p>
        )}
      </section>
      <section className="preview-panel">
        <h2>{t("First rows")}</h2>
        <div className="csv-row-list">
          {data.rows.slice(0, 8).map((row) => (
            <div key={row.rowNumber} className={row.errors.length ? "invalid" : ""}>
              <strong>{t("Row {{number}}", { number: row.rowNumber })}</strong>
              <span>
                {row.subjectName || t("No Subject")} · {row.academicYearName || t("No Academic Year")}
              </span>
              <small>
                {row.duplicate
                  ? t("Probable duplicate - skipped")
                  : row.errors.map((entry) => t(entry)).join(" ") || t("Ready to import")}
              </small>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
