// src/test/fakeWorker.ts
import { vi } from 'vitest';
import type { Response } from '../worker/protocol';

/**
 * A stand-in for the CSV worker: records what the UI posts and lets a test
 * push replies back. Built on EventTarget so both addEventListener (used by
 * WorkerProvider and usePageCache) and removeEventListener behave for real.
 */
export function createFakeWorker() {
  const target = new EventTarget();
  const postMessage = vi.fn();
  const terminate = vi.fn();

  const worker = Object.assign(target, { postMessage, terminate, onmessage: null, onmessageerror: null, onerror: null });

  /** Deliver a message to every listener, as the real worker would. */
  const reply = (msg: Response) => {
    target.dispatchEvent(new MessageEvent('message', { data: msg }));
  };

  return { worker: worker as unknown as Worker, postMessage, terminate, reply };
}
