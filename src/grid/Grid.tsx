// src/grid/Grid.tsx
import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type Ref,
} from 'react';
import { ROW_HEIGHT, offsetFor, totalHeight, visibleRange } from './geometry';
import { usePageCache } from './usePageCache';

/** Commands a parent can send the grid, e.g. "jump to row 400,000". */
export type GridHandle = {
  scrollToRow: (row: number) => void;
};

type GridProps = {
  worker: Worker | null;
  rowCount: number;
  columns: { name: string; kind: string }[];
  ref?: Ref<GridHandle>;
};

const NUMERIC_KINDS = new Set(['int32', 'float32']);
const MIN_COL_WIDTH = 140;

// Used until ResizeObserver reports. Deliberately generous: rendering a few
// extra rows once is harmless, while too small a guess would show an empty
// band at the bottom for the first frame.
const FALLBACK_VIEWPORT_HEIGHT = 800;

export function Grid({ worker, rowCount, columns, ref }: GridProps) {
  // The cache is owned here, so each `version` bump (a page arrived) is a
  // state change in this component and re-renders the visible rows. No
  // explicit `version` dependency is needed: rows are read during render.
  const { getRow } = usePageCache(worker);

  const viewportRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(FALLBACK_VIEWPORT_HEIGHT);

  // Jumping sets the viewport's real scrollTop rather than the scrollTop
  // state. Rejected: setting the state directly, which would render rows
  // 400k+ while the scrollbar stays at the top; the next scroll event would
  // snap back. Moving the actual scroll position fires a normal scroll event,
  // so the one onScroll path stays the single source of truth.
  // An imperative handle rather than a `scrollToRow` prop: a prop is state
  // ("be at row X"), and clicking the same button twice after the user
  // scrolled away wouldn't change it, so nothing would happen.
  useImperativeHandle(ref, () => ({
    scrollToRow: (row) => {
      const el = viewportRef.current;
      if (!el) return;
      const clamped = Math.max(0, Math.min(row, rowCount - 1));
      // The header is one row tall and sticky, so this puts `row` directly under it.
      el.scrollTop = clamped * ROW_HEIGHT;
    },
  }), [rowCount]);

  // Measured, not hardcoded: the grid fills whatever space the page gives it,
  // which differs between desktop, a phone and a resized window.
  // ResizeObserver rather than a window 'resize' listener: the viewport can
  // change size without the window resizing (layout shifts, a panel opening).
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setViewportHeight(entry.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Don't read rows until usePageCache's listener is attached. getRow() fires
  // a page request on a miss; its effect subscribes to the worker only after
  // the first commit, so a reply racing ahead of that subscription would be
  // dropped, and the page would stay "in flight" forever, showing
  // placeholders. Effects run in declaration order, so by the time this one
  // runs, the hook's listener exists.
  const [listening, setListening] = useState(false);
  // eslint-disable-next-line react/set-state-in-effect
  useEffect(() => setListening(true), []);

  // The header sits inside the scroll container and is exactly one row tall,
  // so body rows begin one ROW_HEIGHT down. The body viewport is therefore
  // one row shorter, and scrollTop maps to a row index with no header offset.
  const bodyHeight = Math.max(0, viewportHeight - ROW_HEIGHT);
  const { start, end } = visibleRange(scrollTop, bodyHeight, rowCount);

  // Identical template on the header and every row: separate declarations
  // could drift, and a header one pixel off its column reads as broken.
  const template: CSSProperties = {
    gridTemplateColumns: `repeat(${columns.length}, minmax(${MIN_COL_WIDTH}px, 1fr))`,
  };
  const align = columns.map((c) => (NUMERIC_KINDS.has(c.kind) ? 'num' : 'text'));

  const rows: ReactElement[] = [];
  for (let i = start; i < end; i++) {
    const row = listening ? getRow(i) : null;
    rows.push(
      // key = absolute row index. Keying by position in the window (i - start)
      // makes React treat "slot 0" as the same element while it shows row
      // 1000, then 1001, rewriting every cell on every scroll step and
      // carrying any DOM state (selection, focus) onto the wrong row.
      <div
        key={i}
        className={row ? 'grid-row' : 'grid-row placeholder'}
        style={template}
        aria-rowindex={i + 2}
      >
        {row
          ? row.map((v, c) => (
              <div key={c} className={`grid-cell ${align[c]}`} title={v}>
                {v}
              </div>
            ))
          : // Not loaded yet: same height, dimmed, a dash per cell.
            // Rejected: an empty row, which collapses the grid visually and
            // looks like missing data. Rejected: showing the previous row's
            // values until the real ones arrive, which is actively
            // misleading, because the user would read wrong numbers as real.
            columns.map((_, c) => (
              <div key={c} className={`grid-cell ${align[c]}`}>
                —
              </div>
            ))}
      </div>,
    );
  }

  return (
    <div
      ref={viewportRef}
      className="grid-viewport"
      role="grid"
      aria-rowcount={rowCount + 1}
      // Not debounced or throttled, on purpose: every scroll event updates
      // state so the rendered window never lags the scrollbar. Rendering
      // ~50 rows is cheap; revisit only if the frame counter shows stalls
      // during a fast scroll. Measure first, then optimize.
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
    >
      <div className="grid-content" style={{ minWidth: columns.length * MIN_COL_WIDTH }}>
        <div className="grid-header" style={template} role="row">
          {columns.map((c, i) => (
            <div key={c.name} className={`grid-cell ${align[i]}`} title={`${c.name} (${c.kind})`}>
              {c.name}
            </div>
          ))}
        </div>

        <div className="grid-spacer" style={{ height: totalHeight(rowCount) }}>
          {/* Positioned with transform, never `top` / `margin-top`. A
              transform is applied by the compositor and skips Layout; `top`
              is geometry, so changing it on every scroll event forces a
              layout pass over all ~50 rows × N cells, which shows up as jank
              in a fast scroll.

              The offset comes from `start`, not `scrollTop`. `start` is
              OVERSCAN rows above the first visible row, so offsetting by
              scrollTop would draw everything OVERSCAN * ROW_HEIGHT
              (320px today) too low. */}
          <div className="grid-rows" style={{ transform: `translateY(${offsetFor(start)}px)` }}>
            {rows}
          </div>
        </div>
      </div>
    </div>
  );
}
