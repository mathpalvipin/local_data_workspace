import { describe, expect, it } from 'vitest';
import { OVERSCAN, ROW_HEIGHT, offsetFor, totalHeight, visibleRange } from './geometry';

describe('geometry', () => {
  it('totalHeight is rows × row height', () => {
    expect(totalHeight(0)).toBe(0);
    expect(totalHeight(500_000)).toBe(500_000 * ROW_HEIGHT);
  });

  it('offsetFor places a row at its index × row height', () => {
    expect(offsetFor(0)).toBe(0);
    expect(offsetFor(400_000)).toBe(400_000 * ROW_HEIGHT);
  });

  it('at the top, starts at 0 and adds overscan below', () => {
    const { start, end } = visibleRange(0, 10 * ROW_HEIGHT, 1000);
    expect(start).toBe(0);
    expect(end).toBe(10 + OVERSCAN);
  });

  it('mid-list, adds overscan on both sides', () => {
    const { start, end } = visibleRange(100 * ROW_HEIGHT, 10 * ROW_HEIGHT, 1000);
    expect(start).toBe(100 - OVERSCAN);
    expect(end).toBe(110 + OVERSCAN);
  });

  it('rounds a partially visible row into the range', () => {
    const { start, end } = visibleRange(100 * ROW_HEIGHT + 5, 10 * ROW_HEIGHT + 1, 1000);
    expect(start).toBe(100 - OVERSCAN);
    expect(end).toBe(100 + 11 + OVERSCAN);
  });

  it('clamps the end to the row count', () => {
    const { start, end } = visibleRange(995 * ROW_HEIGHT, 10 * ROW_HEIGHT, 1000);
    expect(start).toBe(995 - OVERSCAN);
    expect(end).toBe(1000);
  });

  it('never returns end before start when scrolled past the data', () => {
    const { start, end } = visibleRange(5000 * ROW_HEIGHT, 10 * ROW_HEIGHT, 100);
    expect(end).toBeGreaterThanOrEqual(start);
  });
});
