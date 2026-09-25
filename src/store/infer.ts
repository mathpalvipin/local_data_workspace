import type { Column, ColumnKind } from "./types";
import { int32Column, float32Column, dateColumn } from "./numeric";
import { dictionaryColumn } from "./dictionary";
import { blobColumn } from "./blob";

// src/store/infer.ts

/**
 * Decide a strategy per column from a sample of rows.
 *
 * WHY sample rather than full scan: a full scan gives exact statistics
 * (perfect capacity pre-allocation, exact cardinality) but doubles your
 * read time. Sampling 1000 rows costs ~1ms and is right almost always.
 *
 * The "almost" is the whole problem — see the promotion note below.
 */
export function inferKind(samples: string[]): ColumnKind {
  const nonEmpty = samples.filter((s) => s !== "");
  if (nonEmpty.length === 0) return "dict";

  if (nonEmpty.every((s) => /^\d{4}-\d{2}-\d{2}/.test(s))) return "date";

  if (nonEmpty.every((s) => s !== "" && Number.isFinite(Number(s)))) {
    // Integer vs float: does any sample have a decimal point?
    const hasDecimal = nonEmpty.some((s) => s.includes("."));
    if (!hasDecimal) {
      const max = Math.max(...nonEmpty.map((s) => Math.abs(Number(s))));
      if (max < 2_147_483_647) return "int32";
    }
    return "float32";
  }

  // Cardinality heuristic: few distinct values in the sample implies few
  // overall. 5% is a guess — worth tuning against real files. The absolute
  // cap matters more than the ratio: a dictionary with 10k entries costs
  // more in Map overhead than it saves.
  const distinct = new Set(nonEmpty).size;
  return distinct < nonEmpty.length * 0.05 && distinct < 256 ? "dict" : "blob";
}

export function makeColumn(kind: ColumnKind, name: string): Column {
  switch (kind) {
    case "int32":
      return int32Column(name);
    case "float32":
      return float32Column(name);
    case "date":
      return dateColumn(name);
    case "dict":
      return dictionaryColumn(name);
    case "blob":
      return blobColumn(name);
  }
}
