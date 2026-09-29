import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeWorker } from '../test/fakeWorker';
import { useWorkerContext } from './workerContext';

// The provider does `new CsvWorker()`. Replace the Vite worker import with a
// constructor that hands back the current fake. A function, not a class:
// `new` on a function that returns an object yields that object.
let fake = createFakeWorker();
vi.mock('./csv.worker?worker', () => ({
  default: function FakeCsvWorker() {
    return fake.worker;
  },
}));

const { WorkerProvider } = await import('./WorkerProvider');
const wrapper = ({ children }: { children: ReactNode }) => <WorkerProvider>{children}</WorkerProvider>;

const columns = [{ name: 'id', kind: 'int32', bytes: 4 }];

describe('WorkerProvider', () => {
  beforeEach(() => {
    fake = createFakeWorker();
  });

  it('creates the worker and starts idle', () => {
    const { result } = renderHook(() => useWorkerContext(), { wrapper });
    expect(result.current.worker).toBe(fake.worker);
    expect(result.current.status).toBe('idle');
  });

  it('loadFile posts the file and moves to loading', () => {
    const { result } = renderHook(() => useWorkerContext(), { wrapper });
    const file = new File(['a\n1'], 'x.csv');

    act(() => result.current.loadFile(file));

    expect(fake.postMessage).toHaveBeenCalledWith({ type: 'load', file });
    expect(result.current.status).toBe('loading');
    expect(result.current.progress).toBe(0);
  });

  it('tracks progress, then the loaded result', () => {
    const { result } = renderHook(() => useWorkerContext(), { wrapper });
    act(() => result.current.loadFile(new File(['x'], 'x.csv')));

    act(() => fake.reply({ type: 'progress', rows: 1234 }));
    expect(result.current.progress).toBe(1234);

    act(() => fake.reply({
      type: 'loaded', rows: 500_000, columns, bytes: 32_300_000, ms: 2179,
      timings: { read: 1, infer: 1, parse: 1, finalize: 1, total: 4 },
    }));
    expect(result.current.status).toBe('ready');
    expect(result.current.rowCount).toBe(500_000);
    expect(result.current.columns).toEqual(columns);
    expect(result.current.bytes).toBe(32_300_000);
    expect(result.current.loadMs).toBe(2179);
  });

  it('reports worker errors', () => {
    const { result } = renderHook(() => useWorkerContext(), { wrapper });
    act(() => fake.reply({ type: 'error', message: 'bad file' }));
    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('bad file');
  });

  it('ignores page and filtered messages', () => {
    const { result } = renderHook(() => useWorkerContext(), { wrapper });
    act(() => fake.reply({ type: 'page', start: 0, rows: [] }));
    act(() => fake.reply({ type: 'filtered', matched: 3, ms: 1 }));
    expect(result.current.status).toBe('idle');
  });

  it('terminates the worker on unmount', () => {
    const { unmount } = renderHook(() => useWorkerContext(), { wrapper });
    unmount();
    expect(fake.terminate).toHaveBeenCalled();
  });
});
