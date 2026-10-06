import { readAnalyticsSnapshot } from "../storage/queries";
import { useSubjectAnalyticsData } from "../hooks/useSubjectAnalyticsData";
import { prepareSubjectAnalytics } from "../analytics/subjectData";
import { SubjectShareAxisTick, SubjectShareYearLabels } from "./SubjectShareAxis";
import { SubjectShareInfo } from "./SubjectShareInfo";
import { createAnalyticsSnapshot } from "../analytics/snapshot";
import { AnalyticsSnapshotContext, useAnalyticsSnapshot } from "../analytics/SnapshotContext";
import { useAnalyticsClock } from "../hooks/useAnalyticsClock";
import { useAnalyticsScopes } from "../hooks/useAnalyticsScopes";
import { Info } from "lucide-react";
import { ValueTooltip } from "./ValueTooltip";
import { AnalyticsLoading } from "./PageSkeletons";
import type { FocusSettings } from "../settings";
import { GoalProgressTooltip } from "./GoalProgressTooltip";
import {
  DEFAULT_WEEKDAY_METRIC,
  DEFAULT_WEEKDAY_MODE,
  availableGoalMode,
  weekdayChartMode,
  weekdayChartTitle,
  weekdayChartValue,
  type WeekdayMode,
} from "../analytics/controls";
import { goalAchievement, goalAxisMaximum } from "../analytics/goalAchievement";
import { academicYearProgress } from "../analytics/yearProgress";
import { validSessions } from "../sessionValidity";
import { academicYearOptions, subjectOptions, pruneSubjectSelection } from "../selectorOptions";
import { FilterSelect } from "./FilterSelect";
import { dailyActivityScope } from "../analytics/dailyActivity";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "../hooks/useLiveQuery";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import { useTranslation } from "react-i18next";
import { db } from "../db";
import { formatDuration, formatDurationAxis } from "../data";
import type { AcademicYear, FocusSession, Subject } from "../types";
import { createDevelopmentAnalyticsDataset } from "../analytics/developmentDataset";
import {
  academicYearTotals,
  filterSessions,
  localDayKey,
  medianSessionSeconds,
  sessionLengthBuckets,
  weekdayAverages,
} from "../analytics/analytics";
import {
  addDays,
  analyticsRanges,
  averageStudyPattern,
  calendarBuckets,
  calendarDays,
  defaultAggregation,
  goalDefaultAggregation,
  cumulativeDailyFocus,
  dailyTickIndices,
  percentageChange,
  personalBests,
  previousPeriod,
  rollingTimeline,
  summaryMetrics,
  type Aggregation,
  type AnalyticsRange,
  type Period,
} from "../analytics/periods";
import { goalProgress } from "../goals";
import { useSettings } from "../hooks/useSettings";
import { localeCode } from "../i18n";
import { ActivityHeatmap } from "./ActivityHeatmap";

const COLORS = ["#4da3ff", "#a879ff", "#4dd39a", "#ffad3b", "#ff7eb6", "#8da2b5"];
const tabs = ["Overview", "Study Patterns", "Subjects", "Academic Years", "Time Trends"] as const;
const dateLabel = (stamp: number) =>
  new Date(stamp).toLocaleDateString(localeCode(), { day: "numeric", month: "short", year: "numeric" });
const periodLabel = (period: Period) =>
  new Intl.DateTimeFormat(localeCode(), { day: "numeric", month: "short", year: "numeric" }).formatRange(
    new Date(period.start),
    new Date(addDays(period.end, -1)),
  );
const number = (value: number) => value.toLocaleString(localeCode(), { maximumFractionDigits: 1 });
const percent = (value: number) =>
  (value / 100).toLocaleString(localeCode(), { style: "percent", maximumFractionDigits: 1 });
const exactDuration = (seconds: number) => {
  const total = Math.max(0, Math.round(seconds));
  const parts = [
    [Math.floor(total / 3600), "hour"],
    [Math.floor((total % 3600) / 60), "minute"],
    [total % 60, "second"],
  ] as const;
  return parts
    .filter(([value, unit]) => value > 0 || (unit === "second" && total === 0))
    .map(([value, unit]) =>
      new Intl.NumberFormat(localeCode(), { style: "unit", unit, unitDisplay: "short" }).format(value),
    )
    .join(" ");
};
const inputDay = (value: string) => new Date(`${value}T00:00:00`).getTime();
type DataProps = { sessions: FocusSession[]; subjects: Subject[]; years: AcademicYear[] };
type TimelineProps = {
  sessions: FocusSession[];
  history: FocusSession[];
  period: Period;
  range: AnalyticsRange;
  settings: FocusSettings;
  now: number;
  today: number;
};

