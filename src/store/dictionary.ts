import type { Column } from './types';

export function dictionaryColumn(name: string): Column {
  // These live in the closure. Same as class fields, but truly private.
  let values: string[] = [];
  let map = new Map<string, number>();
  let codes = new Uint8Array(1024);
  let len = 0;

  return {
    name,
    kind: 'dict',

    push(raw) {
      if (len === codes.length) {
        const bigger = new Uint8Array(codes.length * 2);
        bigger.set(codes);
        codes = bigger;
      }

      let code = map.get(raw);
      if (code === undefined) {
        code = values.length;
        values.push(raw);
        map.set(raw, code);
      }

      codes[len] = code;
      len++;
    },

    finalize() {
      if (len < codes.length) codes = codes.slice(0, len);
      map.clear();
    },

    get(row) {
      return values[codes[row]];
    },

    bytes() {
      return codes.byteLength + values.join('').length * 2;
    },
  };
}