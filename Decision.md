# Decisions

Architectural decisions and measured findings for the CSV workspace, logged
at decision time. Every performance claim here is backed by a measurement
taken against the same reproducible 49MB / 500,000-row test file.

---

## Part 1 — Test data

### Generated test data over a public dataset
Needed guaranteed coverage of nullable fields, high- and low-cardinality
strings, and embedded commas/quotes. A public dataset gives you whatever
columns it happens to have; this project needed specific shapes because
each one stresses a different part of the storage layer.

### Seeded PRNG rather than `Math.random()`
Profiling runs must be comparable across days. A seeded generator produces
a byte-identical file every time, which is what allows "this change caused
this improvement" rather than "the number was different that day."
The CSV is gitignored; the generator script is committed.

### Backpressure handling in the generator
`if (!out.write(...)) await drain`. The naive version — build one string,
write once — works at 1,000 rows and OOMs at 500,000.

This is the shape of the entire project: **an approach that is correct at
small N and catastrophic at large N.**

---

## Part 2 — Baseline

### Measured a naive baseline before optimizing
Synchronous main-thread parse, `header: true`, whole file read into a
string first.

```
read into string:  258ms
parse:            1109ms
heap:              278MB
```

Nine clicks during the load all fired at frame 249 — the browser queued
input behind the blocked main thread and released it at once. Worse than
a spinner, because the UI looks interactive and isn't.

Without a control group, "I used a Web Worker" is an unverifiable claim.

### Memory arithmetic: the overhead *is* the data
278MB from a 49MB file is **556 bytes/row** for a row whose raw text is
~98 bytes.

- one JS object per row: ~16b header + 10 property slots ≈ 100b
- ten strings per row, each ~16–20b of header before any content ≈ 400b

The memory was going into packaging, not data.

### A/B/C experiment — the finding that determined the architecture
Same text, one variable changed per run:

| | time | isolates |
|---|---|---|
| A — tokenize only, retain nothing | 404ms | scanning |
| B — retain arrays | 634ms | +230ms retention |
| C — retain objects | 1078ms | +444ms object shape |

**Allocation is ~60% of parse cost. Scanning is ~40%.**

This ruled out the obvious next step. A Web Worker moves work to another
thread; it does not make 278MB into less than 278MB. Going straight to the
worker would have fixed responsiveness and hit a wall at ~150MB files with
no diagnosis available.

Arrays and objects hold identical data. The 444ms gap is the cost of
writing `row.email` instead of `row[1]`.

---

## Part 3 — Columnar storage

### Layout changed alone, before threading
Still on the main thread, still freezing. One variable at a time — otherwise
"how much did the columnar layout buy you?" has no answer.

### Design
A row is no longer an object; it is an integer index. Three distinct
mechanisms:

1. **No per-row object.** 500k objects gone — nothing to allocate, nothing
   for the GC to trace.
2. **Typed arrays for numbers.** 4 bytes, contiguous, no boxing. The GC
   treats the buffer as one opaque object rather than 500k traceable values.
3. **Dictionary encoding** for low-cardinality strings. `region` has 5
   distinct values across 500k rows: store 5 strings plus 500k one-byte
   codes. ~40 bytes/value → 1 byte/value.

| column | strategy |
|---|---|
| `id`, `balance` | Int32Array |
| `score` | Float32Array |
| `signup_date`, `last_login` | Int32Array, days since epoch |
| `region`, `status`, `notes` | dictionary + Uint8 codes |
| `email`, `name` | UTF-8 blob + Uint32 offsets |

### Float32 for `score`
~7 significant decimal digits, half the memory of Float64. Fine for `xx.xx`.
**Not** fine for financial data at 15 significant digits — Float32 silently
rounds 123456789 to 123456792, the kind of bug found during a reconciliation
months later. Decided per column, not globally.

### Dates as days-since-epoch in Int32
4 bytes, and integer ordering matches chronological ordering so sorting is a
plain numeric sort.

*Rejected:* ms timestamps (exceed Int32 range → Float64, 8 bytes);
`BigInt64Array` (correct but slow); ISO strings (sort correctly
lexicographically, but back to 500k strings).

Chosen because the data is date-granular. With time-of-day, Float64 wins.

Dates are parsed by hand via `charCodeAt` rather than `Date.parse()`, which
allocates a Date object and runs a general-purpose format detector 500k times.

### UTF-8 blob + offsets for high-cardinality strings
`email` has 500k distinct values, so a dictionary would be as large as the
data. Instead: one growable byte buffer, plus a `Uint32Array` of start
offsets. Row *i* spans `offsets[i]` to `offsets[i+1]`.

Two non-obvious requirements:
- `offsets` needs **n+1** entries — the last row needs an end marker.
- `encodeInto()`, never `encode()`. The latter allocates a fresh
  `Uint8Array` per row — exactly the pattern being eliminated.

*Rejected:* one concatenated JS string built via `join('')` — peak memory
of ~2x the column at finalize time.

