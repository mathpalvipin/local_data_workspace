import { useEffect, useRef, useState } from "react";
import Papa from "papaparse";
import type { Column } from "./store/types";
import { inferKind, makeColumn } from "./store/infer";
import "./App.css";

// In App.tsx
import CsvWorker from './worker/csv.worker?worker';
import type { Response } from './worker/protocol';

// One panel per loading strategy. Each keeps its own log, which is only
// replaced when a new file is picked in that same panel.
type Lane = "naive" | "columnar" | "worker";
type Logs = Record<Lane, string[]>;

const PANELS: { lane: Lane; title: string; hint: string }[] = [
  { lane: "naive", title: "Naive", hint: "Whole file to string, parsed on the main thread" },
  { lane: "columnar", title: "Columnar", hint: "Typed columns, still on the main thread" },
  { lane: "worker", title: "Worker", hint: "Streamed and parsed off the main thread" },
];

// navigator.clipboard only exists in secure contexts (https / localhost).
// Opening the dev server from a phone over the LAN is plain http, so fall
// back to the old execCommand route there.
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

function formatLane(title: string, hint: string, lines: string[]): string {
  const body = lines.length ? lines.join("\n") : "(no file loaded)";
  return `## ${title} — ${hint}\n${body}`;
}

export default function App() {
  const workerRef = useRef<Worker | null>(null);

  const [logs, setLogs] = useState<Logs>({ naive: [], columnar: [], worker: [] });
  const [frames, setFrames] = useState(0);
  const framesRef = useRef(0);

  const reset = (lane: Lane, ...msgs: string[]) =>
    setLogs((l) => ({ ...l, [lane]: msgs }));
  const say = (lane: Lane, ...msgs: string[]) =>
    setLogs((l) => ({ ...l, [lane]: [...l[lane], ...msgs] }));

  // Same liveness probe as before. Note it now runs through React state,
  // which adds a re-render per frame — a small cost, but it's exactly the
  // ambiguity I warned about: some of what you see in the profile is now
  // React's, not yours. Live with it for the baseline; it doesn't change
  // the headline number, because a 4-second block dwarfs React's overhead.
  useEffect(() => {
    let id: number;
    const tick = () => {
      framesRef.current += 1;
      setFrames(framesRef.current);
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, []);

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    reset("naive", `file: ${(file.size / 1e6).toFixed(1)}MB`);
    const t0 = performance.now();

    const text = await file.text();
    let count = 0;
    const tA0 = performance.now();
    Papa.parse(text, {
      header: false,
      skipEmptyLines: true,
      step: () => {
        count++;
      },
    });
    const tA = performance.now() - tA0;

    // B — arrays, retained. Same scanning as A, but now we keep 500k
    // arrays. Difference from A ≈ cost of retaining + array allocation.
    const tB0 = performance.now();
    const arrays = Papa.parse(text, { header: false, skipEmptyLines: true });
    const tB = performance.now() - tB0;

    // C — objects, retained. This is your baseline (1152ms).
    // Difference from B ≈ cost of building objects rather than arrays.
    const tC0 = performance.now();
    const objects = Papa.parse(text, { header: true, skipEmptyLines: true });
    const tC = performance.now() - tC0;

    say(
      "naive",
      `A tokenize-only:    ${tA.toFixed(0)}ms (${count} rows)`,
      `B arrays retained:  ${tB.toFixed(0)}ms (${arrays.data.length} rows)`,
      `C objects retained: ${tC.toFixed(0)}ms (${objects.data.length} rows)`,
    );
    const tRead = performance.now();

    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
    const tParse = performance.now();

    const mem = (performance as any).memory;
    say(
      "naive",
      `read into string: ${(tRead - t0).toFixed(0)}ms`,
      `parse: ${(tParse - tRead).toFixed(0)}ms`,
      `rows: ${parsed.data.length}`,
      `TOTAL: ${(tParse - t0).toFixed(0)}ms`,
      mem ? `heap: ${(mem.usedJSHeapSize / 1e6).toFixed(0)}MB` : "",
    );
  };

   const loadColumnar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    reset("columnar", `file: ${(file.size / 1e6).toFixed(1)}MB`);
     const t0 = performance.now();
    const text = await file.text(); // still main thread — Part 4 fixes this
    const tRead = performance.now();

    // Sample for inference
    const head = text.slice(0, 200_000);
    const sample = Papa.parse<string[]>(head, {
      header: false,
      skipEmptyLines: true,
    });
    const headers = sample.data[0];
    const sampleRows = sample.data.slice(1, 1001);

    const columns: Column[] = headers.map((name, i) => {
      const kind = inferKind(sampleRows.map((r) => r[i] ?? ""));
      return makeColumn(kind, name); // small factory switch
    });

    // The hot loop. Note what is NOT here: no object literal, no row array
    // retained, no closure allocated per row. `step` gives us one row at a
    // time and we immediately fan it into the columns and forget it.
    let n = 0;
    Papa.parse<string[]>(text, {
      header: false,
      skipEmptyLines: true,
      step: (res) => {
        if (n++ === 0) return; // skip header
        const row = res.data;
        for (let c = 0; c < columns.length; c++) {
          columns[c].push(row[c] ?? "");
        }
      },
    });

    for (const c of columns) c.finalize();
    const tParse = performance.now();

    const total = columns.reduce((sum, c) => sum + c.bytes(), 0);
    console.table(
      columns.map((c) => ({
        column: c.name,
        kind: c.kind,
        MB: (c.bytes() / 1e6).toFixed(1),
      })),
    );
    say(
      "columnar",
      `read into string: ${(tRead - t0).toFixed(0)}ms`,
      `columnar parse: ${(tParse - tRead).toFixed(0)}ms`,
      `retained: ${(total / 1e6).toFixed(1)}MB`,
    );
  }

  const [ progress, setProgress] = useState(0);
  useEffect(() => {
  const w = new CsvWorker();
  w.onmessage = (e: MessageEvent<Response>) => {
    const msg = e.data;
    if (msg.type === 'progress') setProgress(msg.rows);
    else if (msg.type === 'loaded') {
      const t = msg.timings;
      say("worker",
        `loaded ${msg.rows} rows in ${msg.ms.toFixed(0)}ms`,
        `  read (to first chunk): ${t.read.toFixed(0)}ms`,
        `  infer column types:    ${t.infer.toFixed(0)}ms`,
        `  parse rows:            ${t.parse.toFixed(0)}ms`,
        `  finalize:              ${t.finalize.toFixed(0)}ms`,
        `retained ${(msg.bytes / 1e6).toFixed(1)}MB`,
      );
      w.postMessage({ type: 'page', start: 0, count: 50 });
    }
    else if (msg.type === 'page') console.log(msg.rows);
    else if (msg.type === 'filtered') {
      say("worker", `${msg.matched} matches in ${msg.ms.toFixed(0)}ms`);
      w.postMessage({ type: 'page', start: 0, count: 50 });
    }
    else if (msg.type === 'error') say("worker", `error: ${msg.message}`);
  };
  workerRef.current = w;
  return () => w.terminate();
}, []);

const onWorkerFile = (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  if (!file) return;
  reset("worker", `file: ${(file.size / 1e6).toFixed(1)}MB`);
  setProgress(0);
  workerRef.current?.postMessage({ type: 'load', file });
};

  const handlers: Record<Lane, (e: React.ChangeEvent<HTMLInputElement>) => void> = {
    naive: onFile,
    columnar: loadColumnar,
    worker: onWorkerFile,
  };

  // Which copy button last fired, and whether it worked. Cleared after a
  // moment so the label goes back to "Copy".
  const [copied, setCopied] = useState<{ key: Lane | "all"; ok: boolean } | null>(null);
  const copyTimer = useRef<number | undefined>(undefined);

  const copy = async (key: Lane | "all", text: string) => {
    const ok = await copyText(text);
    setCopied({ key, ok });
    clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied(null), 1500);
  };

  const copyLabel = (key: Lane | "all", idle: string) =>
    copied?.key === key ? (copied.ok ? "Copied!" : "Copy failed") : idle;

  const copyAll = () => {
    const sections = PANELS.map(({ lane, title, hint }) =>
      formatLane(title, hint, logs[lane]),
    );
    const header = `# CSV Workspace logs\n${new Date().toISOString()}`;
    copy("all", [header, ...sections].join("\n\n") + "\n");
  };

  const hasAnyLog = PANELS.some(({ lane }) => logs[lane].length > 0);

  return (
    <div className="workspace">
      <div className="frames">frames: {frames}</div>
      <h1>CSV Workspace — baseline</h1>
      <div className="toolbar">
        <button className="copy-all" onClick={copyAll} disabled={!hasAnyLog}>
          {copyLabel("all", "Copy all logs")}
        </button>
      </div>
      <div className="panels">
        {PANELS.map(({ lane, title, hint }) => (
          <section key={lane} className="panel">
            <h2>{title}</h2>
            <p className="hint">{hint}</p>
            <input type="file" accept=".csv" onChange={handlers[lane]} />
            <button
              className="probe"
              onClick={() => say(lane, `clicked at frame ${framesRef.current}`)}
            >
              Am I responsive?
            </button>
            {lane === "worker" && progress > 0 && (
              <div className="progress">worker rows parsed: {progress}</div>
            )}
            <div className="log-head">
              <span>Log</span>
              <button
                className="copy"
                onClick={() => copy(lane, formatLane(title, hint, logs[lane]))}
                disabled={logs[lane].length === 0}
              >
                {copyLabel(lane, "Copy")}
              </button>
            </div>
            <pre className="log">{logs[lane].join("\n") || "no file loaded"}</pre>
          </section>
        ))}
      </div>
    </div>
  );
}
