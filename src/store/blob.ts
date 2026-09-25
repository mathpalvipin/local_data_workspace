// src/store/blob.ts
import type { Column } from './types';

// Made once, at module level. Creating these per row would cost more
// than everything else in this file combined.
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function blobColumn(name: string): Column {
  let bytes = new Uint8Array(1024 * 64);  // all the text, glued together
  let used = 0;                            // how many bytes written so far

  let offsets = new Uint32Array(1024);     // where each row starts
  let len = 0;                             // how many rows so far

  return {
    name,
    kind: 'blob',

    push(raw) {
      // Grow the offsets array. Need len+1 slots — see finalize().
      if (len + 1 >= offsets.length) {
        const bigger = new Uint32Array(offsets.length * 2);
        bigger.set(offsets);
        offsets = bigger;
      }

      // Grow the byte buffer. Worst case a character is 4 UTF-8 bytes,
      // so reserve raw.length * 4 to be safe before writing.
      while (used + raw.length * 4 > bytes.length) {
        const bigger = new Uint8Array(bytes.length * 2);
        bigger.set(bytes);
        bytes = bigger;
      }

      offsets[len] = used;

      // encodeInto writes straight into our buffer — no temporary array.
      // (encoder.encode() would allocate a fresh Uint8Array per row,
      // which is the exact thing we're trying to avoid.)
      const result = encoder.encodeInto(raw, bytes.subarray(used));
      used += result.written;

      len++;
    },

    finalize() {
      // One extra offset at the end, marking where the last row stops.
      // Without it, get() for the final row has no end boundary.
      offsets[len] = used;

      offsets = offsets.slice(0, len + 1);
      bytes = bytes.slice(0, used);
    },

    get(row) {
      return decoder.decode(bytes.subarray(offsets[row], offsets[row + 1]));
    },

    bytes() {
      return bytes.byteLength + offsets.byteLength;
    },
  };
}