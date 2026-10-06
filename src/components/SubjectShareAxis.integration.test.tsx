// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { AreaChart, Area, XAxis, YAxis } from "recharts";
import { expect, it, vi } from "vitest";
import { SubjectShareAxisTick, SubjectShareYearLabels } from "./SubjectShareAxis";
import type { SubjectSharePoint } from "../analytics/subjectData";

it("renders each year beneath its months inside the actual chart", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const points: SubjectSharePoint[] = [
    { key: "2026-10-01", label: "Oct 2026", dateLabel: "Oct", yearLabel: "2026", shares: { a: 100 } },
    { key: "2026-11-01", label: "Nov 2026", dateLabel: "Nov", yearLabel: "2026", shares: { a: 100 } },
    { key: "2027-01-01", label: "Jan 2027", dateLabel: "Jan", yearLabel: "2027", shares: { a: 100 } },
  ];
  const host = document.createElement("div"),
    root = createRoot(host);
  document.body.append(host);
  try {
    await act(async () =>
      root.render(
        <AreaChart width={600} height={290} data={points} margin={{ top: 5, right: 30, bottom: 5, left: 5 }}>
          <XAxis
            dataKey="key"
            allowDuplicatedCategory={false}
            interval={0}
            height={44}
            tick={<SubjectShareAxisTick points={points} />}
            label={<SubjectShareYearLabels points={points} />}
          />
          <YAxis domain={[0, 100]} />
          <Area dataKey={(point) => point.shares.a} type="linear" isAnimationActive={false} />
        </AreaChart>,
      ),
    );
    const labels = [...host.querySelectorAll("svg text")];
    expect(labels.map((label) => label.textContent)).toContain("Oct");
    expect(labels.map((label) => label.textContent)).toContain("2026");
    expect(labels.map((label) => label.textContent)).toContain("2027");
    const years = [...host.querySelectorAll(".subject-share-years text")];
    expect(years).toHaveLength(2);
    for (const year of years) expect(Number(year.getAttribute("y"))).toBeLessThan(290);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});