### Functional style over classes
Columns are factory functions returning objects; state lives in closures.
Consistent with the rest of the codebase and genuinely private, unlike
TypeScript's `private`.

### Result
```
278MB → 32.3MB      8.6x, below the 49MB source file
556 → 65 bytes/row
parse 1109ms → 1680ms
```

Note: an intermediate reading of 10.0MB was misleading — the blob columns
were still stubs returning `bytes() = 0`. 32.3MB is the honest figure.

### `chunk` over `step`
`step` invokes a callback per row — 500,000 cross-library calls. `chunk`
fires ~50 times with an array each. Third instance of the same lesson:
**per-item overhead dominates when N is large** (see also: generator stream
writes, row objects).

---

## Part 4 — Web Worker

### The column store lives in the worker permanently
*Rejected — send everything:* structured clone copies 32MB, briefly holds
64MB, and lands the memory on the main thread where it competes with
rendering.

*Rejected — transfer the buffers:* near-instant, but transfer moves
ownership. Send once, and the worker is left with nothing.

**Chosen:** the worker owns the store; the main thread never sees it.

```
main → worker:  filter status = 'active'
worker → main:  Uint32Array of matching indices   [transferred]
main → worker:  page(start, count)
worker → main:  ~50 rows of display strings
```

Scales independently of file size — a 1GB file puts the same tiny amount on
the main thread as a 10MB one. Filtering happens next to the data. React
components render 50 rows, not 500,000.

**The cost, stated plainly:** every data access becomes asynchronous.
`column.get(5)` cannot be called in a render function. This is real
complexity and it surfaces at the UI boundary as a page cache.

### Typed message protocol
`Request` / `Response` discriminated unions in `worker/protocol.ts`, rather
than ad-hoc `postMessage` payloads. The worker formats display strings
because it owns the data; the main thread only renders text.

### Read once, parse in controlled slices
PapaParse's `File` input uses FileReader with ~50 async round-trips.
Reading the whole file inside the worker blocks nothing the user can see.

**Tradeoff accepted:** transient peak of the 49MB string plus the 32MB
store. Revisit if 1GB files become a target.

### The worker appeared 3x slower than the main thread — it wasn't
Worker parse measured 5237ms against 1680ms for identical code on the main
thread. Ruled out in order:

| hypothesis | result |
|---|---|
| progress-message re-renders | 5856ms without them |
| FileReader streaming overhead | no change reading in one shot |
| `finalize()` buffer copying | measured 26ms |
| dev vs production build | 5608ms vs 5638ms |
| `BlobColumn` being slow | main thread, same columns: 1680ms |

Per-stage timing narrowed it to the parse loop — but the loop was identical
in both.

**Cause:** the rAF frame counter used for jank detection called `setFrames()`
at 60fps, re-rendering React continuously for the duration of the load and
starving the worker of CPU. Removing the state update (keeping the rAF loop)
dropped worker parse to 1978ms — within 18% of the main thread.

**Lesson: the instrument was distorting the measurement.** Diagnostic tooling
has to be cheap enough not to perturb what it measures.

### Result
```
loaded 500000 rows in 2179ms
  read (to first chunk):  189ms
  infer column types:       3ms
  parse rows:            1978ms
  finalize:                 9ms
retained 32.3MB
```

| | baseline | final |
|---|---|---|
| total load | 1409ms (frozen) | 2179ms (responsive) |
| time to first chunk | — | 189ms |
| retained | 278MB | 32.3MB |
| main thread blocked | ~1100ms | ~0ms |

Total time rose ~55%; in exchange the UI never blocks and first rows are
available in 189ms rather than 1409ms. Users experience
latency-to-first-result, not total throughput.

---

## Known limitations

Things this system does not currently handle, with the fix sketched:

- **Dictionary codes are `Uint8`** — breaks silently past 256 distinct
  values, and there is no detection. Fix: promote the codes array to
  `Uint16Array` on overflow, or fall back to blob encoding.
- **Integer columns cannot represent null distinctly.** `INT32_MIN` is used
  as a sentinel, which collides with a legitimate value. Fix: a parallel
  bitmask (1 bit/row = 62KB for 500k rows).
- **Schema inference samples only the first 1000 rows, with no promotion
  path.** If row 340,000 contains `"N/A"` in a column inferred as `int32`,
  the value is silently lost. Fix: detect the violation, allocate the wider
  type, replay — which requires retaining the source strings.
- **Substring filtering over long text columns exceeds the 100ms target.**
  The filter calls `col.get(i)` and does a `String()` conversion per row,
  which is wasteful for dictionary columns where codes could be compared as
  integers directly.
- **Fixed 32px row height** (planned for Part 5). Variable heights would
  break the arithmetic `scrollTop → rowIndex` mapping and require a
  measurement cache plus binary search.

---

## Recurring lesson

The same wall, three times in different clothing:

| where | naive | fixed |
|---|---|---|
| generator | per-row stream writes | batched writes |
| parse | `step` (500k callbacks) | `chunk` (~50) |
| storage | 500k row objects | typed arrays |

**Per-item overhead dominates when N is large.**