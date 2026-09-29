import { describe, expect, it } from 'vitest';
import { dictionaryColumn } from './dictionary';

describe('dictionaryColumn', () => {
  it('stores repeated values once and reads every row back', () => {
    const input = ['us-east', 'eu-central', 'us-east', 'ap-south', 'us-east'];
    const col = dictionaryColumn('region');
    input.forEach((v) => col.push(v));
    col.finalize();

    expect(col.kind).toBe('dict');
    expect(col.name).toBe('region');
    expect(input.map((_, i) => col.get(i))).toEqual(input);
  });

  it('keeps an empty string as a value of its own', () => {
    const col = dictionaryColumn('x');
    ['', 'a', ''].forEach((v) => col.push(v));
    col.finalize();
    expect([0, 1, 2].map(col.get)).toEqual(['', 'a', '']);
  });

  it('costs one byte per row plus the distinct values', () => {
    const col = dictionaryColumn('status');
    for (let i = 0; i < 3000; i++) col.push(i % 2 ? 'active' : 'closed');
    col.finalize();
    expect(col.get(2999)).toBe('active');
    // 3000 one-byte codes + ("active" + "closed") × 2 bytes per UTF-16 char.
    expect(col.bytes()).toBe(3000 + 12 * 2);
  });
});
