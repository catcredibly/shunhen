import type { DockCorner, DockEdge } from "./settings";

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export type WorkArea = Point & Size;

export const POPOUT_SIZE: Size = { width: 360, height: 170 };
const DOCK_MARGIN = 12;
const SNAP_THRESHOLD = 52;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(Math.max(value, minimum), Math.max(minimum, maximum));

export function cornerPosition(workArea: WorkArea, size: Size, corner: DockCorner, margin = DOCK_MARGIN): Point {
  const left = workArea.x + margin;
  const right = workArea.x + workArea.width - size.width - margin;
  const top = workArea.y + margin;
  const bottom = workArea.y + workArea.height - size.height - margin;
  return { x: corner.endsWith("left") ? left : right, y: corner.startsWith("top") ? top : bottom };
}

export function nearestDockCorner(
  position: Point,
  workArea: WorkArea,
  size: Size,
  threshold = SNAP_THRESHOLD,
): DockCorner | null {
  const corners: DockCorner[] = ["top-left", "top-right", "bottom-left", "bottom-right"];
  let nearest: { corner: DockCorner; distance: number } | null = null;
  for (const corner of corners) {
    const target = cornerPosition(workArea, size, corner);
    const distance = Math.hypot(position.x - target.x, position.y - target.y);
    if (!nearest || distance < nearest.distance) nearest = { corner, distance };
  }
  return nearest && nearest.distance <= threshold ? nearest.corner : null;
}

export function clampFreePosition(position: Point, workArea: WorkArea, size: Size): Point {
  return {
    x: clamp(position.x, workArea.x, workArea.x + workArea.width - size.width),
    y: clamp(position.y, workArea.y, workArea.y + workArea.height - size.height),
  };
}

export function edgesForCorner(corner: DockCorner): DockEdge[] {
  return [corner.startsWith("top") ? "top" : "bottom", corner.endsWith("left") ? "left" : "right"];
}

export function defaultEdgeForCorner(corner: DockCorner, previous: DockEdge = "right"): DockEdge {
  const edges = edgesForCorner(corner);
  return edges.includes(previous) ? previous : edges[previous === "top" || previous === "bottom" ? 0 : 1];
}

export function dockEdgeOffset(corner: DockCorner, edge: DockEdge): number {
  return edge === "top" || edge === "bottom" ? (corner.endsWith("left") ? 0 : 1) : corner.startsWith("top") ? 0 : 1;
}

/** Inputs are physical pixels; only the ambiguity threshold starts in logical px. */
export function nearestEdge(position: Point, workArea: WorkArea, size: Size, previous?: DockEdge, scale = 1): DockEdge {
  const distances: [DockEdge, number][] = [
    ["left", Math.abs(position.x - workArea.x)],
    ["right", Math.abs(workArea.x + workArea.width - position.x - size.width)],
    ["top", Math.abs(position.y - workArea.y)],
    ["bottom", Math.abs(workArea.y + workArea.height - position.y - size.height)],
  ];
  distances.sort((left, right) => left[1] - right[1]);
  const previousDistance = distances.find(([edge]) => edge === previous)?.[1];
  if (previous && previousDistance !== undefined && previousDistance <= distances[0][1] + 28 * scale) return previous;
  return distances[0][0];
}

export function edgeOffset(position: Point, workArea: WorkArea, size: Size, edge: DockEdge): number {
  const span = edge === "left" || edge === "right" ? workArea.height : workArea.width;
  const value =
    edge === "left" || edge === "right"
      ? position.y + size.height / 2 - workArea.y
      : position.x + size.width / 2 - workArea.x;
  return span <= 0 ? 0 : clamp(value / span, 0, 1);
}
