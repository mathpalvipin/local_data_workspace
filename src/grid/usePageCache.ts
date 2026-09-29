// src/grid/usePageCache.ts
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Response } from '../worker/protocol';

const PAGE_SIZE = 200;
const MAX_PAGES = 20;   // ~4,000 rows retained on the main thread

export function usePageCache(worker: Worker | null) {
  // The cache itself lives in a ref, not state.
  //
  // WHY: putting a Map in useState means replacing it on every arrival to
  // trigger a render. A ref plus an explicit version counter separates the
  // two concerns — storage, and "tell React something changed" — and makes
  // it obvious exactly when a re-render happens.
  const pages = useRef(new Map<number, string[][]>());
  const inFlight = useRef(new Set<number>());

  // Bumped whenever a page arrives, to trigger a re-render.
  //
  // TRADEOFF, and it's the Part 4 lesson again: this re-renders the whole
  // grid on every page arrival. During a fast scroll that's a handful per
  // second, which is fine. If it ever became a problem, the fix is to make
  // rows subscribe individually rather than re-rendering the parent —
  // more machinery for a cost you haven't measured yet.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!worker) return;

    const onMessage = (e: MessageEvent<Response>) => {
      const msg = e.data;
      if (msg.type !== 'page') return;      // not ours; App handles the rest

      const pageIndex = msg.start / PAGE_SIZE;
      inFlight.current.delete(pageIndex);

      // LRU insert. Map preserves insertion order, so the first key is
      // the least recently touched.
      const cache = pages.current;
      cache.set(pageIndex, msg.rows);
      while (cache.size > MAX_PAGES) {
        const oldest = cache.keys().next().value as number;
        cache.delete(oldest);
      }

      setVersion(v => v + 1);
    };

    // addEventListener, not onmessage — App owns that single slot.
    worker.addEventListener('message', onMessage);
    return () => worker.removeEventListener('message', onMessage);
  }, [worker]);

  /** Drop everything. Call when the filter or sort changes. */
  const invalidate = useCallback(() => {
    pages.current.clear();
    inFlight.current.clear();
    setVersion(v => v + 1);
  }, []);

  /**
   * Get one row, or null if it isn't loaded yet.
   *
   * Note the side effect: a miss requests the page. That's deliberate —
   * the grid asks for what it wants to render, and fetching follows
   * from rendering rather than being orchestrated separately.
   */
  const getRow = useCallback((rowIndex: number): string[] | null => {
    const pageIndex = Math.floor(rowIndex / PAGE_SIZE);
    const cache = pages.current;
    const page = cache.get(pageIndex);

    if (page) {
      // Touch for LRU: delete + set moves this key to the end.
      cache.delete(pageIndex);
      cache.set(pageIndex, page);
      return page[rowIndex % PAGE_SIZE] ?? null;
    }

    // Miss. Request it, unless it's already on its way.
    if (worker && !inFlight.current.has(pageIndex)) {
      inFlight.current.add(pageIndex);
      worker.postMessage({
        type: 'page',
        start: pageIndex * PAGE_SIZE,
        count: PAGE_SIZE,
      });
    }
    return null;
  }, [worker]);

  return { getRow, invalidate, version };
}