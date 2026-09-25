import Papa from 'papaparse';

// We're deliberately writing the naive version. Every choice below is one
// we'll reverse in Part 3. Where that's true, the comment says so.

const app = document.querySelector<HTMLDivElement>('#app')!;

app.innerHTML = `
  <h1>CSV Workspace — baseline</h1>
  <input type="file" id="file" accept=".csv" />
  <button id="spin">Am I responsive?</button>
  <pre id="out"></pre>
`;

const out = document.querySelector<HTMLPreElement>('#out')!;
const log = (msg: string) => { out.textContent += msg + '\n'; };

// The responsiveness probe. This is the most important 6 lines in the file.
//
// A number that increments on every animation frame is a liveness signal:
// if the main thread is blocked, rAF cannot fire, and the counter visibly
// stalls. This gives you a *felt* sense of jank, not just a number in a
// profile. Keep this in the app permanently — it's the cheapest possible
// regression detector, and it'll catch you the moment you accidentally
// move work back onto the main thread.
let frames = 0;
const probe = document.createElement('div');
probe.style.cssText = 'position:fixed;top:8px;right:8px;font:14px monospace';
document.body.appendChild(probe);
(function tick() {
  probe.textContent = `frames: ${frames++}`;
  requestAnimationFrame(tick);
})();

// A second probe, because the frame counter alone can be ambiguous.
// This button should respond instantly. During the freeze, your click
// will queue and only fire once the main thread frees up — you'll see
// the alert appear *after* parsing completes, which demonstrates that
// input events aren't lost, just deferred. That distinction matters
// when you're reasoning about what the user actually experiences.
document.querySelector('#spin')!.addEventListener('click', () => {
  log(`clicked at frame ${frames}`);
});

document.querySelector<HTMLInputElement>('#file')!.addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;

  out.textContent = '';
  log(`file: ${(file.size / 1e6).toFixed(1)}MB`);

  // performance.now() over Date.now(): monotonic, sub-millisecond,
  // unaffected by system clock changes. Always use it for timing.
  const t0 = performance.now();

  // MISTAKE #1 — reading the entire file into a single string.
  // 47MB of UTF-8 becomes a ~47MB JS string (or ~94MB if it ends up
  // as UTF-16 internally). We hold this *and* the parsed output in
  // memory simultaneously. In Part 3 we'll stream instead, so we
  // never hold the raw text at all.
  const text = await file.text();
  const tRead = performance.now();
  log(`read into string: ${(tRead - t0).toFixed(0)}ms`);

  // MISTAKE #2 — synchronous parse on the main thread.
  // Papa.parse with a string input and no `worker: true` blocks until
  // it's completely done. Nothing else can run. No rendering, no event
  // handling, no rAF. This is the freeze.
  //
  // MISTAKE #3 — `header: true` produces one plain object per row.
  // 500k objects × 10 string properties. This is where a large chunk
  // of the time actually goes, and it's the reason we'll move to
  // columnar storage in Part 4. Watch for it in the profile.
  const parsed = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    // Note: NOT using dynamicTyping. It would add per-value type
    // coercion cost on top of everything else. We want the baseline
    // to be naive, not maximally pathological — an unfair baseline
    // is as useless as no baseline. Keep it honest.
  });

  const tParse = performance.now();
  log(`parse: ${(tParse - tRead).toFixed(0)}ms`);
  log(`rows: ${parsed.data.length}`);
  log(`TOTAL: ${(tParse - t0).toFixed(0)}ms`);
  log(`frames elapsed during load: ${frames}`);

  // Rough memory reading. Chrome-only, and it measures the whole JS heap
  // rather than just our data, so treat it as directional not precise.
  const mem = (performance as any).memory;
  if (mem) {
    log(`heap: ${(mem.usedJSHeapSize / 1e6).toFixed(0)}MB`);
  }
});