import { describe, expect, it } from 'vitest';
import { inferKind, makeColumn } from './infer';
import type { ColumnKind } from './types';

describe('inferKind', () => {
  it('treats an all-empty sample as dict', () => {
    expect(inferKind(['', '', ''])).toBe('dict');
    expect(inferKind([])).toBe('dict');
  });

  it('detects dates by their YYYY-MM-DD prefix, ignoring blanks', () => {
    expect(inferKind(['2021-03-09', '', '2024-01-01T10:00'])).toBe('date');
  });

  it('detects integers', () => {
    expect(inferKind(['1', '42', '', '-7'])).toBe('int32');
  });

  it('falls back to float32 for integers beyond int32 range', () => {
    expect(inferKind(['1', '3000000000'])).toBe('float32');
  });

  it('detects decimals as float32', () => {
    expect(inferKind(['1.5', '2', '3.25'])).toBe('float32');
  });

  it('uses dict for few distinct values relative to the sample', () => {
    const sample = Array.from({ length: 1000 }, (_, i) => ['a', 'b', 'c'][i % 3]);
    expect(inferKind(sample)).toBe('dict');
  });

  it('uses blob for high-cardinality strings', () => {
    const sample = Array.from({ length: 1000 }, (_, i) => `user${i}@example.com`);
    expect(inferKind(sample)).toBe('blob');
  });

  it('uses blob when distinct values exceed the 256 cap even at a low ratio', () => {
    // 300 distinct values over 10,000 rows is 3% (< 5%) but over the cap.
    const sample = Array.from({ length: 10_000 }, (_, i) => `v${i % 300}`);
    expect(inferKind(sample)).toBe('blob');
  });
});

describe('makeColumn', () => {
  it.each<ColumnKind>(['int32', 'float32', 'date', 'dict', 'blob'])(
    'builds a %s column with the given name',
    (kind) => {
      const col = makeColumn(kind, 'c');
      expect(col.kind).toBe(kind);
      expect(col.name).toBe('c');
    },
  );
});
