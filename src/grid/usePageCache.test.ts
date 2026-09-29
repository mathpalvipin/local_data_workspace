import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createFakeWorker } from '../test/fakeWorker';
import { usePageCache } from './usePageCache';

const PAGE = 200;
const pageRows = (start: number) =>
  Array.from({ length: PAGE }, (_, i) => [String(start + i), `row ${start + i}`]);

describe('usePageCache', () => {
  it('returns null on a miss and requests the page exactly once', () => {
    const fake = createFakeWorker();
    const { result } = renderHook(() => usePageCache(fake.worker));

    expect(result.current.getRow(250)).toBeNull();
    expect(result.current.getRow(260)).toBeNull(); // same page, already in flight

    expect(fake.postMessage).toHaveBeenCalledTimes(1);
    expect(fake.postMessage).toHaveBeenCalledWith({ type: 'page', start: 200, count: PAGE });
  });

  it('serves rows once the page arrives and bumps version', () => {
    const fake = createFakeWorker();
    const { result } = renderHook(() => usePageCache(fake.worker));
    result.current.getRow(250);
    const before = result.current.version;

    act(() => fake.reply({ type: 'page', start: 200, rows: pageRows(200) }));

    expect(result.current.version).toBe(before + 1);
    expect(result.current.getRow(250)).toEqual(['250', 'row 250']);
    // A row past the end of a short page reads as missing, not undefined.
    act(() => fake.reply({ type: 'page', start: 400, rows: [['400', 'x']] }));
    expect(result.current.getRow(401)).toBeNull();
  });

  it('ignores messages that are not pages', () => {
    const fake = createFakeWorker();
    const { result } = renderHook(() => usePageCache(fake.worker));
    const before = result.current.version;
    act(() => fake.reply({ type: 'progress', rows: 10 }));
    expect(result.current.version).toBe(before);
  });

  it('evicts the least recently used page beyond 20 pages', () => {
    const fake = createFakeWorker();
    const { result } = renderHook(() => usePageCache(fake.worker));

    // Fill pages 0..19, then touch page 0 so page 1 becomes the oldest.
    act(() => {
      for (let p = 0; p < 20; p++) fake.reply({ type: 'page', start: p * PAGE, rows: pageRows(p * PAGE) });
    });
    expect(result.current.getRow(0)).not.toBeNull();

    act(() => fake.reply({ type: 'page', start: 20 * PAGE, rows: pageRows(20 * PAGE) }));

    fake.postMessage.mockClear();
    expect(result.current.getRow(0)).not.toBeNull();      // touched: kept
    expect(result.current.getRow(PAGE)).toBeNull();       // oldest: evicted
    expect(fake.postMessage).toHaveBeenCalledWith({ type: 'page', start: PAGE, count: PAGE });
  });

  it('invalidate drops every page and allows re-requesting', () => {
    const fake = createFakeWorker();
    const { result } = renderHook(() => usePageCache(fake.worker));
    act(() => fake.reply({ type: 'page', start: 0, rows: pageRows(0) }));
    const before = result.current.version;

    act(() => result.current.invalidate());

    expect(result.current.version).toBe(before + 1);
    fake.postMessage.mockClear();
    expect(result.current.getRow(0)).toBeNull();
    expect(fake.postMessage).toHaveBeenCalledTimes(1);
  });

  it('does nothing without a worker', () => {
    const { result } = renderHook(() => usePageCache(null));
    expect(result.current.getRow(0)).toBeNull();
  });

  it('stops listening when unmounted', () => {
    const fake = createFakeWorker();
    const { result, unmount } = renderHook(() => usePageCache(fake.worker));
    unmount();
    const before = result.current.version;
    fake.reply({ type: 'page', start: 0, rows: pageRows(0) });
    expect(result.current.version).toBe(before);
  });
});
