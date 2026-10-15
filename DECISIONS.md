# Decisions

Architectural decisions and measured findings for the CSV workspace, logged
at decision time. Performance claims are backed by measurements against the
same reproducible 49MB / 500,000-row test file, unless marked *not yet
measured*.

---

## Part 1 — Test data and a standalone data layer

### Vanilla TS for the data layer, React added later
Profiling with React in the tree makes it ambiguous whether a long task is
parsing or React's reconciliation. Building the data layer standalone meant
every millisecond in the flame chart was attributable.
Cost: a small refactor when React came in. `src/csvReader.ts` is that
original vanilla baseline; nothing imports it any more.

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
| `score` | Float32Array + Uint8Array of per-value decimals |
| `signup_date`, `last_login` | Int32Array, days since epoch |
| `region`, `status`, `notes` | dictionary + Uint8 codes |
| `email`, `name` | UTF-8 blob + Uint32 offsets |

### Float32 for `score`
~7 significant decimal digits, half the memory of Float64. Fine for `xx.xx`.
**Not** fine for financial data at 15 significant digits — Float32 silently
rounds 123456789 to 123456792, the kind of bug found during a reconciliation
months later. Decided per column, not globally.

### Float32 values display exactly as written in the file
56.45 has no exact float32; the nearest is 56.450000762939453, and
`String(v)` printed all of it in the grid. The fix stores each value's own
decimal count in a parallel `Uint8Array` (1 byte/row, ~0.5MB) and `get()`
returns `v.toFixed(decs[row])`.

- *Rejected:* one max-decimals count per column. Free, but pads shorter
  values (`56.4` → `56.40`), so the grid disagrees with the file.
- *Rejected:* the shortest decimal that maps back to the same float32. No
  extra memory, but drops trailing zeros the file had (`56.40` → `56.4`).

Verified by parsing the full test file with the real column code and
comparing every displayed cell to the CSV text: **5,000,000 cells, 0
differences.** The float32 limit still applies: `3.1415926` (8 significant
digits) displays as `3.1415925`.

Cost: `get()` returns a string for float columns. See Known limitations for
what that does to filtering, and what a numeric sort must do instead.

### Dates as days-since-epoch in Int32
4 bytes, and integer ordering matches chronological ordering so sorting is a
plain numeric sort.

*Rejected:* ms timestamps (exceed Int32 range → Float64, 8 bytes);
`BigInt64Array` (correct but slow); ISO strings (sort correctly
lexicographically, but back to 500k strings).

Chosen because the data is date-granular. With time-of-day, Float64 wins.

### Dates parsed by hand, then converted with integer arithmetic
Digits are read with `charCodeAt` (no substrings, no `Date` object), then
converted to a day number with Howard Hinnant's `days_from_civil` instead
of `Date.UTC`. `Date.parse` is avoided because it runs a general-purpose
format detector per call.

Measured in Node (same V8 engine), 500k date strings, median of 5 after
warm-up:

| approach | time |
|---|---|
| `new Date(raw)` | 85.9ms |
| `Date.parse(raw)` | 62.1ms |
| `charCodeAt` + `Date.UTC` | 32.2ms |
| `charCodeAt` + `daysFromCivil` | 15.5ms |

`daysFromCivil` matches `Date.UTC` for every day 1900-01-01 → 2100-12-31
(73,414 days, 0 mismatches). The `Date.UTC` version is kept as a comment in
`numeric.ts` for comparison. Trade-off: a formula the reader must trust, in
exchange for halving the date column's parse cost.

Measured inside the real worker load too (headless Chrome, production
build, full 49MB file, 7 cold loads per variant, run twice in opposite
orders to rule out ordering effects; setup in Part 7):

| variant | median `parse` | run 1 | run 2 |
|---|---|---|---|
| `Date.UTC` | ~5,815ms | 5,835ms | 5,798ms |
| `daysFromCivil` | ~5,595ms | 5,612ms | 5,580ms |

**~220ms (~4%) faster per load**, in both orders. That is more than the
~33ms the Node micro-benchmark predicted for two date columns. The gap is
not explained yet; the micro-benchmark measured the conversion in
isolation, while the real load runs it interleaved with parsing and
column pushes.

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
(The per-value decimals array added later brings the total to ~32.8MB.)

