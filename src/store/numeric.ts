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

export function float32Column(name: string): Column {
  let data = new Float32Array(1024);
  let len = 0;

  return {
    name,
    kind: 'float32',
    push(raw) {
      if (len === data.length) {
        const bigger = new Float32Array(data.length * 2);
        bigger.set(data);
        data = bigger;
      }
      data[len++] = raw === '' ? NaN : Number(raw);
    },
    finalize() {
      if (len < data.length) data = data.slice(0, len);
    },
    get(row) {
      const v = data[row];
      return Number.isNaN(v) ? null : v;
    },
    bytes() { return data.byteLength; },
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