export function AnalyticsPage() {
  const { t } = useTranslation();
  const { settings, loaded: settingsLoaded } = useSettings();
  const snapshot = useLiveQuery(async () => {
    if (!settingsLoaded) return;
    return readAnalyticsSnapshot(db);
  }, [settingsLoaded]);
  const demoEnabled = import.meta.env.DEV && new URLSearchParams(window.location.search).get("analyticsDemo") === "1";
  const demo = useMemo(() => (demoEnabled ? createDevelopmentAnalyticsDataset(20_000) : undefined), [demoEnabled]);
  const years = demo?.academicYears ?? snapshot?.years,
    subjects = demo?.subjects ?? snapshot?.subjects,
    sessions = demo?.sessions ?? snapshot?.sessions;
  const [tab, setTab] = useState<(typeof tabs)[number]>("Overview");
  const [yearIds, setYearIds] = useState<string[]>([]);
  const [subjectIds, setSubjectIds] = useState<string[]>([]);
  const [range, setRange] = useState<AnalyticsRange>("All");
  const [customOpen, setCustomOpen] = useState(false);
  const [customRange, setCustomRange] = useState<Period>();
  const [customDraft, setCustomDraft] = useState(() => ({
    start: localDayKey(Date.now()),
    end: localDayKey(Date.now()),
  }));
  const { now, today } = useAnalyticsClock();
  const customValid =
    Number.isFinite(inputDay(customDraft.start)) &&
    Number.isFinite(inputDay(customDraft.end)) &&
    customDraft.end >= customDraft.start;
  const effectiveSessions = useMemo(
    () => filterSessions(validSessions(sessions ?? [], years ?? [])),
    [sessions, years],
  );
  useEffect(() => {
    if (!subjects) return;
    setSubjectIds((selection) => {
      const next = pruneSubjectSelection(selection, subjects, yearIds);
      return next.length === selection.length ? selection : next;
    });
  }, [subjects, yearIds]);
  // Comparison tabs override the effective scope without destroying saved filter selections.
  const yearDisabled = tab === "Academic Years",
    subjectDisabled = yearDisabled;
  const { history, period, filtered, goalHistory, goalPeriod } = useAnalyticsScopes(
    effectiveSessions,
    yearIds,
    subjectIds,
    yearDisabled,
    range,
    today,
    customRange,
    yearDisabled || yearIds.length !== 1 ? undefined : years?.find((year) => year.id === yearIds[0]),
  );
  const timezoneOffset = new Date(now).getTimezoneOffset();
  const snapshotData = useMemo(() => createAnalyticsSnapshot(effectiveSessions), [effectiveSessions, timezoneOffset]);
  const activity = useMemo(
    () => dailyActivityScope(effectiveSessions, years ?? [], subjects ?? [], yearIds, subjectIds, today),
    [effectiveSessions, years, subjects, yearIds, subjectIds, today],
  );
  if (!years || !subjects || !sessions || !settingsLoaded)
    return <AnalyticsLoading tab={tab} settings={settingsLoaded ? settings : undefined} />;
  const timeline = { sessions: filtered, history, period, range, settings, now, today };
  const emptyScope = period.end <= period.start || (range === "All" && !history.length);
  return (
    <AnalyticsSnapshotContext.Provider value={snapshotData}>
      <main className="page analytics-page">
        {demoEnabled && (
          <div className="analytics-demo-banner">
            Development dataset · {number(sessions.length)} generated Sessions · in memory only
          </div>
        )}
        <header className="analytics-header">
          <div>
            <h1>{t("Analytics")}</h1>
            <p>{t("Explore your study habits across subjects, Academic Years, and self-study.")}</p>
          </div>
          <div className="analytics-filters">
            <FilterSelect
              multiple
              entity="academicYear"
              label={t("Academic Year")}
              disabled={yearDisabled || !years.length}
              value={yearDisabled ? [] : yearIds}
              onChange={setYearIds}
              options={[{ value: "", label: t("All Academic Years") }, ...academicYearOptions(years)]}
            />
            <FilterSelect
              multiple
              entity="subject"
              label={t("Subject")}
              disabled={subjectDisabled}
              value={subjectDisabled ? [] : subjectIds}
              onChange={setSubjectIds}
              options={[{ value: "", label: t("All Subjects") }, ...subjectOptions(years, subjects, yearIds)]}
            />
            <div className="custom-range-wrap">
              <div className="range-control" aria-label={t("Date range")}>
                {analyticsRanges.map((r) => (
                  <button
                    key={r}
                    aria-pressed={(customOpen ? "Custom" : range) === r}
                    className={(customOpen ? "Custom" : range) === r ? "active" : ""}
                    onClick={() => {
                      if (r === "Custom") {
                        if (customRange)
                          setCustomDraft({
                            start: localDayKey(customRange.start),
                            end: localDayKey(addDays(customRange.end, -1)),
                          });
                        setCustomOpen(true);
                      } else {
                        setCustomOpen(false);
                        setRange(r);
                      }
                    }}
                  >
                    {t(r)}
                  </button>
                ))}
              </div>
              {range === "Custom" && <span className="custom-range-label">{periodLabel(period)}</span>}
              {customOpen && (
                <div
                  className="custom-range-popover"
                  role="dialog"
                  aria-label={t("Custom")}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setCustomOpen(false);
                  }}
                >
                  <label>
                    {t("Start date")}
                    <input
                      type="date"
                      value={customDraft.start}
                      max={customDraft.end || undefined}
                      onChange={(e) => setCustomDraft({ ...customDraft, start: e.target.value })}
                    />
                  </label>
                  <label>
                    {t("End date")}
                    <input
                      type="date"
                      value={customDraft.end}
                      min={customDraft.start || undefined}
                      onChange={(e) => setCustomDraft({ ...customDraft, end: e.target.value })}
                    />
                  </label>
                  {!customValid && <span className="field-error">{t("End date cannot be before Start date.")}</span>}
                  <div className="custom-range-actions">
                    <button className="secondary-action" onClick={() => setCustomOpen(false)}>
                      {t("Cancel")}
                    </button>
                    <button
                      className="primary-action"
                      disabled={!customValid}
                      onClick={() => {
                        setCustomRange({
                          start: inputDay(customDraft.start),
                          end: addDays(inputDay(customDraft.end), 1),
                        });
                        setRange("Custom");
                        setCustomOpen(false);
                      }}
                    >
                      {t("Apply")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>
        <nav className="analytics-tabs" aria-label={t("Analytics views")}>
          {tabs.map((item) => (
            <button
              key={item}
              aria-pressed={tab === item}
              className={tab === item ? "active" : ""}
              onClick={() => setTab(item)}
            >
              {t(item)}
            </button>
          ))}
        </nav>
        {emptyScope && tab !== "Overview" && tab !== "Time Trends" ? (
          <Empty />
        ) : tab === "Overview" ? (
          <Overview {...timeline} allSessions={goalHistory} goalOnly={emptyScope} activity={activity} />
        ) : tab === "Study Patterns" ? (
          <StudyPatterns {...timeline} />
        ) : tab === "Subjects" ? (
          <MemoSubjectsAnalytics
            sessions={filtered}
            history={history}
            period={period}
            subjects={subjects}
            years={years}
          />
        ) : tab === "Academic Years" ? (
          <YearsAnalytics sessions={filtered} history={history} years={years} subjects={subjects} today={today} />
        ) : (
          <TimeTrends {...timeline} goalHistory={goalHistory} goalPeriod={goalPeriod} goalOnly={emptyScope} />
        )}
      </main>
    </AnalyticsSnapshotContext.Provider>
  );
}

function GoalFilterInfo() {
  const { t } = useTranslation();
  return (
    <ValueTooltip lines={[t("Not affected by Subject or Academic Year filters.")]}>
      <Info
        size={14}
        className="goal-filter-info"
        aria-label={t("Not affected by Subject or Academic Year filters.")}
      />
    </ValueTooltip>
  );
}

function GoalSummary({
  label,
  current,
  target,
  kind,
}: {
  label: string;
  current: number;
  target: number;
  kind: string;
}) {
  const { t } = useTranslation();
  return (
    <section className={`goal-${kind}`}>
      <div>
        <strong className="goal-title">
          {label}
          <GoalFilterInfo />
        </strong>
        <span>
          {target > 0 && current >= target
            ? t("Goal reached")
            : t("{{duration}} left", { duration: formatDuration(Math.max(0, target - current)) })}
        </span>
      </div>
      <progress max={Math.max(1, target)} value={Math.min(current, target)} />
      <small>
        {formatDuration(current)} / {formatDuration(target)}
      </small>
    </section>
  );
}

function Overview({
  sessions,
  history,
  period,
  range,
  allSessions,
  today,
  goalOnly,
  activity,
  settings,
}: TimelineProps & {
  goalOnly: boolean;
  allSessions: FocusSession[];
  activity: ReturnType<typeof dailyActivityScope>;
}) {
  const { t } = useTranslation();
  const { getDailyTotals } = useAnalyticsSnapshot();
  const goals = useMemo(() => goalProgress(allSessions, today), [allSessions, today]);
  const { current, previousValues, records } = useMemo(() => {
    const daily = getDailyTotals(history);
    return {
      current: summaryMetrics(history, period, daily),
      previousValues: summaryMetrics(history, previousPeriod(period), daily),
      records: personalBests(history, period, daily),
    };
  }, [history, period.start, period.end, getDailyTotals]);
  const consecutive = range === "7D" || (range === "Custom" && calendarDays(period) < 14);
  const fourth = consecutive ? records.consecutive : records.bestWeek;
  const labels = ["Total focus time", "Total Sessions", "Average Session", "Average active day", "Active study days"];
  const recordRows = [
    {
      label: "Best day",
      value: records.bestDay ? formatDuration(records.bestDay.seconds) : "—",
      date: records.bestDay && dateLabel(records.bestDay.start),
    },
    {
      label: "Longest Session",
      value: records.longestSession ? formatDuration(records.longestSession.focusedDurationSeconds) : "—",
      date: records.longestSession && dateLabel(records.longestSession.startTime),
    },
    {
      label: "Longest streak",
      value: records.longest ? t("{{count}} days", { count: records.longest.days }) : "—",
      date: records.longest && periodLabel(records.longest),
    },
    {
      label: consecutive ? "Best consecutive days" : "Best week",
      value: fourth ? formatDuration(fourth.seconds) : "—",
      date: fourth && periodLabel(fourth),
    },
  ];
  const goalSummaries = ((settings.dailyGoalEnabled && settings.dailyGoalSeconds > 0) ||
    (settings.weeklyGoalEnabled && settings.weeklyGoalSeconds > 0)) && (
    <div className="analytics-goals">
      {settings.dailyGoalEnabled && settings.dailyGoalSeconds > 0 && (
        <GoalSummary
          kind="daily"
          label={t("Daily goal")}
          current={goals.dailySeconds}
          target={settings.dailyGoalSeconds}
        />
      )}{" "}
      {settings.weeklyGoalEnabled && settings.weeklyGoalSeconds > 0 && (
        <GoalSummary
          kind="weekly"
          label={t("Weekly goal")}
          current={goals.weeklySeconds}
          target={settings.weeklyGoalSeconds}
        />
      )}
    </div>
  );
  if (goalOnly)
    return (
      <div className="analytics-content overview-content">
        {goalSummaries}
        <Empty />
      </div>
    );

  return (
    <div className="analytics-content overview-content">
      <div className="metric-strip metric-strip--five">
        {labels.map((label, index) => (
          <Metric
            key={label}
            label={t(label)}
            value={index === 1 || index === 4 ? number(current[index]) : formatDuration(current[index])}
            comparison={
              range === "All"
                ? undefined
                : {
                    value: percentageChange(current[index], previousValues[index]),
                    delta: current[index] - previousValues[index],
                    count: index === 1 || index === 4,
                  }
            }
          />
        ))}
        <ComparisonFooter period={period} range={range} />
      </div>
      {goalSummaries}
      <Panel title={t("Personal bests")}>
        <div className="analytics-best-list">
          {recordRows.map((row) => (
            <span key={row.label}>
              {t(row.label)}
              <strong>{row.value}</strong>
              <small>{row.date || "—"}</small>
            </span>
          ))}
        </div>
      </Panel>
      <Panel title={t("Focus time over time")}>
        <RollingChart history={history} period={period} bars />
      </Panel>
      <Panel title={t("Daily activity")}>
        <ActivityHeatmap {...activity} />
      </Panel>
    </div>
  );
}

function SubjectsAnalytics({
  sessions,
  subjects,
  years,
  history,
  period,
}: DataProps & { history: FocusSession[]; period: Period }) {
  const { t } = useTranslation();
  const data = useSubjectAnalyticsData(sessions, history, subjects, years, period, localeCode());
  const { rows, total, names } = data;
  return (
    <div className="analytics-content subjects-layout">
      <Panel className="subject-card" title={t("Subjects")}>
        <div className="analytics-table">
          <div className="analytics-table-head">
            {["Subject", "Academic Year", "Focus time", "Sessions", "Average Session", "Active days"].map((label) => (
              <span key={label}>{t(label)}</span>
            ))}
          </div>
          {rows.map((row) => (
            <div className="analytics-table-row" key={row.subjectId}>
              <span title={row.name}>
                <i style={{ background: row.color }} />
                {row.name}
              </span>
              <span>{years.find((y) => y.id === row.academicYearId)?.name}</span>
              <strong>{formatDuration(row.seconds)}</strong>
              <span>{number(row.sessions)}</span>
              <span>{formatDuration(row.averageSessionSeconds)}</span>
              <span>{number(row.activeDayCount)}</span>
            </div>
          ))}
        </div>
        {!rows.length && <Empty />}
      </Panel>
      <Panel className="subject-card subject-share-card" title={t("Focus time by Subject")}>
        <div className="donut-wrap">
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={rows.map((row) => ({ name: names.get(row.subjectId), value: row.seconds, fill: row.color }))}
                dataKey="value"
                nameKey="name"
                innerRadius="55%"
                outerRadius="85%"
                stroke="none"
              />
              <Tooltip content={(props) => <ChartTooltip {...props} kind="pie" total={total} />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="chart-legend">
            {rows.map((row) => (
              <span key={row.subjectId}>
                <i style={{ background: row.color }} />
                <em title={names.get(row.subjectId)}>{row.name}</em>
                <strong>{percent((row.seconds / total) * 100)}</strong>
              </span>
            ))}
          </div>
        </div>
      </Panel>
      <SubjectShareChart data={data} />
    </div>
  );
}

const SubjectShareChart = memo(function SubjectShareChart({
  data,
}: {
  data: ReturnType<typeof prepareSubjectAnalytics>;
}) {
  const { t } = useTranslation();
  const interactive = useInteractiveTooltip();
  const { share, shareRows, stackedShareRows, shareNames } = data;
  return (
    <Panel
      className="full-row"
      title={
        <span className="subject-share-title">
          {t("Subject share over time")}
          <SubjectShareInfo />
        </span>
      }
    >
      {!share.length ? (
        <Empty />
      ) : (
        <ScrollChart width={share.length * 58 + 90}>
          <AreaChart
            data={share}
            margin={{ top: 5, right: 30, bottom: 5, left: 5 }}
            onMouseMove={interactive.enter}
            onMouseLeave={interactive.leave}
          >
            <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
            <XAxis
              dataKey="key"
              allowDuplicatedCategory={false}
              interval={0}
              height={44}
              tick={<SubjectShareAxisTick points={share} />}
              label={<SubjectShareYearLabels points={share} />}
            />
            <YAxis domain={[0, 100]} tickFormatter={percent} />
            {stackedShareRows.map((row) => (
              <Area
                key={row.subjectId}
                dataKey={(point) => point.shares[row.subjectId]}
                name={shareNames.get(row.subjectId)}
                stackId="subjects"
                stroke="var(--chart-grid)"
                strokeWidth={1}
                fill={row.color}
                fillOpacity={1}
                type="linear"
                connectNulls={false}
                dot={share.length === 1 ? { r: 3 } : false}
              />
            ))}
            <Tooltip
              active={interactive.active || undefined}
              wrapperStyle={{ pointerEvents: "auto" }}
              content={(props) => {
                const point = share.find((point) => point.key === props.label);
                return (
                  <div onMouseEnter={interactive.enter} onMouseLeave={interactive.leave}>
                    <ChartTooltip
                      {...props}
                      label={point?.label ?? props.label}
                      kind="percent"
                      colors={Object.fromEntries(
                        shareRows.map((row) => [shareNames.get(row.subjectId) ?? row.name, row.color]),
                      )}
                    />
                  </div>
                );
              }}
            />
          </AreaChart>
        </ScrollChart>
      )}
    </Panel>
  );
});
const MemoSubjectsAnalytics = memo(SubjectsAnalytics);

function YearsAnalytics({
  sessions,
  history,
  years,
  subjects,
  today,
}: DataProps & { history: FocusSession[]; today: number }) {
  const { t } = useTranslation();
  const { getDays, getDailyTotals } = useAnalyticsSnapshot();
  const rows = useMemo(
    () => academicYearTotals(sessions, years, subjects, getDays),
    [sessions, years, subjects, getDays],
  );
  const progressRows = useMemo(
    () => academicYearProgress(years, history, today, getDailyTotals),
    [years, history, today, getDailyTotals],
  );
  const yearProgress = useMemo(() => new Map(progressRows.map((item) => [item.year.id, item])), [progressRows]);
  const averageMaximum = Math.max(1, ...rows.map((row) => row.averageActiveDaySeconds));
  return (
    <div className="analytics-content years-layout">
      <Panel title={t("Focus time by Academic Year")}>
        <div className="analytics-list-scroll">
          {rows.map((row, index) => (
            <div
              className="breakdown-row year-comparison-row"
              key={row.academicYearId}
              title={`${row.name}: ${formatDuration(row.seconds)}, ${t("{{count}} Sessions", { count: row.sessions })}`}
              tabIndex={0}
            >
              <span>{row.name}</span>
              <strong>{formatDuration(row.seconds)}</strong>
              <i
                style={{
                  width: `${(row.seconds / Math.max(1, rows[0].seconds)) * 100}%`,
                  background: COLORS[index % COLORS.length],
                }}
              />
            </div>
          ))}
        </div>
        {!rows.length && <Empty />}
      </Panel>
      <Panel title={t("Average focus per active day")}>
        <div className="analytics-list-scroll">
          {[...rows]
            .sort((a, b) => b.averageActiveDaySeconds - a.averageActiveDaySeconds)
            .map((row, index) => (
              <div
                className="breakdown-row year-comparison-row"
                key={row.academicYearId}
                title={`${row.name}: ${formatDuration(row.averageActiveDaySeconds)}`}
                tabIndex={0}
              >
                <span>{row.name}</span>
                <strong>{formatDuration(row.averageActiveDaySeconds)}</strong>
                <i
                  style={{
                    width: `${(row.averageActiveDaySeconds / averageMaximum) * 100}%`,
                    background: COLORS[index % COLORS.length],
                  }}
                />
              </div>
            ))}
        </div>
        {!rows.length && <Empty />}
      </Panel>
      <YearProgressChart rows={progressRows} />
      <Panel title={t("Academic Year summary")}>
        <div className="analytics-table year-summary-table" role="table">
          <div className="analytics-table-head" role="row">
            {["Academic Year", "Sessions", "Subjects", "Active days", "Active-day rate", "Average Session"].map(
              (label) => (
                <span role="columnheader" key={label}>
                  {t(label)}
                </span>
              ),
            )}
          </div>
          {rows.map((row) => (
            <div className="analytics-table-row" role="row" key={row.academicYearId}>
              <span role="cell">{row.name}</span>
              <span role="cell">{number(row.sessions)}</span>
              <span role="cell">{number(row.subjects)}</span>
              <span role="cell">
                <ValueTooltip
                  lines={[
                    t("{{count}} active days", { count: row.activeDays }),
                    t("An active day is a day with recorded Focus Time."),
                  ]}
                >
                  {number(row.activeDays)}
                </ValueTooltip>
              </span>
              <span role="cell">
                <ValueTooltip
                  lines={[
                    t("{{active}} of {{eligible}} eligible days", {
                      active: yearProgress.get(row.academicYearId)?.activeDays ?? 0,
                      eligible: yearProgress.get(row.academicYearId)?.elapsedDays ?? 0,
                    }),
                    ...(yearProgress.get(row.academicYearId)?.ongoing
                      ? [t("Eligible days are counted through today.")]
                      : []),
                  ]}
                >
                  {percent((yearProgress.get(row.academicYearId)?.activeDayRate ?? 0) * 100)}
                </ValueTooltip>
              </span>
              <span role="cell">{formatDuration(row.averageSessionSeconds)}</span>
            </div>
          ))}
        </div>
        {!rows.length && <Empty />}
      </Panel>
    </div>
  );
}

function TimeTrends({
  sessions,
  history,
  period,
  range,
  settings,
  goalHistory,
  goalPeriod,
  now,
  goalOnly,
}: TimelineProps & { goalHistory: FocusSession[]; goalPeriod: Period; goalOnly: boolean }) {
  const { t } = useTranslation();
  const aggregation = defaultAggregation(range, period);
  const [manualAggregation, setGoalAggregation] = useState<Aggregation>();
  const dailyAvailable = settings.dailyGoalEnabled && settings.dailyGoalSeconds > 0;
  const weeklyAvailable = settings.weeklyGoalEnabled && settings.weeklyGoalSeconds > 0;
  const [chosenGoal, setChosenGoal] = useState<"daily" | "weekly">("daily");
  const goalMode = availableGoalMode(dailyAvailable, weeklyAvailable, chosenGoal);
  useEffect(() => {
    if (!(dailyAvailable && weeklyAvailable)) setChosenGoal(weeklyAvailable ? "weekly" : "daily");
  }, [dailyAvailable, weeklyAvailable]);
  const smartDefault = goalDefaultAggregation(range, calendarDays(goalPeriod), goalMode);
  const grouping =
    manualAggregation && !(goalMode === "weekly" && manualAggregation === "daily") ? manualAggregation : smartDefault;
  useEffect(() => {
    if (goalMode === "weekly" && manualAggregation === "daily") setGoalAggregation(smartDefault);
  }, [goalMode, manualAggregation, smartDefault]);
  const allowedModes: Aggregation[] = goalMode === "daily" ? ["daily", "weekly", "monthly"] : ["weekly", "monthly"];
  const target = goalMode === "daily" ? settings.dailyGoalSeconds : settings.weeklyGoalSeconds;
  const validGoal = dailyAvailable || weeklyAvailable;
  const { getDailyTotals } = useAnalyticsSnapshot();
  const locale = localeCode();
  const goals = useMemo(
    () =>
      goalAchievement(goalHistory, goalPeriod, goalMode, grouping, target, now, "start", getDailyTotals).map(
        (point) => ({ ...point, label: periodLabel(point) }),
      ),
    [goalHistory, goalPeriod.start, goalPeriod.end, goalMode, grouping, target, now, getDailyTotals, locale],
  );
  const points = useMemo(
    () =>
      calendarBuckets(history, period, aggregation, 0, getDailyTotals(history)).map((point) => ({
        ...point,
        label: periodLabel(point),
      })),
    [history, period.start, period.end, aggregation, getDailyTotals, locale],
  );
  const cumulative = useMemo(
    () =>
      cumulativeDailyFocus(history, period, getDailyTotals(history)).map((point) => ({
        ...point,
        label: periodLabel(point),
      })),
    [history, period.start, period.end, getDailyTotals, locale],
  );
  const averageSessionPoints = useMemo(
    () =>
      points.map((point) => ({
        ...point,
        averageSeconds: point.sessionCount ? point.averageSeconds : null,
      })),
    [points],
  );
  const [cumulativeWidth, setCumulativeWidth] = useState(500);
  const ticks = useMemo(
    () => dailyTickIndices(cumulative.length, cumulativeWidth).map((index) => cumulative[index].label),
    [cumulative, cumulativeWidth],
  );
  return (
    <div className="analytics-content trend-grid">
      {validGoal && (
        <Panel
          title={
            <span className="goal-title">
              {t("Goal achievement over time")}
              <GoalFilterInfo />
            </span>
          }
          subtitle={t(
            goalMode === "daily"
              ? "Daily Goal achievement by {{grouping}}."
              : "Weekly Goal achievement by {{grouping}}.",
            { grouping: t(grouping === "daily" ? "day" : grouping === "weekly" ? "week" : "month") },
          )}
        >
          <div className="trend-controls">
            {dailyAvailable && weeklyAvailable && (
              <div className="range-control goal-mode-switch">
                {(["daily", "weekly"] as const).map((mode) => (
                  <button
                    key={mode}
                    aria-pressed={goalMode === mode}
                    className={goalMode === mode ? "active" : ""}
                    onClick={() => {
                      setGoalAggregation(
                        mode === "weekly" && grouping === "daily"
                          ? goalDefaultAggregation(range, calendarDays(goalPeriod), mode)
                          : grouping,
                      );
                      setChosenGoal(mode);
                    }}
                  >
                    {t(mode === "daily" ? "Daily" : "Weekly")}
                  </button>
                ))}
              </div>
            )}
            <select
              aria-label={t("Aggregation")}
              value={grouping}
              disabled={allowedModes.length === 1}
              onChange={(e) => setGoalAggregation(e.target.value as Aggregation)}
            >
              {allowedModes.map((mode) => (
                <option key={mode} value={mode}>
                  {t(mode === "daily" ? "By day" : mode === "weekly" ? "By week" : "By month")}
                </option>
              ))}
            </select>
          </div>
          <ScrollChart width={goals.length * 28}>
            <BarChart data={goals}>
              <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
              <XAxis dataKey="label" />
              <YAxis tickFormatter={percent} domain={[0, goalAxisMaximum(goals)]} />
              <ReferenceLine y={100} stroke="var(--text-muted)" strokeDasharray="4 4" />
              <Bar dataKey="goalPercent" name={t("Goal achievement")} fill="#4da778" />
              <Tooltip
                content={(props) => (
                  <GoalProgressTooltip point={props.active ? props.payload?.[0]?.payload : undefined} />
                )}
              />
            </BarChart>
          </ScrollChart>
        </Panel>
      )}
      {goalOnly ? (
        <Empty />
      ) : (
        <>
          <Panel title={t("Cumulative Focus Time")}>
            <ResponsiveContainer width="100%" height={290} onResize={(width) => setCumulativeWidth(width)}>
              <LineChart data={cumulative}>
                <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="label" ticks={ticks} interval={0} fontSize={11} />
                <YAxis tickFormatter={formatDurationAxis} fontSize={11} />
                <Line
                  dataKey="cumulativeSeconds"
                  name={t("Cumulative Focus Time")}
                  stroke="var(--accent)"
                  dot={false}
                />
                <Tooltip content={(props) => <ChartTooltip {...props} />} />
              </LineChart>
            </ResponsiveContainer>
          </Panel>
          <Panel title={t("Sessions over time")}>
            <ScrollChart width={points.length * 28}>
              <BarChart data={points}>
                <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                <XAxis dataKey="label" />
                <YAxis allowDecimals={false} />
                <Bar dataKey="sessionCount" name={t("Sessions")} fill="#4da3ff" />
                <Tooltip content={(props) => <ChartTooltip {...props} kind="count" />} />
              </BarChart>
            </ScrollChart>
          </Panel>
          <Panel title={t("Average session length")}>
            <ScrollChart width={points.length * 28}>
              <BarChart data={averageSessionPoints}>
                <ChartAxes />
                <Bar dataKey="averageSeconds" name={t("Average Session")} fill="#a879ff" />
                <Tooltip content={(props) => <ChartTooltip {...props} />} />
              </BarChart>
            </ScrollChart>
          </Panel>
          <Panel title={t("Rolling calendar-day averages")}>
            <RollingChart history={history} period={period} />
          </Panel>
        </>
      )}
    </div>
  );
}

function RollingChart({ history, period, bars = false }: { history: FocusSession[]; period: Period; bars?: boolean }) {
  const { t } = useTranslation();
  const { getDailyTotals } = useAnalyticsSnapshot();
  const locale = localeCode();
  const data = useMemo(
    () =>
      rollingTimeline(history, period, getDailyTotals(history)).map((point) => ({
        ...point,
        label: dateLabel(point.start),
      })),
    [history, period.start, period.end, getDailyTotals, locale],
  );
  return (
    <ScrollChart width={data.length <= 365 ? 0 : data.length * 2}>
      <ComposedChart data={data} barCategoryGap={0} barGap={0}>
        <ChartAxes />
        {bars && <Bar dataKey="seconds" name={t("Daily total")} fill="var(--accent)" opacity={0.7} />}
        {[7, 30, 90, 365].map((days, index) => (
          <Line
            key={days}
            dataKey={`avg${days}`}
            name={t(["7-day average", "30-day average", "3-month average", "1-year average"][index])}
            stroke={COLORS[index]}
            dot={false}
            strokeWidth={2}
          />
        ))}
        <Legend />
        <Tooltip content={(props) => <ChartTooltip {...props} />} />
      </ComposedChart>
    </ScrollChart>
  );
}

function StudyPatterns({ sessions, history, period, range }: TimelineProps) {
  const { t } = useTranslation();
  const [weekdayMetric, setWeekdayMetric] = useState(DEFAULT_WEEKDAY_METRIC);
  const [selectedWeekdayMode, setSelectedWeekdayMode] = useState<WeekdayMode>(DEFAULT_WEEKDAY_MODE);
  const weekdayMode = weekdayChartMode(weekdayMetric, selectedWeekdayMode);
  const { getDays, getDailyTotals } = useAnalyticsSnapshot();
  const { matrix, max, currentMetrics, previousMetrics, weekdays, lengths } = useMemo(() => {
    const values = summaryMetrics(sessions, undefined, getDailyTotals(sessions));
    const matrix = averageStudyPattern(history, period);
    const previousSessions = filterSessions(history, previousPeriod(period));
    return {
      matrix,
      max: Math.max(1, ...matrix.flat()),
      currentMetrics: [sessions.length, values[2], medianSessionSeconds(sessions)],
      previousMetrics: [
        previousSessions.length,
        summaryMetrics(previousSessions, undefined, getDailyTotals(previousSessions))[2],
        medianSessionSeconds(previousSessions),
      ],
      weekdays: weekdayAverages(history, period, getDays),
      lengths: sessionLengthBuckets(sessions),
    };
  }, [sessions, history, period.start, period.end, getDays, getDailyTotals]);
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const locale = localeCode();
  const weekdayPoints = useMemo(
    () =>
      weekdays.map((row) => ({
        ...row,
        value: weekdayChartValue(row, weekdayMetric, weekdayMode),
        label: t(row.label),
      })),
    [weekdays, weekdayMetric, weekdayMode, t, locale],
  );
  const lengthPoints = useMemo(() => lengths.map((row) => ({ ...row, label: t(row.label) })), [lengths, t, locale]);
  const times = useMemo(
    () =>
      Array.from(
        { length: 8 },
        (_, index) =>
          `${new Date(2000, 0, 1, index * 3).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hour12: false })}–${index === 7 ? "24:00" : new Date(2000, 0, 1, (index + 1) * 3).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", hour12: false })}`,
      ),
    [locale],
  );
  const [hover, setHover] = useState<{ day: number; bucket: number }>();
  return (
    <div className="analytics-content study-patterns-content">
      <div className="metric-strip metric-strip--three">
        {["Total Sessions", "Average Session", "Median Session"].map((label, index) => (
          <Metric
            key={label}
            label={t(label)}
            value={index === 0 ? number(currentMetrics[index]) : formatDuration(currentMetrics[index])}
            comparison={
              range === "All"
                ? undefined
                : {
                    value: percentageChange(currentMetrics[index], previousMetrics[index]),
                    delta: currentMetrics[index] - previousMetrics[index],
                    count: index === 0,
                  }
            }
          />
        ))}
        <ComparisonFooter period={period} range={range} />
      </div>
      <div className="patterns-grid aligned-pattern-charts">
        <Panel title={t(weekdayChartTitle(weekdayMetric, weekdayMode))}>
          <div className="trend-controls">
            <div className="range-control goal-mode-switch weekday-mode-switch">
              {(["average", "total"] as const).map((mode) => (
                <button
                  type="button"
                  key={mode}
                  aria-pressed={weekdayMode === mode}
                  className={weekdayMode === mode ? "active" : ""}
                  disabled={mode === "total" && weekdayMetric === "average"}
                  onClick={() => setSelectedWeekdayMode(mode)}
                >
                  {t(mode === "total" ? "Total" : "Average")}
                </button>
              ))}
            </div>
            <select
              aria-label={t("Average focus time by weekday")}
              value={weekdayMetric}
              onChange={(event) => setWeekdayMetric(event.target.value)}
            >
              <option value="seconds">{t("Focus time")}</option>
              <option value="count">{t("Sessions")}</option>
              <option value="average">{t("Average session")}</option>
            </select>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={weekdayPoints}>
              <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
              <XAxis dataKey="label" />
              <YAxis
                allowDecimals={weekdayMetric !== "count" || weekdayMode === "average"}
                tickFormatter={weekdayMetric === "count" ? number : formatDurationAxis}
              />
              <Bar
                dataKey="value"
                name={t(
                  weekdayMetric === "count"
                    ? "Sessions"
                    : weekdayMetric === "average"
                      ? "Average session"
                      : "Focus time",
                )}
                fill="#4da3ff"
              />
              <Tooltip
                content={(props) => <ChartTooltip {...props} kind={weekdayMetric === "count" ? "count" : "duration"} />}
              />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title={t("Session length distribution")}>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={lengthPoints}>
              <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
              <XAxis dataKey="label" fontSize={11} />
              <YAxis allowDecimals={false} />
              <Bar dataKey="count" name={t("Sessions")} fill="#a879ff" />
              <Tooltip content={(props) => <ChartTooltip {...props} kind="count" />} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>
        <Panel className="full-row" title={t("Study time by weekday and time")}>
          <div className="time-heatmap">
            <div className="time-heatmap-head">
              <span />
              {times.map((time) => (
                <span key={time}>{time}</span>
              ))}
            </div>
            {matrix.map((row, day) => (
              <div className="time-heatmap-row" key={day}>
                <b>{t(days[day])}</b>
                {row.map((seconds, bucket) => (
                  <button
                    key={bucket}
                    aria-label={`${t(days[day])} ${times[bucket]}: ${formatDuration(seconds)}`}
                    title={`${t(days[day])} ${times[bucket]}: ${formatDuration(seconds)}`}
                    onMouseEnter={() => setHover({ day, bucket })}
                    onMouseLeave={() => setHover(undefined)}
                    onFocus={() => setHover({ day, bucket })}
                    onBlur={() => setHover(undefined)}
                    style={{
                      background: `color-mix(in srgb, #4da3ff ${seconds ? Math.max(15, (seconds / max) * 100) : 0}%, var(--surface-raised))`,
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
          <div className="pattern-tooltip" role="status">
            {hover
              ? `${t(days[hover.day])} · ${times[hover.bucket]} · ${formatDuration(matrix[hover.day][hover.bucket])}`
              : "\u00a0"}
          </div>
          <div className="heatmap-legend">
            <span>{formatDuration(0)}</span>
            {[0.25, 0.5, 0.75, 1].map((level) => (
              <span key={level}>
                <i style={{ background: `color-mix(in srgb, #4da3ff ${level * 100}%, var(--surface-raised))` }} />
                {formatDuration(max * level)}
              </span>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  comparison,
}: {
  label: string;
  value: string;
  comparison?: { value?: number; delta?: number; count?: boolean };
}) {
  const { t } = useTranslation();
  const change = comparison?.value;
  const wording =
    change === undefined
      ? t("No previous period")
      : change === 0
        ? t("Unchanged from previous period")
        : t(change > 0 ? "{{percent}} higher than previous period" : "{{percent}} lower than previous period", {
            percent: percent(Math.abs(change)),
          });
  return (
    <article className="analytics-metric">
      <span>
        {label}
        <div className="metric-value">
          <strong title={value}>{value}</strong>
          <small
            className={`metric-change ${change && change > 0 ? "higher" : change && change < 0 ? "lower" : ""}`}
            title={comparison ? wording : undefined}
            aria-label={comparison ? wording : undefined}
          >
            {comparison ? (change === undefined ? "—" : `${change > 0 ? "+" : ""}${percent(change)}`) : "\u2014"}
          </small>
          {change !== undefined && comparison?.delta !== undefined && (
            <small className="metric-delta">
              {comparison.delta > 0 ? "+" : comparison.delta < 0 ? "−" : ""}
              {comparison.count ? number(Math.abs(comparison.delta)) : exactDuration(Math.abs(comparison.delta))}
            </small>
          )}
        </div>
      </span>
    </article>
  );
}
function ComparisonFooter({ period, range }: { period: Period; range: AnalyticsRange }) {
  const { t } = useTranslation();
  return (
    <footer className="comparison-footer">
      <span>
        <b>{t("Current:")}</b> {periodLabel(period)}
      </span>
      {range !== "All" && (
        <>
          <span aria-hidden="true">·</span>
          <span>
            <b>{t("Previous:")}</b> {periodLabel(previousPeriod(period))}
          </span>
        </>
      )}
    </footer>
  );
}
function Empty() {
  const { t } = useTranslation();
  return <p className="muted">{t("No Sessions in this range")}</p>;
}
function Panel({
  title,
  subtitle,
  children,
  className = "",
}: {
  title: React.ReactNode;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`analytics-panel ${className}`}>
      <header>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </header>
      {children}
    </section>
  );
}
function ChartAxes() {
  return (
    <>
      <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
      <XAxis dataKey="label" fontSize={11} />
      <YAxis tickFormatter={formatDurationAxis} fontSize={11} />
    </>
  );
}
function ScrollChart({ width, children }: { width: number; children: React.ReactElement }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollLeft = ref.current.scrollWidth;
  }, [width]);
  return (
    <div
      className="chart-scroll"
      ref={ref}
      tabIndex={0}
      onWheel={(event) => {
        if (event.shiftKey && event.deltaY && !event.deltaX) {
          event.currentTarget.scrollLeft += event.deltaY;
        }
      }}
    >
      <div style={{ minWidth: Math.max(400, width), width: "100%", height: 290 }}>
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
type ChartTooltipProps = Partial<Pick<TooltipContentProps<number, string>, "active" | "payload" | "label">>;
function ChartTooltip({
  active,
  payload,
  label,
  kind = "duration",
  total = 0,
  colors,
}: ChartTooltipProps & {
  kind?: "duration" | "count" | "percent" | "pie";
  total?: number;
  colors?: Record<string, string>;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      <strong>{label ?? payload[0].name}</strong>
      {(kind === "percent"
        ? payload.filter((item) => Number(item.value) > 0).sort((a, b) => Number(b.value) - Number(a.value))
        : payload
      ).map((item, index) => (
        <span key={`${item.dataKey}-${index}`}>
          <i style={{ background: colors?.[String(item.name)] ?? item.color ?? item.fill ?? item.payload?.fill }} />
          <em>{item.name}</em>
          <b>
            {kind === "count"
              ? number(Number(item.value))
              : kind === "percent"
                ? percent(Number(item.value))
                : exactDuration(Number(item.value))}
            {kind === "pie" && total > 0 ? ` · ${percent((Number(item.value) / total) * 100)}` : ""}
          </b>
        </span>
      ))}
    </div>
  );
}
function YearProgressChart({ rows }: { rows: ReturnType<typeof academicYearProgress> }) {
  const { t } = useTranslation();
  const interactive = useInteractiveTooltip();
  const [hover, setHover] = useState<number>();
  const data = useMemo(() => {
    const progressValues = [...new Set(rows.flatMap((row) => row.points.map((point) => point.progress)))].sort(
      (a, b) => a - b,
    );
    return progressValues.map((progress) => {
      const values: Record<string, number | null> = { progress };
      for (const row of rows) {
        const point = row.points.filter((point) => point.progress <= progress).at(-1);
        values[row.year.id] = progress <= row.progress ? (point?.seconds ?? 0) : null;
      }
      return values;
    });
  }, [rows]);
  return (
    <Panel title={t("Cumulative focus by Academic Year")} className="full-row">
      {!rows.length ? (
        <Empty />
      ) : (
        <ScrollChart width={0}>
          <LineChart
            data={data}
            onMouseMove={(state) => {
              interactive.enter();
              if (state.activeLabel !== undefined) setHover(Number(state.activeLabel));
            }}
            onMouseLeave={interactive.leave}
          >
            <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
            <XAxis dataKey="progress" type="number" domain={[0, 100]} tickFormatter={percent} />
            <YAxis tickFormatter={formatDurationAxis} />
            {rows.map((row, index) => (
              <Line
                key={row.year.id}
                dataKey={row.year.id}
                name={row.year.name}
                stroke={COLORS[index % COLORS.length]}
                dot={false}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
            <Tooltip
              active={interactive.active || undefined}
              wrapperStyle={{ pointerEvents: "auto" }}
              content={({ active }) => {
                if (!active || hover === undefined) return null;
                const entries = rows
                  .filter((row) => row.progress >= hover)
                  .map((row) => ({ row, point: row.points.filter((point) => point.progress <= hover).at(-1)! }))
                  .sort((a, b) => b.point.seconds - a.point.seconds);
                return (
                  <div className="chart-tooltip" onMouseEnter={interactive.enter} onMouseLeave={interactive.leave}>
                    {entries.map(({ row, point }) => (
                      <div key={row.year.id}>
                        <strong>
                          {row.year.name} · {percent(hover)}
                        </strong>
                        <p>
                          {exactDuration(point.seconds)} · {point.elapsedDays}/{point.totalDays} {t("days")}
                          {row.ongoing ? " · " + t("In progress") : ""}
                        </p>
                      </div>
                    ))}
                  </div>
                );
              }}
            />
            <Legend />
          </LineChart>
        </ScrollChart>
      )}
    </Panel>
  );
}

function useInteractiveTooltip() {
  const [active, setActive] = useState(false);
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timeout.current), []);
  return {
    active,
    enter: () => {
      clearTimeout(timeout.current);
      setActive(true);
    },
    leave: () => {
      clearTimeout(timeout.current);
      timeout.current = setTimeout(() => setActive(false), 200);
    },
  };
}
