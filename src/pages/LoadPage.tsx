// src/pages/LoadPage.tsx
import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FrameCounter } from '../components/FrameCounter';
import { useWorkerContext } from '../worker/workerContext';

export function LoadPage() {
  const { status, progress, rowCount, bytes, loadMs, error, loadFile } = useWorkerContext();
  const navigate = useNavigate();

  // Written by <FrameCounter> every frame; read when the probe is clicked.
  const framesRef = useRef(0);
  const [clicks, setClicks] = useState<string[]>([]);

  // The second probe, next to the frame counter. With the worker, clicks
  // during a load should log immediately at steadily increasing frames. On
  // the main-thread bench they queue up and all log the same frame once
  // parsing ends. That contrast is the proof the worker helped.
  const probe = () => {
    const during = status === 'loading' ? ` (parsing, ${progress.toLocaleString()} rows so far)` : '';
    setClicks((c) => [...c, `clicked at frame ${framesRef.current}${during}`]);
  };

  const output =
    status === 'loading' ? `Parsing… ${progress.toLocaleString()} rows`
    : status === 'error' ? `error: ${error}`
    : status === 'ready' ? [
        `rows:     ${rowCount.toLocaleString()}`,
        `retained: ${(bytes / 1e6).toFixed(1)}MB`,
        `loaded:   ${loadMs.toFixed(0)}ms`,
      ].join('\n')
    : 'no file loaded';

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setClicks([]);
    loadFile(file);
  };

  return (
    <div className="workspace">
      <FrameCounter framesRef={framesRef} />
      <h1>CSV Workspace</h1>
      <div className="panels">
        <section className="panel">
          <h2>Load a CSV</h2>
          <p className="hint">Streamed and parsed in a Web Worker. The page stays responsive.</p>
          <input type="file" accept=".csv" onChange={onFile} disabled={status === 'loading'} />
          <button className="probe" onClick={probe}>
            Am I responsive?
          </button>

          {/* Side by side so a click can be read against the load it happened
              during. Both boxes are always rendered, so the layout doesn't
              jump as each one fills in. */}
          <div className="load-outputs">
            <div className="load-output">
              <div className="log-head"><span>Output</span></div>
              <pre className="log">{output}</pre>
            </div>
            <div className="load-output">
              <div className="log-head"><span>Clicks</span></div>
              <pre className="log">{clicks.join('\n') || 'no clicks yet'}</pre>
            </div>
          </div>

          {status === 'ready' && (
            <button className="probe" onClick={() => navigate('/preview')}>
              Preview
            </button>
          )}

          <p className="hint">
            <Link to="/bench">Naive vs columnar comparison →</Link>
          </p>
        </section>
      </div>
    </div>
  );
}
