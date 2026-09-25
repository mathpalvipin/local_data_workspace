// src/store/types.ts

/**
 * Every column type is a "builder" during load and a "reader" after.
 * Same object, two phases.
 *
 * WHY one interface: the parse loop shouldn't know or care whether a
 * column is an Int32Array or a dictionary. It calls push() 500k times
 * and moves on. All the cleverness lives behind this boundary, which
 * means you can change a column's strategy later without touching the
 * parse loop at all.
 *
 * ALTERNATIVE: a big switch statement in the parse loop. Fewer files,
 * but every new column type means editing the hot loop, and megamorphic
 * call sites there are genuinely slower — V8 can't inline a switch with
 * 6 arms as well as it can a monomorphic method call.
 */
export interface Column {
  readonly name: string;
  readonly kind: ColumnKind;

  /** Called once per row during load. Must be cheap — this runs 500k times. */
  push(raw: string): void;

  /** Called once after all rows. Compacts, trims, frees scratch space. */
  finalize(): void;

  /** Read a single value by row index. Only ever called for visible rows. */
  get(row: number): string | number | null;

  /** Approximate retained bytes. For the memory report — this is the payoff metric. */
  bytes(): number;
}

export type ColumnKind = 'int32' | 'float32' | 'date' | 'dict' | 'blob';