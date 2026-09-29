// src/pages/PreviewPage.tsx
import { useRef } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Grid, type GridHandle } from '../grid/Grid';
import { useWorkerContext } from '../worker/workerContext';

// One per order of magnitude: each lands in a page that isn't cached yet,
// so every jump shows the placeholder → real-row swap.
const JUMPS = [4_000, 40_000, 400_000];

export function PreviewPage() {
  const { worker, status, rowCount, columns } = useWorkerContext();
  // Before the redirect below: hooks can't come after an early return.
  const gridRef = useRef<GridHandle>(null);

  // The data exists only in worker memory. A refresh or a cold deep-link to
  // /preview starts a fresh worker with nothing loaded, so there is nothing
  // to show. Persisting the store (OPFS / IndexedDB) was deferred: re-parsing
  // costs ~2s, while a 32MB cache brings invalidation and schema-versioning
  // problems that aren't worth it yet.
  if (status !== 'ready') return <Navigate to="/" replace />;

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
              disabled={row >= rowCount}
            >
              row {row / 1000}k
            </button>
          ))}
        </nav>
      </header>
      {/* The grid measures its own height, so this wrapper decides it: the
          rest of the screen, whatever size that is. */}
      <div className="preview-grid">
        <Grid ref={gridRef} worker={worker} rowCount={rowCount} columns={columns} />
      </div>
    </div>
  );
}
