// src/grid/geometry.ts

/**
 * Scroll math for the virtual grid. Pure functions, no DOM: every row is the
 * same height, so "which rows are visible" is division, not measurement.
 *
 * WHY fixed height: variable heights break the arithmetic scrollTop → row
 * mapping and need a measurement cache plus binary search (Decision.md,
 * Known limitations). Not worth it for a table of short cells.
 */
export const ROW_HEIGHT = 32;

/**
 * Rows rendered beyond each edge of the viewport. A fast scroll moves further
 * than one frame's worth of rows; without the margin the edge flashes empty
 * before React catches up. 10 rows ≈ 320px of slack each way.
 */
export const OVERSCAN = 10;

/**
 * Height of the full, mostly empty, scrollable area. 500k × 32 = 16M px,
 * inside Chrome's ~33.5M px element limit but near Firefox's ~17.9M. Much
 * larger files would need scaled scrolling.
 */
export function totalHeight(rowCount: number): number {
  return rowCount * ROW_HEIGHT;
}

/** Rows to render for this scroll position, including overscan. `end` is exclusive. */
export function visibleRange(
  scrollTop: number,
  viewportHeight: number,
  rowCount: number,
): { start: number; end: number } {
  const first = Math.floor(scrollTop / ROW_HEIGHT);
  const visible = Math.ceil(viewportHeight / ROW_HEIGHT);
  const start = Math.max(0, first - OVERSCAN);
  const end = Math.min(rowCount, first + visible + OVERSCAN);
  return { start, end: Math.max(start, end) };
}

/** Y offset of row `start` within the spacer. */
export function offsetFor(start: number): number {
  return start * ROW_HEIGHT;
}
