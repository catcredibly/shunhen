import type { ClockFormat, DateFormat, Locale, WeekdayStyle } from "./settings";

/** Presentation-only: keep the saved format intact across locale changes/backups. */
export function effectiveTimerDateFormat(locale: Locale, saved: DateFormat): DateFormat {
  return saved === "standard" && ["zh-CN", "zh-TW", "ja"].includes(locale) ? "full" : saved;
}
export function timerDateFormats(locale: Locale): DateFormat[] {
  return (["full", "standard", "compact", "numeric"] as const).filter(
    (format) => effectiveTimerDateFormat(locale, format) === format,
  );
}

export function formatTimerDate(
  date: Date,
  locale: Locale,
  format: DateFormat,
  showWeekday: boolean,
  weekdayStyle: WeekdayStyle = "short",
) {
  format = effectiveTimerDateFormat(locale, format);
  const options: Intl.DateTimeFormatOptions =
    format === "full"
      ? { year: "numeric", month: "long", day: "numeric" }
      : format === "standard"
        ? { year: "numeric", month: "short", day: "numeric" }
        : format === "compact"
          ? { month: "short", day: "numeric" }
          : { year: "numeric", month: "2-digit", day: "2-digit" };
  if (showWeekday) options.weekday = weekdayStyle === "full" ? "long" : "short";
  return new Intl.DateTimeFormat(locale, options).format(date);
}

export function formatTimerClock(date: Date, locale: Locale, format: ClockFormat) {
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    ...(format === "system" ? {} : { hour12: format === "12-hour" }),
  }).format(date);
}

export function formatTimerDateTime(
  date: Date,
  locale: Locale,
  options: {
    showDate: boolean;
    dateFormat: DateFormat;
    showWeekday: boolean;
    weekdayStyle?: WeekdayStyle;
    showClock: boolean;
    clockFormat: ClockFormat;
  },
) {
  const parts = [
    options.showDate
      ? formatTimerDate(date, locale, options.dateFormat, options.showWeekday, options.weekdayStyle)
      : "",
    options.showClock ? formatTimerClock(date, locale, options.clockFormat) : "",
  ].filter(Boolean);
  return parts.join(" · ");
}
