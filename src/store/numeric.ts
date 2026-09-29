import type { Column } from './types';

const INT_NULL = -2147483648;

// Days since 1970-01-01 from year / month (1–12) / day, using integer math
// only (Howard Hinnant's days_from_civil). Same result as Date.UTC, but no
// built-in call per row.
function daysFromCivil(y: number, m: number, d: number): number {
  y -= m <= 2 ? 1 : 0;                       // treat Jan/Feb as months 13/14 of the previous year
  const era = Math.floor(y / 400);            // 400-year cycles
  const yoe = y - era * 400;                  // year within the cycle, 0–399
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1; // day of year, counted from March 1
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy; // day within the cycle
  return era * 146097 + doe - 719468;         // shift so 1970-01-01 is day 0
}

export function int32Column(name: string): Column {
  let data = new Int32Array(1024);
  let len = 0;

  return {
    name,
    kind: 'int32',
    push(raw) {
      if (len === data.length) {
        const bigger = new Int32Array(data.length * 2);
        bigger.set(data);
        data = bigger;
      }
      if (raw === '') { data[len++] = INT_NULL; return; }
      const n = Number(raw);
      data[len++] = Number.isFinite(n) ? n : INT_NULL;
    },
    finalize() {
      if (len < data.length) data = data.slice(0, len);
    },
    get(row) {
      const v = data[row];
      return v === INT_NULL ? null : v;
    },
    bytes() { return data.byteLength; },
  };
}

// Float32 holds ~7 significant digits; decimals beyond that are binary noise
// from the float, not data from the file.
const MAX_DECIMALS = 7;

export function float32Column(name: string): Column {
  let data = new Float32Array(1024);
  // Decimal places each value had in the file, so get() prints every value
  // exactly as written: "56.4" stays "56.4" and "56.40" stays "56.40".
  // Costs 1 byte per row (~0.5MB for 500k rows).
  // Rejected: one max-decimals count for the whole column. It's free, but it
  // pads shorter values with zeros ("56.4" → "56.40"), so the grid would
  // disagree with the file. Also rejected: the shortest decimal that maps
  // back to the same float32. It needs no extra memory, but it drops
  // trailing zeros the file had ("56.40" → "56.4").
  let decs = new Uint8Array(1024);
  let len = 0;

  return {
    name,
    kind: 'float32',
    push(raw) {
      if (len === data.length) {
        const bigger = new Float32Array(data.length * 2);
        bigger.set(data);
        data = bigger;
        const biggerDecs = new Uint8Array(decs.length * 2);
        biggerDecs.set(decs);
        decs = biggerDecs;
      }
      if (raw === '') { decs[len] = 0; data[len++] = NaN; return; }

      // Count the digits after the dot, stopping at anything else (the "e" in
      // "1.5e3"). charCodeAt, not a regex: this runs once per row.
      let d = 0;
      const dot = raw.indexOf('.');
      if (dot !== -1) {
        for (let i = dot + 1; i < raw.length; i++) {
          const ch = raw.charCodeAt(i);
          if (ch < 48 || ch > 57) break;
          d++;
        }
      }
      decs[len] = Math.min(d, MAX_DECIMALS);
      data[len++] = Number(raw);
    },
    finalize() {
      if (len < data.length) {
        data = data.slice(0, len);
        decs = decs.slice(0, len);
      }
    },
    get(row) {
      const v = data[row];
      // toFixed, not the raw number. 56.45 is stored as the nearest float32,
      // 56.450000762939453, and String(v) would print all of that. Rounding
      // to this value's own decimal count gives back the file's text.
      // Cost: this returns a string. A numeric sort must use Number(get(i)),
      // or better, read the typed array directly.
      return Number.isNaN(v) ? null : v.toFixed(decs[row]);
    },
    bytes() { return data.byteLength + decs.byteLength; },
  };
}

export function dateColumn(name: string): Column {
  let data = new Int32Array(1024);
  let len = 0;

  return {
    name,
    kind: 'date',
    push(raw) {
      if (len === data.length) {
        const bigger = new Int32Array(data.length * 2);
        bigger.set(data);
        data = bigger;
      }
      if (raw.length < 10) { data[len++] = INT_NULL; return; }

      const y = (raw.charCodeAt(0) - 48) * 1000 + (raw.charCodeAt(1) - 48) * 100
              + (raw.charCodeAt(2) - 48) * 10 + (raw.charCodeAt(3) - 48);
      const m = (raw.charCodeAt(5) - 48) * 10 + (raw.charCodeAt(6) - 48);
      const d = (raw.charCodeAt(8) - 48) * 10 + (raw.charCodeAt(9) - 48);

      // Old approach, kept for learning. Clear, but it calls the built-in
      // Date.UTC once per row (~32ms per 500k rows vs ~15ms for the math below).
      // const days = Date.UTC(y, m - 1, d) / 86400000;   // months count from 0 here
      // data[len++] = Number.isFinite(days) ? days : INT_NULL;

      // New approach: integer math only.
      data[len++] = daysFromCivil(y, m, d);             // months count from 1 here
    },
    finalize() {
      if (len < data.length) data = data.slice(0, len);
    },
    get(row) {
      const v = data[row];
      return v === INT_NULL ? null : new Date(v * 86400000).toISOString().slice(0, 10);
    },
    bytes() { return data.byteLength; },
  };
}