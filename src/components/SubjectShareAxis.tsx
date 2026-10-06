import { useXAxisScale } from "recharts";
import type { SubjectSharePoint } from "../analytics/subjectData";

export function SubjectShareAxisTick({
  points,
  x = 0,
  y = 0,
  payload,
  className,
}: {
  points: SubjectSharePoint[];
  x?: number;
  y?: number;
  payload?: { value?: string };
  className?: string;
}) {
  const point = points.find((point) => point.key === payload?.value);
  if (!point) return null;
  return (
    <text className={className} x={x} y={y + 11} fill="var(--text-muted)" fontSize={11} textAnchor="middle">
      {point.dateLabel}
    </text>
  );
}

/** A separate axis label keeps years independent of rendered tick registration. */
export function SubjectShareYearLabels({
  points,
  viewBox,
}: {
  points: SubjectSharePoint[];
  viewBox?: { x?: number; y?: number; width?: number; height?: number };
}) {
  const scale = useXAxisScale();
  if (!scale || viewBox?.y === undefined || viewBox.height === undefined) return null;
  const groups = new Map<string, { first: string; last: string }>();
  for (const point of points) {
    const group = groups.get(point.yearLabel);
    if (group) group.last = point.key;
    else groups.set(point.yearLabel, { first: point.key, last: point.key });
  }
  return (
    <g className="subject-share-years" fill="var(--text-muted)" fontSize={11} textAnchor="middle" opacity={0.75}>
      {[...groups].map(([year, group]) => {
        const firstX = scale(group.first),
          lastX = scale(group.last);
        if (firstX === undefined || lastX === undefined) return null;
        return (
          <text key={year} x={(firstX + lastX) / 2} y={viewBox.y! + viewBox.height! - 4}>
            {year}
          </text>
        );
      })}
    </g>
  );
}
