import { describe, expect, it } from 'vitest';
import { blobColumn } from './blob';

describe('blobColumn', () => {
  it('reads every row back, including the last one', () => {
    const input = ['user0@example.com', 'user1@example.com', 'x'];
    const col = blobColumn('email');
    input.forEach((v) => col.push(v));
    col.finalize();

    expect(col.kind).toBe('blob');
    expect(col.name).toBe('email');
    // The last row needs the n+1 end offset written in finalize().
    expect(input.map((_, i) => col.get(i))).toEqual(input);
  });

  it('handles empty strings and multi-byte UTF-8', () => {
    const input = ['', 'café', '€ 5', '😀', 'ok'];
    const col = blobColumn('notes');
    input.forEach((v) => col.push(v));
    col.finalize();
    expect(input.map((_, i) => col.get(i))).toEqual(input);
  });

  it('grows the byte buffer past its 64KB start', () => {
    const big = 'a'.repeat(50_000);
    const col = blobColumn('big');
    [big, big, 'tail'].forEach((v) => col.push(v));
    col.finalize();
    expect(col.get(1)).toBe(big);
    expect(col.get(2)).toBe('tail');
  });

  it('grows the offsets array and trims both buffers on finalize', () => {
    const col = blobColumn('ids');
    for (let i = 0; i < 2000; i++) col.push(String(i));
    col.finalize();
    expect(col.get(1999)).toBe('1999');

    // Bytes: the digits of 0..1999 (10×1 + 90×2 + 900×3 + 1000×4 = 6890)
    // plus 2001 offsets × 4 bytes. No leftover capacity.
    expect(col.bytes()).toBe(6890 + 2001 * 4);
  });
});
