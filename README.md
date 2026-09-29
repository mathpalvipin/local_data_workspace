# local_data_workspace

A browser-only CSV workspace for loading large files (hundreds of thousands of rows, tens of MB) without freezing the page, and scrolling through all of them. It's also a benchmark: each technique was measured against the one before it, and the results are in [`DECISIONS.md`](DECISIONS.md).

Built with React 19, TypeScript, Vite, React Router and [PapaParse](https://www.papaparse.com/). No virtualization library is used; the grid is hand-built. Nothing is uploaded; all parsing happens locally in the browser.

## Pages

| Route | What it does |
| --- | --- |
| `/` **Load** | Pick a CSV. A Web Worker streams and parses it into a column store while a progress count rises. When it's done you see rows, retained memory and load time, and a **Preview** button. The page has an **Am I responsive?** button whose clicks are logged next to the output. |
| `/preview` **Preview** | A virtual grid over all rows, with a sticky header and **row 4k / 40k / 400k** jump buttons. Only the visible rows (plus a small margin) exist in the DOM. Rows not fetched yet show as dimmed `—` placeholders. |
| `/bench` **Bench** | The naive and columnar strategies on the main thread, side by side, each with its own file picker, log, **row 400k** probe and Copy button, plus **Copy all logs**. Use it to see the freeze the worker avoids. |

A `frames:` counter in the corner goes up on every animation frame. If it stops, the main thread is blocked.

The parsed data lives only in the worker's memory. Refreshing the page, or opening `/preview` directly, starts with nothing loaded and redirects to `/`.

## Getting started

Requires Node.js (a version supported by Vite 8).

```bash
npm install
npm run generate   # writes data/large.csv (500k rows, ~49MB, gitignored)
npm run dev        # start the Vite dev server
```

Open the dev server URL, pick `data/large.csv` (or any CSV with a header row) on the Load page, then click **Preview**.

### Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the dev server with HMR |
| `npm run build` | Type-check (`tsc -b`) and build for production |
| `npm run preview` | Serve the production build |
| `npm run lint` | Run Oxlint |
| `npm run generate` | Generate the test CSV |

To type-check without building, use `npx tsc -b`. Plain `npx tsc --noEmit` checks nothing here, because the root `tsconfig.json` only holds project references.

## How it works

```
 main thread                                   Web Worker
 ───────────                                   ──────────
 WorkerProvider ── load { file } ───────────▶  PapaParse streams the File in ~10MB chunks
   (above the router, lives as long as the app)  → infer column types from 1,000 rows
                ◀── progress { rows } ────────   → push every value into typed columns
                ◀── loaded { rows, columns } ──
 Grid / usePageCache ── page { start, count } ▶  format just those rows as strings
                ◀── page { start, rows } ─────
```

The column store never leaves the worker. The UI only ever holds the rows it is showing: the page cache keeps at most 20 pages of 200 rows.

## Test data

`scripts/csvgenerate.mjs` writes 500,000 rows to `data/large.csv` with a seeded PRNG, so every run produces the same file and profiles from different days can be compared. The data covers the cases a parser usually gets wrong:

- **High-cardinality strings:** `email`, `name`
- **Low-cardinality strings:** `region`, `status`
- **Numbers:** `score` (float, 2 decimals), `balance` (int)
- **Dates:** `signup_date`, plus `last_login`, which is empty in about 8% of rows
- **Quoted fields with embedded commas:** `notes`

## Project structure

```
scripts/
  csvgenerate.mjs       Seeded test-data generator (streams with backpressure)
src/
  main.tsx              Entry point: WorkerProvider → BrowserRouter → routes
  pages/
    LoadPage.tsx        File input, progress, results, responsiveness probe
    PreviewPage.tsx     Virtual grid plus jump-to-row buttons
    BenchPage.tsx       Naive vs columnar comparison on the main thread
  grid/
    Grid.tsx            Virtual grid: sticky header, translateY window, placeholders
    geometry.ts         Scroll math: row height, overscan, visible range
    usePageCache.ts     LRU cache of row pages fetched from the worker
  worker/
    WorkerProvider.tsx  Owns the one worker; exposes status, progress, columns
    workerContext.ts    Context type and useWorkerContext()
    protocol.ts         Typed messages between the UI and the worker
    csv.worker.ts       Streaming load, filtering and paging inside the worker
  store/                Columnar storage
    types.ts            Column interface: push() while loading, get() when reading
    infer.ts            Picks a column type from a 1,000-row sample
    numeric.ts          int32, float32 and date columns
    dictionary.ts       Low-cardinality strings as Uint8 codes plus a value table
    blob.ts             High-cardinality strings as one UTF-8 buffer plus offsets
  components/
    FrameCounter.tsx    rAF liveness counter that never re-renders React
  csvReader.ts          Original vanilla-TS naive baseline (not imported)
DECISIONS.md            Design decisions, measurements and known limitations
```

## Column store

Every column implements the same `Column` interface (`src/store/types.ts`), so the parse loop just calls `push(raw)` on each column and doesn't need to know its type.

| Kind | Chosen when | Storage | Empty value |
| --- | --- | --- | --- |
| `int32` | Integer values below 2³¹ | `Int32Array` | `-2147483648` |
| `float32` | Numbers with a decimal point | `Float32Array`, plus a `Uint8Array` of each value's decimal places so it displays exactly as written | `NaN` |
| `date` | Values that start with `YYYY-MM-DD` | `Int32Array` of days since 1970, computed with integer math | `-2147483648` |
| `dict` | Fewer than 256 distinct values and under 5% of the sample | `Uint8Array` codes plus a value list | — |
| `blob` | Any other string | One `Uint8Array` of UTF-8 bytes plus `Uint32Array` offsets | — |

For the test file this takes the retained size from ~278MB (one object per row) to ~32MB, less than the CSV itself.

## Worker protocol

Defined in `src/worker/protocol.ts`:

- `load { file }` → `progress { rows }` per chunk, then `loaded { rows, columns, bytes, ms, timings }`, with timings split into read, infer, parse and finalize
- `filter { column, op: eq | contains | gt | lt, value }` → `filtered { matched, ms }`. The matching row numbers stay in the worker.
- `page { start, count }` → `page { start, rows }`, reading through the filter if one is active
- `error { message }` if a request fails

Filtering exists in the worker but has no UI yet.

## Known limitations

The main ones are below. [`DECISIONS.md`](DECISIONS.md#known-limitations) has the full list, with fixes sketched.

- Column types are inferred from the first 1,000 rows only, with no fallback if a later value doesn't fit.
- Dictionary columns break silently past 256 distinct values.
- A read or parse error in the worker isn't reported, so the Load page stays on "Parsing…".
- Float columns hold about 7 significant digits (`3.1415926` shows as `3.1415925`).
- The grid's scrollable height is limited by the browser (about 560k rows in Firefox).
- Data isn't persisted. Reloading means loading the file again.

## Design notes

[`DECISIONS.md`](DECISIONS.md) explains why things are built this way and records the measurements behind each step: the naive baseline, the A/B/C allocation experiment, the columnar store, the worker (including why it first appeared 3× slower), routing and worker lifetime, and the virtual grid.
