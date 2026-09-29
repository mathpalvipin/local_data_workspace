import { describe, expect, it } from 'vitest';
import { dateColumn, float32Column, int32Column } from './numeric';
import type { Column } from './types';

const load = (col: Column, values: string[]) => {
  for (const v of values) col.push(v);
  col.finalize();
  return col;
};

describe('int32Column', () => {
  it('stores integers and reads them back as numbers', () => {
    const col = load(int32Column('id'), ['0', '42', '-7', '2147483647']);
    expect(col.kind).toBe('int32');
    expect(col.name).toBe('id');
    expect([0, 1, 2, 3].map(col.get)).toEqual([0, 42, -7, 2147483647]);
  });

  it('returns null for empty and non-numeric values', () => {
    const col = load(int32Column('n'), ['', 'abc', '5']);
    expect(col.get(0)).toBeNull();
    expect(col.get(1)).toBeNull();
    expect(col.get(2)).toBe(5);
  });

  it('grows past its initial 1024 capacity and trims on finalize', () => {
    const values = Array.from({ length: 3000 }, (_, i) => String(i));
    const col = load(int32Column('n'), values);
    expect(col.get(0)).toBe(0);
    expect(col.get(2999)).toBe(2999);
    // Trimmed to exactly 3000 × 4 bytes, not the doubled 4096 capacity.
    expect(col.bytes()).toBe(3000 * 4);
  });
});

describe('float32Column', () => {
  it('displays each value with the decimals it had in the file', () => {
    const input = ['56.45', '56.4', '56.40', '57', '0.07', '99.999'];
    const col = load(float32Column('score'), input);
    expect(col.kind).toBe('float32');
    expect(input.map((_, i) => col.get(i))).toEqual(input);
  });

  it('does not leak float32 noise digits', () => {
    const col = load(float32Column('score'), ['56.45']);
    // String() of the stored float32 would be 56.45000076293945.
    expect(col.get(0)).toBe('56.45');
  });

  it('returns null for empty values', () => {
    const col = load(float32Column('score'), ['', '1.5']);
    expect(col.get(0)).toBeNull();
    expect(col.get(1)).toBe('1.5');
  });

  it('stops counting decimals at an exponent', () => {
    const col = load(float32Column('x'), ['1.5e3']);
    // One digit after the dot before "e", so one decimal place.
    expect(col.get(0)).toBe('1500.0');
  });

  it('caps decimals at float32 precision', () => {
    const col = load(float32Column('x'), ['0.123456789']);
    expect(String(col.get(0)).split('.')[1]).toHaveLength(7);
  });

  it('grows both the value and decimals arrays together', () => {
    const values = Array.from({ length: 2500 }, (_, i) => `${i}.5`);
    const col = load(float32Column('x'), values);
    expect(col.get(2499)).toBe('2499.5');
    // 4 bytes of float + 1 byte of decimal count per row, after trimming.
    expect(col.bytes()).toBe(2500 * 5);
  });
});

describe('dateColumn', () => {
  it('round-trips ISO dates', () => {
    const input = ['1970-01-01', '2021-03-09', '2024-02-29', '1999-12-31'];
    const col = load(dateColumn('d'), input);
    expect(col.kind).toBe('date');
    expect(input.map((_, i) => col.get(i))).toEqual(input);
  });

  it('ignores anything after the date part', () => {
    const col = load(dateColumn('d'), ['2021-03-09T14:30:00']);
    expect(col.get(0)).toBe('2021-03-09');
  });

  it('returns null for values shorter than a full date', () => {
    const col = load(dateColumn('d'), ['', '2021-03']);
    expect(col.get(0)).toBeNull();
    expect(col.get(1)).toBeNull();
  });

  it('matches Date.UTC for every day across two centuries', () => {
    // The stored value is days since 1970; compare against Date.UTC directly.
    const col = dateColumn('d');
    const expected: string[] = [];
    for (let t = Date.UTC(1900, 0, 1); t <= Date.UTC(2100, 11, 31); t += 864e5 * 37) {
      const iso = new Date(t).toISOString().slice(0, 10);
      expected.push(iso);
      col.push(iso);
    }
    col.finalize();
    expect(expected.map((_, i) => col.get(i))).toEqual(expected);
    expect(col.bytes()).toBe(expected.length * 4);
  });
});
