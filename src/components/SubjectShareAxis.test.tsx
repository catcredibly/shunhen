import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { SubjectShareAxisTick, SubjectShareYearLabels } from "./SubjectShareAxis";
import type { SubjectSharePoint } from "../analytics/subjectData";

const axis = vi.hoisted(() => ({ coordinates: new Map<string, number>() }));
vi.mock("recharts", () => ({ useXAxisScale: () => (key: string) => axis.coordinates.get(key) }));
const points: SubjectSharePoint[] = [
  { key: "2024-10-01", yearLabel: "2024", dateLabel: "Oct" },
  { key: "2025-03-01", yearLabel: "2025", dateLabel: "Mar" },
  { key: "2025-04-01", yearLabel: "2025", dateLabel: "Apr" },
  { key: "2025-09-01", yearLabel: "2025", dateLabel: "Sep" },
  { key: "2026-01-01", yearLabel: "2026", dateLabel: "Jan" },
  { key: "2026-04-01", yearLabel: "2026", dateLabel: "Apr" },
].map((point) => ({ ...point, label: `${point.dateLabel} ${point.yearLabel}`, shares: { subject: 100 } }));

it.each([58, 92])(
  "centers each year once beneath visible months at %ipx spacing, regardless of calendar gaps",
  (spacing) => {
    axis.coordinates = new Map(points.map((point, index) => [point.key, 60 + index * spacing]));
    const html = renderToStaticMarkup(
      <svg>
        {points.map((point, index) => (
          <SubjectShareAxisTick
            key={point.key}
            points={points}
            payload={{ value: point.key }}
            x={60 + index * spacing}
            y={250}
          />
        ))}
        <SubjectShareYearLabels points={points} viewBox={{ y: 241, height: 44 }} />
      </svg>,
    );
    expect(html.match(/>2024</g)).toHaveLength(1);
    expect(html.match(/>2025</g)).toHaveLength(1);
    expect(html.match(/>2026</g)).toHaveLength(1);
    expect(html).toContain('x="60" y="281"');
    expect(html).toContain(`x="${60 + spacing * 2}" y="281"`);
    expect(html).toContain(`x="${60 + spacing * 4.5}" y="281"`);
    expect(html).toContain('y="261"');
    expect(html).toContain('opacity="0.75"');
  },
);
