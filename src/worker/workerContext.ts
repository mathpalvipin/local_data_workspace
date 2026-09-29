// src/worker/workerContext.ts
import { createContext, useContext } from 'react';
import type { ColumnMeta } from './protocol';

export type WorkerStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Everything the UI knows about the loaded file. Note what is NOT here:
 * the rows. They stay in the worker; pages fetch them through usePageCache.
 */
export type WorkerState = {
  worker: Worker | null;
  status: WorkerStatus;
  progress: number;       // rows parsed so far during a load
  rowCount: number;
  columns: ColumnMeta[];
  bytes: number;          // retained size of the column store
  loadMs: number;
  error: string | null;
  loadFile: (file: File) => void;
};

// Lives in a .ts file, apart from <WorkerProvider>. A .tsx exporting both a
// component and a hook can't be hot-swapped by Vite Fast Refresh (oxlint's
// only-export-components flags it), so every edit would reload the page —
// and a page reload throws away the worker and the parsed file with it.
export const WorkerContext = createContext<WorkerState | null>(null);

export function useWorkerContext(): WorkerState {
  const ctx = useContext(WorkerContext);
  // Throw rather than return a default. A silent default (idle, no worker)
  // would make a missing provider look like "no file loaded yet".
  if (!ctx) throw new Error('useWorkerContext must be used inside <WorkerProvider>');
  return ctx;
}
