import Papa from 'papaparse';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from './protocol';

// In jsdom `self` is the window. Importing the worker module assigns
// self.onmessage; replies go through self.postMessage, which is spied on.
await import('./csv.worker');

let posted: Response[] = [];
const send = (req: Request) => self.onmessage!(new MessageEvent('message', { data: req }));
const last = <T extends Response['type']>(type: T) =>
  posted.filter((m): m is Extract<Response, { type: T }> => m.type === type).at(-1);

async function load(csv: string) {
  send({ type: 'load', file: new File([csv], 'test.csv') });
  await vi.waitFor(() => expect(last('loaded') ?? last('error')).toBeDefined());
  return last('loaded');
}

const CSV = [
  'id,score,region,signup,email',
  '0,56.45,us-east,2021-03-09,user0@example.com',
  '1,12.40,eu-central,2022-11-04,user1@example.com',
  '2,,us-east,,user2@example.com',
  '3,99.99,ap-south,2024-02-29,"quoted, with comma"',
].join('\n');

describe('csv.worker', () => {
  beforeEach(() => {
    posted = [];
    vi.spyOn(self, 'postMessage').mockImplementation((msg: unknown) => {
      posted.push(msg as Response);
    });
  });

  afterEach(() => {
    Papa.LocalChunkSize = 1024 * 1024 * 10;
  });

  it('loads a file into typed columns and reports timings', async () => {
    const loaded = await load(CSV);
    expect(loaded).toBeDefined();
    expect(loaded!.rows).toBe(4);
    expect(loaded!.columns.map((c) => [c.name, c.kind])).toEqual([
      ['id', 'int32'],
      ['score', 'float32'],
      ['region', 'blob'], // 3 distinct of 4 is too many for a dictionary
      ['signup', 'date'],
      ['email', 'blob'],
    ]);
    expect(loaded!.bytes).toBeGreaterThan(0);
    expect(loaded!.timings.total).toBeGreaterThanOrEqual(0);
    expect(last('progress')?.rows).toBe(4);
  });

  it('pages rows back as display strings, blanks for empty cells', async () => {
    await load(CSV);
    send({ type: 'page', start: 1, count: 2 });
    expect(last('page')).toEqual({
      type: 'page',
      start: 1,
      rows: [
        ['1', '12.40', 'eu-central', '2022-11-04', 'user1@example.com'],
        ['2', '', 'us-east', '', 'user2@example.com'],
      ],
    });
  });

  it('clamps a page request at the end of the data', async () => {
    await load(CSV);
    send({ type: 'page', start: 3, count: 50 });
    expect(last('page')?.rows).toHaveLength(1);
  });

  it.each([
    [{ column: 'region', op: 'eq', value: 'us-east' }, 2],
    [{ column: 'email', op: 'contains', value: 'comma' }, 1],
    [{ column: 'score', op: 'gt', value: '50' }, 2],
    [{ column: 'score', op: 'lt', value: '50' }, 1],
    [{ column: 'score', op: 'eq', value: '56.45' }, 1],
  ] as const)('filters %o → %i matches, and pages through them', async (f, count) => {
    await load(CSV);
    send({ type: 'filter', ...f });
    expect(last('filtered')?.matched).toBe(count);

    send({ type: 'page', start: 0, count: 10 });
    expect(last('page')?.rows).toHaveLength(count);
  });

  it('pages through the filter result, not the whole table', async () => {
    await load(CSV);
    send({ type: 'filter', column: 'region', op: 'eq', value: 'us-east' });
    send({ type: 'page', start: 0, count: 10 });
    expect(last('page')?.rows.map((r) => r[0])).toEqual(['0', '2']);
  });

  it('reports an unknown filter column', async () => {
    await load(CSV);
    send({ type: 'filter', column: 'nope', op: 'eq', value: 'x' });
    expect(last('error')?.message).toBe('no column nope');
  });

  it('turns a synchronous failure into an error message', () => {
    vi.spyOn(Papa, 'parse').mockImplementation(() => {
      throw new Error('boom');
    });
    send({ type: 'load', file: new File([''], 'x.csv') });
    expect(last('error')?.message).toContain('boom');
  });

  it('buffers the inference sample across several chunks', async () => {
    Papa.LocalChunkSize = 4096; // ~200 rows per chunk, so 1000 rows span ~5
    const rows = Array.from({ length: 999 }, (_, i) => `${i},${i % 7}.5`);
    const loaded = await load(['id,v', ...rows].join('\n'));
    // Under 1000 rows: inference waits for the end of the file, then replays.
    expect(loaded!.rows).toBe(999);
    expect(posted.filter((m) => m.type === 'progress').length).toBeGreaterThan(0);
  });

  // Known bug (DECISIONS.md, Known limitations): when the 1000-row sample is
  // completed mid-chunk after spanning earlier chunks, `start +=
  // sampleRows.length` over-skips and drops the rest of that chunk.
  // it.fails passes while the bug exists; flip it to `it` once fixed.
  it.fails('keeps every row when the sample spans chunks (known bug)', async () => {
    Papa.LocalChunkSize = 4096;
    const rows = Array.from({ length: 3000 }, (_, i) => `${i},${i % 7}.5`);
    const loaded = await load(['id,v', ...rows].join('\n'));
    expect(loaded!.rows).toBe(3000);
  });
});