### `chunk` over `step`
`step` invokes a callback per row — 500,000 cross-library calls. `chunk`
fires once per 10MB read (`Papa.LocalChunkSize`), so ~5 times for the 49MB
file, with an array of rows each. (An earlier draft said ~50.) Third
instance of the same lesson:
**per-item overhead dominates when N is large** (see also: generator stream
writes, row objects). The worker uses `chunk`; the main-thread columnar
comparison on `/bench` still uses `step`.

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
worker → main:  { matched, ms }        (matching indices stay in the worker)
main → worker:  page(start, count)
worker → main:  up to `count` rows of display strings
```

Scales independently of file size — a 1GB file puts the same tiny amount on
the main thread as a 10MB one. Filtering happens next to the data. React
components render ~50 rows, not 500,000.

*Correction:* an earlier draft had the filter result sent back as a
transferred `Uint32Array`. The code keeps it in the worker (`matches`) and
`page()` reads through it, which is simpler and sends less.

**The cost, stated plainly:** every data access becomes asynchronous.
`column.get(5)` cannot be called in a render function. This is real
complexity and it surfaces at the UI boundary as a page cache (Part 6).

### Typed message protocol
`Request` / `Response` discriminated unions in `worker/protocol.ts`, rather
than ad-hoc `postMessage` payloads. The worker formats display strings
because it owns the data; the main thread only renders text.

### Streaming the `File` into the worker
PapaParse receives the `File` itself, not a string, so it reads the file in
~10MB chunks and the raw text is never held whole. `read` in the load
timings is time-to-first-chunk, not the cost of reading the file.

*Correction:* an earlier draft described reading the whole file into one
string inside the worker, accepting a transient 49MB + 32MB peak. The code
streams instead, so that peak does not occur.

The worker posts a `progress` message once per chunk (~5 per load) so the
Load page can show rows parsed. Progress messages were ruled out as the
cause of the slowdown below, so this costs nothing measurable.

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

The fix is now permanent in `components/FrameCounter.tsx`: the rAF loop
writes the count straight into a DOM node's `textContent` and never calls
`setState`.

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

## Part 5 — Routing and worker lifetime

### The worker lives above the router
The worker holds the only copy of the data. Created inside a route
component, navigating away would unmount it, the effect cleanup would call
`terminate()`, and the file would be gone. `WorkerProvider` wraps
`<BrowserRouter>` in `main.tsx`, so no navigation can unmount it.

Routes: `/` (Load), `/preview` (grid), `/bench` (the naive vs columnar
comparison from Parts 2–3, kept runnable).

### Worker created in an effect, not a lazy `useState` initializer
`useState(() => new CsvWorker())` breaks under StrictMode: dev runs
mount → cleanup → mount, the cleanup terminates the only instance, and
nothing recreates it. Creating the worker inside `useEffect` pairs every
`terminate()` with a fresh worker, and storing it in state gives consumers
one render once it exists.

### `addEventListener`, not `onmessage`
`onmessage` is a single slot, and two parties listen to the same worker:
`WorkerProvider` (progress / loaded / error) and `usePageCache` (page
replies). Whoever assigned `onmessage` last would silently cut off the
other.

### Context and hook in a `.ts` file, provider in `.tsx`
A `.tsx` exporting both a component and a hook can't be hot-swapped by Vite
Fast Refresh (oxlint's `only-export-components`). A full reload during
development would throw away the worker and the parsed file.

### No persistence yet — `/preview` redirects to `/` on refresh
A refresh or a cold deep link starts a fresh worker with nothing loaded.
*Deferred:* caching the store in OPFS/IndexedDB. Re-parsing costs ~2s,
while a 32MB cache brings invalidation and schema-versioning problems that
aren't worth taking on yet.

---

## Part 6 — Virtual grid

No virtualization library (`react-window`, `@tanstack/react-virtual`): this
is the part of the project being demonstrated. Scroll measurements are in
Part 7.

### Fixed 32px rows, pure geometry
`grid/geometry.ts` turns `scrollTop` into a row range with division:
`first = floor(scrollTop / 32)`, plus `OVERSCAN = 10` rows each side so a
fast scroll doesn't flash empty edges. Variable heights would need a
measurement cache plus binary search.

The spacer is `rowCount × 32px` = 16,000,000px for this file: inside
Chrome's ~33.5M px element limit, but close to Firefox's ~17.9M, which
caps the current approach at roughly 560k rows there.

### `transform: translateY` for the row window — measured, and no faster here
The original reasoning: a transform is applied by the compositor and skips
Layout, while `top` is geometry, so changing it on every scroll event would
force a layout pass.

**The measurement disproved that for this grid** (Part 7): a `top` build
and a `transform` build ran the same number of layouts in the same time,
for both a fast and a slow scroll. The reason is the design itself. The
offset derives from `start`, a whole-row index, so it only changes when the
set of rendered rows changes, and new rows need Layout regardless of how
the block is positioned. `top` never changes on a scroll event that doesn't
also change the rows.

Kept as `transform` because it costs nothing and would matter if the offset
ever became pixel-continuous (e.g. smooth sub-row positioning), but it is
not a performance win in this design.

The offset derives from `start`, not `scrollTop`: `start` is OVERSCAN rows
above the first visible row, so offsetting by `scrollTop` would draw
everything 320px too low.

### Scroll handler not throttled
Every scroll event sets state so the rendered window never lags the
scrollbar. Revisit only if the frame counter shows stalls during a fast
scroll — measure first.

### Sticky header inside the scroll container, one row tall
Because the header is exactly `ROW_HEIGHT`, `scrollTop` maps to a row index
with no header offset, and the body viewport is simply one row shorter.
Header and rows share one `grid-template-columns` object so they can't
drift apart; numeric columns are right-aligned with tabular digits.

### Page cache with LRU, 200 rows × 20 pages
`usePageCache` keeps ~4,000 rows on the main thread. A miss returns `null`
and requests the page; the arrival bumps a version counter to re-render.
Storage lives in a ref, and the render trigger is the explicit counter,
rather than a `Map` in state that must be replaced on every arrival.

### Placeholder rows, never blank and never stale
A row that isn't loaded yet renders at full height, dimmed, with `—` per
cell. *Rejected:* an empty row (the grid visibly collapses and looks like
missing data). *Rejected:* keeping the previous row's values until the real
ones arrive (actively misleading: the user reads wrong numbers as real).

### `key` is the absolute row index
Keying by position in the rendered window makes React treat "slot 0" as the
same element while it shows row 1000, then 1001, rewriting every cell on
every scroll step and carrying DOM state onto the wrong row.

### Rows are read one effect after mount
`getRow()` fires a page request on a miss, but `usePageCache` attaches its
worker listener in an effect after the first commit. A reply arriving
before that would be dropped and the page left "in flight" forever. The
grid waits one effect (effects run in declaration order) before reading
rows. The cleaner fix is in `usePageCache` itself; see Known limitations.

### Jump-to-row via an imperative handle
`scrollToRow(row)` sets the viewport's real `scrollTop`, so the normal
`onScroll` path stays the single source of truth. *Rejected:* setting the
`scrollTop` state directly (the scrollbar wouldn't move, and the next
scroll event would snap back). *Rejected:* a `scrollToRow` prop (clicking
the same jump twice after scrolling away wouldn't change the prop, so
nothing would happen).

### Filter bar on the Preview page
Filtering runs in the worker, next to the data; only `{ matched, ms }`
comes back and the grid pages through the matches like any other rows.
`useFilter` owns the UI side:

- **The grid is remounted on each result** (`key = seq`), which resets its
  page cache (the old pages hold the old row order) and scroll position.
  *Rejected:* exposing `invalidate()` and scroll reset from the grid, which
  leaks its internals into the page.
- **The grid's row count switches only when the worker confirms**, not when
  the user clicks Apply. Switching early would page the old result with the
  new count until the reply lands.
- **A `clearFilter` message was added to the protocol**, and the filter is
  cleared when the Preview page unmounts. The worker keeps `matches` across
  navigation, so leaving with a filter on would make the next visit page
  through matches while showing the full row count.
- **`gt` / `lt` compare as numbers only for `int32` / `float32`**, and as
  text otherwise, which is chronological for ISO dates. The old numeric-only
  comparison made every date filter match nothing (`Number("2021-03-09")`
  is NaN).

---

## Part 7 — Measurements in a real browser

### Setup
Headless Chrome (installed Chrome, driven by `puppeteer-core`) against
production builds served by `vite preview`, on the development laptop.
Background-throttling switches were turned off. To compare variants, each
alternative was built from the same tree with one file patched (the
`Date.UTC` lines in `numeric.ts`, or `top` instead of `transform` in
`Grid.tsx`), so only that change differs. The worker's own `loaded` message
supplied the phase timings.

**This laptop is slower than the machine behind the Part 2–4 numbers.** The
same parse-and-fill loop in plain Node takes 2.6–3.7s here, and a full
worker load takes ~6.0s against the 2,179ms recorded in Part 4. Compare
numbers within this part, not against earlier parts.

### Load (7 cold loads, fresh page and worker each)
```
rows:                 500,000   (all rows kept: the sample-replay fix holds)
retained:             32.8MB    (32.3MB + the per-value decimals array)
read (first chunk):   ~400ms
infer column types:   ~9ms
parse rows:           ~5,600ms
finalize:             ~18ms
total:                ~6,020ms
```

### Scroll: `transform` vs `top` (240 scripted frames, median of 5 runs)
| scroll | build | layouts | layout time | frame mean | frame p95 |
|---|---|---|---|---|---|
| fast, 2,000px/frame | `transform` | 238 | 2,551ms | 31.8ms | 36.6ms |
| fast, 2,000px/frame | `top` | 238 | 2,489ms | 30.0ms | 36.3ms |
| slow, 4px/frame | `transform` | 29 | 27ms | 18.0ms | 18.1ms |
| slow, 4px/frame | `top` | 29 | 21ms | 18.0ms | 18.2ms |

- **No difference between `transform` and `top`.** See Part 6 for why.
- **Slow scroll:** 29 layouts in 240 frames, one per row change
  (240 × 4px ÷ 32px = 30). Frames between row changes do no layout at all.
- **Fast scroll is limited by Layout of new rows**, not by positioning:
  ~10.6ms of Layout per frame to build ~50 fresh rows × 10 cells, giving
  ~31 fps on this laptop. The next optimization, if one is needed, is
  fewer DOM nodes per row (e.g. one text node per row, or canvas), not the
  positioning property.

### Filters (full file, median of 5)
| filter | matches | time |
|---|---|---|
| `region = us-east` (dictionary) | 94,837 | 49ms |
| `balance < 1000` (int32) | 1,292 | 54ms |
| `score = 56.45` (float32) | 0 | 197ms |
| `score > 50` (float32) | 240,957 | 292ms |
| `email contains user4` (blob) | 111,111 | 764ms |
| `signup_date > 2024-01-01` (date) | 138,803 | 1,812ms |

`score = 56.45` matching 0 is correct: the seeded generator never produced
that value (`48.69` appears 430 times). Every column type except
dictionary and int32 misses a 100ms target, because `filter()` goes through
`get()`, which formats a string per row: `toFixed` for floats, UTF-8
decoding for blobs, and a `Date` plus ISO string for dates.

---

## Known limitations

Things this system does not currently handle, with the fix sketched.

Fixed since the first draft of this list: rows skipped when the inference
sample spanned chunks (2,967 of 3,000 kept; now all, with a regression
test), load errors never reported (now an `error` callback plus guarded
chunk/complete callbacks), and `gt` / `lt` date filters matching nothing.

**Correctness**
- **Dictionary codes are `Uint8`** — breaks silently past 256 distinct
  values, and there is no detection. Fix: promote the codes array to
  `Uint16Array` on overflow, or fall back to blob encoding.
- **Schema inference samples only the first 1000 rows, with no promotion
  path.** If row 340,000 contains `"N/A"` in a column inferred as `int32`,
  the value is silently lost. Fix: detect the violation, allocate the wider
  type, replay — which requires retaining the source strings.
- **Integer columns cannot represent null distinctly.** `INT32_MIN` is used
  as a sentinel, which collides with a legitimate value. Fix: a parallel
  bitmask (1 bit/row = 62KB for 500k rows).
- **Dates aren't validated.** Non-digits or `2023-13-45` produce a wrong day
  number instead of an empty value. Fix: range-check month and day before
  `daysFromCivil`.

**Performance**
- **Filters format a string per row** (measured in Part 7): date `>` takes
  1,812ms, blob `contains` 764ms, float `>` 292ms on 500k rows, against a
  100ms target. `filter()` calls `col.get(i)`, which builds a `Date` and
  ISO string, decodes UTF-8, or calls `toFixed`. Fix: give columns a typed
  comparison path that reads the arrays directly (compare day numbers,
  float values, dictionary codes).
- **Fast scrolling runs at ~31 fps on the dev laptop**, limited by Layout of
  ~50 new rows × 10 cells per frame (Part 7). Fix if needed: fewer DOM
  nodes per row, not a different positioning property.
- **The page cache's listener is attached after first render.** Worked
  around in `Grid` (Part 6); the robust fix is for `usePageCache` to attach
  synchronously or re-request in-flight pages after subscribing.

**Scale and UI**
- **One load at a time.** A second `load` while the first is still
  streaming would interleave both files into the same columns. The Load
  page disables the input while loading; the worker itself doesn't guard.
- **Grid height is capped by the browser's max element height** (~560k
  rows in Firefox at 32px). Fix: scaled scrolling beyond the limit.
- **Fixed 32px row height.** Variable heights would need a measurement
  cache plus binary search.
- **`/bench` keeps ~278MB of naive row objects alive** after a Naive load,
  so that its "row 400k" button can read them. This distorts heap readings
  taken on that page.

---

## Recurring lesson

The same wall, three times in different clothing:

| where | naive | fixed |
|---|---|---|
| generator | per-row stream writes | batched writes |
| parse | `step` (500k callbacks) | `chunk` (~5) |
| storage | 500k row objects | typed arrays |

**Per-item overhead dominates when N is large.**
