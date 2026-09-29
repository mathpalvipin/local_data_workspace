import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { WorkerContext, useWorkerContext, type WorkerState } from './workerContext';

describe('useWorkerContext', () => {
  it('throws a clear error outside <WorkerProvider>', () => {
    // React logs the thrown error; keep the test output clean.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useWorkerContext())).toThrow(
      'useWorkerContext must be used inside <WorkerProvider>',
    );
  });

  it('returns the provided state', () => {
    const state: WorkerState = {
      worker: null, status: 'idle', progress: 0, rowCount: 0, columns: [],
      bytes: 0, loadMs: 0, error: null, loadFile: () => {},
    };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <WorkerContext.Provider value={state}>{children}</WorkerContext.Provider>
    );
    const { result } = renderHook(() => useWorkerContext(), { wrapper });
    expect(result.current).toBe(state);
  });
});
