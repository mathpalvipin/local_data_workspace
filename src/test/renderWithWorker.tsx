// src/test/renderWithWorker.tsx
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';
import { WorkerContext, type WorkerState } from '../worker/workerContext';

export function workerState(overrides: Partial<WorkerState> = {}): WorkerState {
  return {
    worker: null, status: 'idle', progress: 0, rowCount: 0, columns: [],
    bytes: 0, loadMs: 0, error: null, loadFile: vi.fn(), ...overrides,
  };
}

/**
 * Render a page at `path` with a hand-built worker context, instead of the
 * real WorkerProvider, so each test controls status, rows and columns.
 * The other routes render a marker, so navigation can be asserted.
 */
export function renderPage(page: ReactElement, path: string, state: WorkerState) {
  return render(
    <WorkerContext.Provider value={state}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path={path} element={page} />
          {['/', '/preview', '/bench']
            .filter((p) => p !== path)
            .map((p) => <Route key={p} path={p} element={<div>route: {p}</div>} />)}
        </Routes>
      </MemoryRouter>
    </WorkerContext.Provider>,
  );
}
