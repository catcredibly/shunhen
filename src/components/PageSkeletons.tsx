import { useTranslation } from "react-i18next";
import type { FocusSettings } from "../settings";

export function Skeleton({ className = "" }: { className?: string }) {
  return <span className={`loading-skeleton ${className}`} aria-hidden="true" />;
}

export function TimerLoading() {
  return (
    <main className="timer-shell timer-shell--idle timer-loading" aria-busy="true">
      <section className="timer-card" aria-hidden="true">
        <Skeleton className="loading-timer-date" />
        <div className="loading-timer-time">
          {[0, 1, 2].map((part) => (
            <div key={part}>
              <Skeleton className="loading-timer-digit" />
              <Skeleton className="loading-timer-label" />
            </div>
          ))}
        </div>
        <Skeleton className="loading-control loading-timer-field" />
        <Skeleton className="loading-control loading-timer-field" />
        <Skeleton className="loading-timer-start" />
      </section>
    </main>
  );
}

export function HistoryLoading({ searchOpen = false }: { searchOpen?: boolean }) {
  const { t } = useTranslation();
  return (
    <main className="page" aria-busy="true">
      <header className="page-header">
        <div>
          <h1>{t("History")}</h1>
          <p>{t("Review and correct completed focus sessions.")}</p>
        </div>
        <div className="header-actions">
          <button className="secondary-action" disabled>
            {t("Select")}
          </button>
          <button className="primary-action" disabled>
            {t("Add Session")}
          </button>
        </div>
      </header>
      <div className="filter-bar history-filters">
        {["Academic Year", "Subject", "Status"].map((label) => (
          <label key={label}>
            {t(label)}
            <Skeleton className="loading-control" />
          </label>
        ))}
        <div className={`history-note-search ${searchOpen ? "is-open" : ""}`}>
          <Skeleton className={searchOpen ? "loading-control" : "loading-search-icon"} />
        </div>
      </div>
      <div className="history-table history-loading-table">
        <div className="history-head">
          {["Date", "Time", "Duration", "Subject", "Academic Year", "Notes", "Status", ""].map((label, index) => (
            <span key={index} className={label === "Notes" ? "history-note-column" : undefined}>
              {label ? t(label) : null}
            </span>
          ))}
        </div>
        {Array.from({ length: 7 }, (_, row) => (
          <div className="history-row" key={row} aria-hidden="true">
            {Array.from({ length: 8 }, (_, cell) => (
              <span key={cell} className={cell === 5 ? "history-note-column" : undefined}>
                <Skeleton />
              </span>
            ))}
          </div>
        ))}
      </div>
      <div className="pagination history-pagination" aria-hidden="true">
        <Skeleton className="loading-pagination" />
        <Skeleton className="loading-pagination" />
      </div>
    </main>
  );
}

const tabs = ["Overview", "Study Patterns", "Subjects", "Academic Years", "Time Trends"] as const;
function CardSkeleton({
  title,
  compact = false,
  className = "",
  controls = false,
}: {
  title?: string;
  compact?: boolean;
  className?: string;
  controls?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <section className={`analytics-panel ${className}`}>
      <header>{title ? <h2>{t(title)}</h2> : <Skeleton className="loading-card-title" />}</header>
      {controls && (
        <div className="trend-controls">
          <Skeleton className="loading-control loading-analytics-filter" />
        </div>
      )}
      <Skeleton className={compact ? "loading-summary-area" : "loading-chart-area"} />
    </section>
  );
}
export function AnalyticsLoading({
  tab = "Overview",
  settings,
}: {
  tab?: (typeof tabs)[number];
  settings?: FocusSettings;
}) {
  const { t } = useTranslation();
  const goalCount = settings
    ? Number(settings.dailyGoalEnabled && settings.dailyGoalSeconds > 0) +
      Number(settings.weeklyGoalEnabled && settings.weeklyGoalSeconds > 0)
    : 1;
  return (
    <main className="page analytics-page" aria-busy="true">
      <header className="analytics-header">
        <div>
          <h1>{t("Analytics")}</h1>
          <p>{t("Explore your study habits across subjects, Academic Years, and self-study.")}</p>
        </div>
        <div className="analytics-filters">
          <Skeleton className="loading-control loading-analytics-filter" />
          <Skeleton className="loading-control loading-analytics-filter" />
          <div className="custom-range-wrap">
            <div className="range-control loading-ranges">
              {["7D", "30D", "90D", "1Y", "All", "Custom"].map((range) => (
                <button key={range} disabled>
                  {t(range)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>
      <nav className="analytics-tabs" aria-label={t("Analytics views")}>
        {tabs.map((item) => (
          <button key={item} disabled aria-pressed={tab === item} className={tab === item ? "active" : ""}>
            {t(item)}
          </button>
        ))}
      </nav>
      {tab === "Overview" ? (
        <div className="analytics-content overview-content">
          <div className="metric-strip metric-strip--five">
            {["Total focus time", "Total Sessions", "Average Session", "Average active day", "Active study days"].map(
              (label) => (
                <article className="analytics-metric" key={label}>
                  <span>
                    {t(label)}
                    <Skeleton className="loading-metric-value" />
                  </span>
                </article>
              ),
            )}
            <footer className="comparison-footer">
              <Skeleton className="loading-period" />
            </footer>
          </div>
          {goalCount > 0 && (
            <div className="analytics-goals">
              {Array.from({ length: goalCount }, (_, i) => (
                <section key={i}>
                  <Skeleton className="loading-summary-area" />
                </section>
              ))}
            </div>
          )}
          <CardSkeleton title="Personal bests" compact />
          <CardSkeleton title="Focus time over time" />
          <CardSkeleton title="Daily activity" />
        </div>
      ) : (
        <div
          className={`analytics-content ${tab === "Study Patterns" ? "patterns-grid aligned-pattern-charts" : tab === "Subjects" ? "subjects-layout" : tab === "Academic Years" ? "years-layout" : "trend-grid"}`}
        >
          {(tab === "Study Patterns"
            ? ["Average focus time by weekday", "Session length distribution", "Study time by weekday and time"]
            : tab === "Subjects"
              ? ["Subjects", "Focus time by Subject"]
              : tab === "Academic Years"
                ? ["Focus time by Academic Year", "Average focus per active day"]
                : [
                    ...(goalCount ? ["Goal achievement over time"] : []),
                    "Cumulative Focus Time",
                    "Sessions over time",
                    "Average session length",
                  ]
          ).map((title) => (
            <CardSkeleton
              title={title}
              key={title}
              className={title === "Study time by weekday and time" ? "full-row" : undefined}
              controls={tab === "Study Patterns" && title === "Average focus time by weekday"}
            />
          ))}
        </div>
      )}
    </main>
  );
}
