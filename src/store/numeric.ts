import type { Column } from './types';

const INT_NULL = -2147483648;

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

      const days = Date.UTC(y, m - 1, d) / 86400000;
      data[len++] = Number.isFinite(days) ? days : INT_NULL;
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