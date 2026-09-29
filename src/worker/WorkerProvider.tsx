// src/worker/WorkerProvider.tsx
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import CsvWorker from './csv.worker?worker';
import type { ColumnMeta, Response } from './protocol';
import { WorkerContext, type WorkerState, type WorkerStatus } from './workerContext';

/**
 * Owns the one worker for the whole app. Mounted above the router in
 * main.tsx: the worker holds the only copy of the parsed data, so it must
 * outlive every route. Created inside a route component, navigating away
 * would unmount it, the cleanup would terminate() it, and the file would be
 * gone.
 */
export function WorkerProvider({ children }: { children: ReactNode }) {
  const [worker, setWorker] = useState<Worker | null>(null);
  const [status, setStatus] = useState<WorkerStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [rowCount, setRowCount] = useState(0);
  const [columns, setColumns] = useState<ColumnMeta[]>([]);
  const [bytes, setBytes] = useState(0);
  const [loadMs, setLoadMs] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Created in an effect, not with useState(() => new CsvWorker()). Under
  // StrictMode, dev runs mount → cleanup → mount; the cleanup terminates the
  // lazily-created instance and nothing makes a new one, leaving a dead
  // worker. Creating it here pairs every terminate() with a fresh worker.
  useEffect(() => {
    const w = new CsvWorker();

    // addEventListener, not onmessage. onmessage is a single slot and
    // usePageCache also listens to this worker (for 'page' replies);
    // whoever assigned onmessage last would silently cut the other off.
    const onMessage = (e: MessageEvent<Response>) => {
      const msg = e.data;
      if (msg.type === 'progress') setProgress(msg.rows);
      else if (msg.type === 'loaded') {
        setRowCount(msg.rows);
        setColumns(msg.columns);
        setBytes(msg.bytes);
        setLoadMs(msg.ms);
        setStatus('ready');
      } else if (msg.type === 'error') {
        setError(msg.message);
        setStatus('error');
      }
      // 'page' and 'filtered' belong to the page cache and the grid.
    };

    w.addEventListener('message', onMessage);
    // Setting state from an effect is the point here: the worker is an
    // external system, and consumers need a render once it exists.
    // eslint-disable-next-line react/set-state-in-effect
    setWorker(w);
    return () => {
      w.removeEventListener('message', onMessage);
      w.terminate();
    };
  }, []);

  const loadFile = useCallback((file: File) => {
    if (!worker) return;
    setError(null);
    setProgress(0);
    setRowCount(0);
    setColumns([]);
    setStatus('loading');
    worker.postMessage({ type: 'load', file });
  }, [worker]);

  // Memoized so a parent re-render doesn't hand every consumer a new object
  // and re-render them for nothing.
  const value = useMemo<WorkerState>(
    () => ({ worker, status, progress, rowCount, columns, bytes, loadMs, error, loadFile }),
    [worker, status, progress, rowCount, columns, bytes, loadMs, error, loadFile],
  );

  return <WorkerContext.Provider value={value}>{children}</WorkerContext.Provider>;
}
