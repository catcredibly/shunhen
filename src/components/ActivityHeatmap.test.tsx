// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { ActivityHeatmap } from "./ActivityHeatmap";

vi.mock("../analytics/SnapshotContext", () => ({
  useAnalyticsSnapshot: () => ({ getDailyTotals: () => [], getDays: () => [] }),
}));
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (text: string) => text }),
}));

function renderRange(start: Date, end: Date) {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<ActivityHeatmap sessions={[]} start={start.getTime()} end={end.getTime()} />);
  return host;
}

it("separates years from partial-month labels without changing their week columns", () => {
  const host = renderRange(new Date(2026, 8, 28), new Date(2026, 9, 5));
  const year = host.querySelector<HTMLElement>(".heatmap-years span")!;
  expect(year.textContent).toBe("2026");
  expect(year.style.left).toBe("0px");
  const months = [...host.querySelectorAll<HTMLElement>(".heatmap-months span")];
  expect(months.map((span) => span.textContent)).toEqual(["Sep", "Oct"]);
  expect(months.map((span) => span.style.left)).toEqual(["0px", "14px"]);
  expect(host.querySelector(".heatmap-years")!.nextElementSibling?.className).toBe("heatmap-months");
  expect(host.querySelector(".heatmap-months")!.nextElementSibling?.className).toBe("heatmap-weeks");
  expect(host.querySelectorAll(".heatmap-week")).toHaveLength(2);
  expect(host.querySelectorAll(".heatmap-week button")).toHaveLength(8);
  expect([...host.querySelectorAll(".weekday-labels span")].map((span) => span.textContent)).toEqual([
    "Mon",
    "Wed",
    "Fri",
    "Sun",
  ]);
});

it("aligns each year with its first visible week, including a midweek New Year", () => {
  const start = new Date(2026, 10, 15),
    end = new Date(2028, 1, 10);
  const host = renderRange(start, end);
  const weeks = [...host.querySelectorAll(".heatmap-week")];
  const labels = [...host.querySelectorAll<HTMLElement>(".heatmap-years span")];
  expect(labels.map((span) => span.textContent)).toEqual(["2026", "2027", "2028"]);
  for (const label of labels) {
    const year = Number(label.textContent);
    const weekIndex = weeks.findIndex((week) =>
      [...week.querySelectorAll("button")].some((button) => button.title.split("\n")[0].includes(String(year))),
    );
    expect(label.style.left).toBe(`${weekIndex * 14}px`);
    expect(label.parentElement!.style.width).toBe(`${weeks.length * 14}px`);
  }
  expect(
    [...host.querySelectorAll(".heatmap-months span")].every((span) => !/\d{4}/.test(span.textContent ?? "")),
  ).toBe(true);
});

it("does not overlap year labels when the whole visible range shares a New Year week", () => {
  const host = renderRange(new Date(2026, 11, 31), new Date(2027, 0, 2));
  const labels = [...host.querySelectorAll<HTMLElement>(".heatmap-years span")];
  expect(labels).toHaveLength(1);
  expect(labels[0].textContent).toBe("2026 / 2027");
  expect(labels[0].style.left).toBe("0px");
});
