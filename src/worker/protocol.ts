// src/worker/protocol.ts

/** Main thread → worker */
export type Request =
  | { type: 'load'; file: File }
  | { type: 'filter'; column: string; op: 'eq' | 'contains' | 'gt' | 'lt'; value: string }
  | { type: 'page'; start: number; count: number };

/** Worker → main thread */
export type Response =
  | { type: 'progress'; rows: number }
  | { type: 'loaded'; rows: number; columns: ColumnMeta[]; bytes: number; ms: number; timings: LoadTimings }
  | { type: 'filtered'; matched: number; ms: number }
  | { type: 'page'; start: number; rows: string[][] }
  | { type: 'error'; message: string };

export type ColumnMeta = { name: string; kind: string; bytes: number };

/**
 * Phase breakdown of a `load`, in ms. The worker streams the file, so
 * reading and parsing overlap: `read` is time-to-first-chunk, not the
 * cost of reading the whole file.
 */
export type LoadTimings = {
  read: number;     // t1 - t0: first chunk delivered
  infer: number;    // t2 - t1: deciding column types from the sample
  parse: number;    // t3 - t2: fanning every remaining row into columns
  finalize: number; // t4 - t3: per-column cleanup
  total: number;    // t4 - t0
};