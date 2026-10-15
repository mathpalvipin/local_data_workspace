// src/pages/PreviewPage.tsx
import { useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Grid, type GridHandle } from '../grid/Grid';
import { useFilter, type Filter } from '../grid/useFilter';
import type { FilterOp } from '../worker/protocol';
import { useWorkerContext } from '../worker/workerContext';

// One per order of magnitude: each lands in a page that isn't cached yet,
// so every jump shows the placeholder → real-row swap.
const JUMPS = [4_000, 40_000, 400_000];

const OPS: { op: FilterOp; label: string }[] = [
  { op: 'contains', label: 'contains' },
  { op: 'eq', label: '=' },
  { op: 'gt', label: '>' },
  { op: 'lt', label: '<' },
];

export function PreviewPage() {
  const { worker, status, rowCount, columns } = useWorkerContext();
  // Before the redirect below: hooks can't come after an early return.
  const gridRef = useRef<GridHandle>(null);
  const filter = useFilter(worker);

  // The data exists only in worker memory. A refresh or a cold deep-link to
  // /preview starts a fresh worker with nothing loaded, so there is nothing
  // to show. Persisting the store (OPFS / IndexedDB) was deferred: re-parsing
  // costs ~2s, while a 32MB cache brings invalidation and schema-versioning
  // problems that aren't worth it yet.
  if (status !== 'ready') return <Navigate to="/" replace />;

  // Rows the grid shows: the last count the worker confirmed, not the filter
  // the user just asked for. Switching early would page the old result with
  // the new count for the moment until the reply lands.
  const shown = filter.matched ?? rowCount;

  return (
    <div className="preview">
      <header className="preview-bar">
        <Link to="/">← Back</Link>
        <h2>{rowCount.toLocaleString()} rows × {columns.length} columns</h2>
        <nav className="jumps" aria-label="Go to row">
          {JUMPS.map((row) => (
            <button
              key={row}
              className="jump"
              onClick={() => gridRef.current?.scrollToRow(row)}
              disabled={row >= shown}
            >
              row {row / 1000}k
            </button>
          ))}
        </nav>
      </header>

      <FilterBar
        columns={columns}
        onApply={filter.apply}
        onClear={filter.clear}
        canClear={filter.active !== null}
        pending={filter.pending}
        summary={
          filter.active && filter.matched !== null && !filter.pending
            ? `${filter.matched.toLocaleString()} of ${rowCount.toLocaleString()} rows match · ${filter.ms.toFixed(0)}ms`
            : null
        }
      />

      {/* The grid measures its own height, so this wrapper decides it: the
          rest of the screen, whatever size that is. */}
      <div className="preview-grid">
        <Grid key={filter.seq} ref={gridRef} worker={worker} rowCount={shown} columns={columns} />
      </div>
    </div>
  );
}

function FilterBar({
  columns,
  onApply,
  onClear,
  canClear,
  pending,
  summary,
}: {
  columns: { name: string }[];
  onApply: (f: Filter) => void;
  onClear: () => void;
  canClear: boolean;
  pending: boolean;
  summary: string | null;
}) {
  const [column, setColumn] = useState(columns[0]?.name ?? '');
  const [op, setOp] = useState<FilterOp>('contains');
  const [value, setValue] = useState('');

  return (
    <form
      className="filter-bar"
      aria-label="Filter rows"
      onSubmit={(e) => {
        e.preventDefault();
        onApply({ column, op, value });
      }}
    >
      <select aria-label="Column" value={column} onChange={(e) => setColumn(e.target.value)}>
        {columns.map((c) => (
          <option key={c.name} value={c.name}>{c.name}</option>
        ))}
      </select>
      <select aria-label="Operator" value={op} onChange={(e) => setOp(e.target.value as FilterOp)}>
        {OPS.map((o) => (
          <option key={o.op} value={o.op}>{o.label}</option>
        ))}
      </select>
      <input
        aria-label="Value"
        placeholder="value"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button type="submit" className="jump" disabled={pending}>Apply</button>
      <button type="button" className="jump" onClick={onClear} disabled={pending || !canClear}>
        Clear
      </button>
      <span className="filter-summary" role="status">
        {pending ? 'Filtering…' : summary}
      </span>
    </form>
  );
}
