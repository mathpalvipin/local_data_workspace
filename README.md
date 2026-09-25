# local_data_workspace

A browser-only CSV workspace for loading large files (hundreds of thousands of rows, tens of MB) without freezing the page. It's also a benchmark: the same file can be loaded three ways side by side, so you can see how much each technique helps.

Built with React 19, TypeScript, Vite and [PapaParse](https://www.papaparse.com/). Nothing is uploaded; all parsing happens locally in the browser.

## Loading strategies

The app has one panel per strategy. Each panel has its own file picker, an **Am I responsive?** button and a log you can copy.

| Panel | What it does | Cost |
| --- | --- | --- |
| **Naive** | Reads the whole file into a string and parses it on the main thread. Reports timings for tokenize-only, arrays retained and objects retained (`header: true`). | Freezes the UI and keeps one object per row. |
| **Columnar** | Infers a type for each column from a sample, then pushes every value into a typed column store. Still on the main thread. | Uses much less memory, but the UI still freezes. |
| **Worker** | Streams the `File` into a Web Worker, which parses in chunks and fills the same column store. Only small messages go back to the UI. | The UI stays responsive, and the raw text is never held in memory. |

A `frames:` counter in the corner goes up on every animation frame. If it stops, the main thread is blocked.

## Getting started

Requires Node.js (a version supported by Vite 8).

```bash
npm install
npm run generate   # writes data/large.csv (500k rows, ~47MB, gitignored)
npm run dev        # start the Vite dev server
```

Open the dev server URL, then pick `data/large.csv` (or any CSV with a header row) in one of the panels.

### Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the dev server with HMR |
| `npm run build` | Type-check (`tsc -b`) and build for production |
| `npm run preview` | Serve the production build |
| `npm run lint` | Run Oxlint |
| `npm run generate` | Generate the test CSV |

## Test data

`scripts/csvgenerate.mjs` writes 500,000 rows to `data/large.csv` with a seeded PRNG, so every run produces the same file and profiles from different days can be compared. The data covers the cases a parser usually gets wrong:

- **High-cardinality strings:** `email`, `name`
- **Low-cardinality strings:** `region`, `status`
- **Numbers:** `score` (float), `balance` (int)
- **Dates:** `signup_date`, plus `last_login`, which is empty in about 8% of rows
- **Quoted fields with embedded commas:** `notes`

## Project structure

```
scripts/
  csvgenerate.mjs     Seeded test-data generator (streams with backpressure)
src/
  main.tsx            React entry point
  App.tsx             The three panels, responsiveness probe and log copying
  csvReader.ts        Original vanilla-TS naive baseline (not wired into index.html)
  store/              Columnar storage
    types.ts          Column interface: push() while loading, get() when reading
    infer.ts          Picks a column type from a 1,000-row sample
    numeric.ts        int32, float32 and date columns (Int32Array / Float32Array)
    dictionary.ts     Low-cardinality strings stored as Uint8 codes plus a value table
    blob.ts           High-cardinality strings stored as one UTF-8 buffer plus offsets
  worker/
    protocol.ts       Typed messages between the UI and the worker
    csv.worker.ts     Streaming load, filtering and paging inside the worker
DECISIONS.md          Design decisions and baseline measurements
```

## Column store

Every column implements the same `Column` interface (`src/store/types.ts`), so the parse loop just calls `push(raw)` on each column and doesn't need to know its type.

| Kind | Chosen when | Storage | Null |
| --- | --- | --- | --- |
| `int32` | Integer values below 2³¹ | `Int32Array` | `-2147483648` |
| `float32` | Numbers with a decimal point | `Float32Array` | `NaN` |
| `date` | Values that start with `YYYY-MM-DD` | `Int32Array` of days since the epoch | `-2147483648` |
| `dict` | Fewer than 256 distinct values and under 5% of the sample | `Uint8Array` codes plus a value list | — |
| `blob` | Any other string | One `Uint8Array` of UTF-8 bytes plus `Uint32Array` offsets | — |

## Worker protocol

The worker keeps all the data. The UI only sends small requests and gets back small results (`src/worker/protocol.ts`):

- `load { file }` → `loaded { rows, columns, bytes, ms, timings }`, with timings split into read, infer, parse and finalize
- `filter { column, op: eq | contains | gt | lt, value }` → `filtered { matched, ms }`
- `page { start, count }` → `page { start, rows }`, which reads from the filtered rows if a filter is active
- `error { message }` if anything goes wrong

## Design notes

See [`DECISIONS.md`](DECISIONS.md) for why things are built this way: why the data layer started as vanilla TypeScript, why the test data is generated instead of downloaded, and why a naive baseline was measured before optimizing.
