import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createFakeWorker } from '../test/fakeWorker';
import { useFilter } from './useFilter';

const f = { column: 'region', op: 'eq', value: 'us-east' } as const;

describe('useFilter', () => {
  it('starts with no filter and no result', () => {
    const { result } = renderHook(() => useFilter(createFakeWorker().worker));
    expect(result.current.active).toBeNull();
    expect(result.current.matched).toBeNull();
    expect(result.current.pending).toBe(false);
  });

  it('apply posts the filter and waits for the result', () => {
    const fake = createFakeWorker();
    const { result } = renderHook(() => useFilter(fake.worker));

    act(() => result.current.apply(f));
    expect(fake.postMessage).toHaveBeenCalledWith({ type: 'filter', ...f });
    expect(result.current.active).toEqual(f);
    expect(result.current.pending).toBe(true);

    const seq = result.current.seq;
    act(() => fake.reply({ type: 'filtered', matched: 12, ms: 3.5 }));
    expect(result.current.matched).toBe(12);
    expect(result.current.ms).toBe(3.5);
    expect(result.current.pending).toBe(false);
    expect(result.current.seq).toBe(seq + 1); // remounts the grid
  });

  it('clear posts clearFilter and drops the active filter', () => {
    const fake = createFakeWorker();
    const { result } = renderHook(() => useFilter(fake.worker));
    act(() => result.current.apply(f));
    act(() => result.current.clear());
    expect(fake.postMessage).toHaveBeenLastCalledWith({ type: 'clearFilter' });
    expect(result.current.active).toBeNull();
  });

  it('ignores other worker messages', () => {
    const fake = createFakeWorker();
    const { result } = renderHook(() => useFilter(fake.worker));
    act(() => fake.reply({ type: 'progress', rows: 5 }));
    expect(result.current.matched).toBeNull();
  });

  it('clears the worker-side filter when the page unmounts', () => {
    const fake = createFakeWorker();
    const { unmount } = renderHook(() => useFilter(fake.worker));
    unmount();
    expect(fake.postMessage).toHaveBeenLastCalledWith({ type: 'clearFilter' });
  });

  it('does nothing without a worker', () => {
    const { result } = renderHook(() => useFilter(null));
    act(() => result.current.apply(f));
    act(() => result.current.clear());
    expect(result.current.active).toBeNull();
    expect(result.current.pending).toBe(false);
  });
});
