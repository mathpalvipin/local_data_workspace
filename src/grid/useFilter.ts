// src/grid/useFilter.ts
import { useCallback, useEffect, useState } from 'react';
import type { FilterOp, Response } from '../worker/protocol';

export type Filter = { column: string; op: FilterOp; value: string };

/**
 * Filter state for a page that shows worker rows. The filtering itself runs
 * in the worker, next to the data; only the match count comes back, and the
 * grid pages through the matches like any other rows.
 */
export function useFilter(worker: Worker | null) {
  const [active, setActive] = useState<Filter | null>(null);
  const [matched, setMatched] = useState<number | null>(null);
  const [ms, setMs] = useState(0);
  const [pending, setPending] = useState(false);
  // Bumped on every result. Used as the grid's `key`, so a new result
  // remounts it: a fresh page cache (the old pages hold the old row order)
  // and scroll back to the top. Rejected: calling invalidate() and resetting
  // scroll by hand from here, which needs the grid's internals exposed.
  const [seq, setSeq] = useState(0);

  useEffect(() => {
    if (!worker) return;
    // addEventListener: WorkerProvider and usePageCache listen too.
    const onMessage = (e: MessageEvent<Response>) => {
      if (e.data.type !== 'filtered') return;
      setMatched(e.data.matched);
      setMs(e.data.ms);
      setPending(false);
      setSeq((s) => s + 1);
    };
    worker.addEventListener('message', onMessage);
    return () => {
      worker.removeEventListener('message', onMessage);
      // The filter belongs to this page. The worker keeps `matches` across
      // navigation, so leaving with a filter on would make the next visit
      // page through matches while showing the full row count.
      worker.postMessage({ type: 'clearFilter' });
    };
  }, [worker]);

  const apply = useCallback((f: Filter) => {
    if (!worker) return;
    setActive(f);
    setPending(true);
    worker.postMessage({ type: 'filter', ...f });
  }, [worker]);

  const clear = useCallback(() => {
    if (!worker) return;
    setActive(null);
    setPending(true);
    worker.postMessage({ type: 'clearFilter' });
  }, [worker]);

  return { active, matched, ms, pending, seq, apply, clear };
}
