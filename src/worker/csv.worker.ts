// src/worker/csv.worker.ts
import Papa from 'papaparse';
import type { Request, Response } from './protocol';
import { inferKind, makeColumn } from '../store/infer';
import type { Column } from '../store/types';

// Worker-local state. This is the data that never crosses the boundary.
let columns: Column[] = [];
let rowCount = 0;
let matches: Uint32Array | null = null;   // current filter result

const send = (msg: Response, transfer?: Transferable[]) =>
  self.postMessage(msg, { transfer: transfer ?? [] });

self.onmessage = (e: MessageEvent<Request>) => {
  const req = e.data;
  try {
    if (req.type === 'load') load(req.file);
    else if (req.type === 'filter') filter(req);
    else if (req.type === 'page') page(req);
  } catch (err) {
    send({ type: 'error', message: String(err) });
  }
};

function load(file: File) {
  const t0 = performance.now();
  columns = [];
  rowCount = 0;
  matches = null;

  let headers: string[] | null = null;
  let sampleRows: string[][] = [];
  let inferred = false;

  // Phase markers. Streaming means reading and parsing overlap, so t1 is
  // when the first chunk lands, not when the whole file has been read.
  let t1 = 0;
  let t2 = 0;

  // Passing `file` (not a string) makes PapaParse stream it.
  // We never hold the whole file in memory.
  Papa.parse<string[]>(file, {
    header: false,
    skipEmptyLines: true,
    worker: false,          // we ARE the worker; don't spawn another
    chunk: (results) => {
      if (t1 === 0) t1 = performance.now();   // reading the file
      const rows = results.data;
      let start = 0;

      if (!headers) {
        headers = rows[0];
        start = 1;
      }

      // Collect a sample before deciding column types. We may need
      // more than one chunk's worth, so this is a small state machine.
      if (!inferred) {
        for (let i = start; i < rows.length && sampleRows.length < 1000; i++) {
          sampleRows.push(rows[i]);
        }
        if (sampleRows.length >= 1000 || results.meta.cursor >= file.size) {
          columns = headers!.map((name, i) =>
            makeColumn(inferKind(sampleRows.map(r => r[i] ?? '')), name)
          );
          inferred = true;
          t2 = performance.now();   // figuring out column types
          // Replay the sample rows we buffered while deciding.
          for (const row of sampleRows) {
            for (let c = 0; c < columns.length; c++) columns[c].push(row[c] ?? '');
            rowCount++;
          }
          // Skip past the rows we just replayed in this chunk.
          start += sampleRows.length;
          sampleRows = [];
        } else {
          return;   // need more data before we can infer
        }
      }

      for (let r = start; r < rows.length; r++) {
        const row = rows[r];
        for (let c = 0; c < columns.length; c++) columns[c].push(row[c] ?? '');
        rowCount++;
      }

    //   send({ type: 'progress', rows: rowCount });
    },
    complete: () => {
      const t3 = performance.now();   // parsing all rows
      for (const c of columns) c.finalize();
      const t4 = performance.now();   // cleanup
      send({
        type: 'loaded',
        rows: rowCount,
        columns: columns.map(c => ({ name: c.name, kind: c.kind, bytes: c.bytes() })),
        bytes: columns.reduce((s, c) => s + c.bytes(), 0),
        ms: t4 - t0,
        timings: {
          read: t1 - t0,
          infer: t2 - t1,
          parse: t3 - t2,
          finalize: t4 - t3,
          total: t4 - t0,
        },
      });
    },
  });
}

function filter(req: Extract<Request, { type: 'filter' }>) {
  const t0 = performance.now();
  const col = columns.find(c => c.name === req.column);
  if (!col) return send({ type: 'error', message: `no column ${req.column}` });

  // Allocate the worst case, then trim. One allocation instead of
  // growing an array 500k times.
  const out = new Uint32Array(rowCount);
  let n = 0;

  for (let i = 0; i < rowCount; i++) {
    const v = col.get(i);
    if (v === null) continue;
    const s = String(v);
    const hit =
      req.op === 'eq' ? s === req.value :
      req.op === 'contains' ? s.includes(req.value) :
      req.op === 'gt' ? Number(v) > Number(req.value) :
      Number(v) < Number(req.value);
    if (hit) out[n++] = i;
  }

  matches = out.slice(0, n);
  send({ type: 'filtered', matched: n, ms: performance.now() - t0 });
}

function page(req: Extract<Request, { type: 'page' }>) {
  const rows: string[][] = [];
  const total = matches ? matches.length : rowCount;
  const end = Math.min(req.start + req.count, total);

  for (let i = req.start; i < end; i++) {
    const rowIdx = matches ? matches[i] : i;
    rows.push(columns.map(c => {
      const v = c.get(rowIdx);
      return v === null ? '' : String(v);
    }));
  }

  send({ type: 'page', start: req.start, rows });
}