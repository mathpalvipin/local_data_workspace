// src/test/dom.ts
import { vi } from 'vitest';

/**
 * jsdom has no ResizeObserver. Returns a function that reports a new height
 * to the most recently created observer, as a browser would on resize.
 */
export function stubResizeObserver() {
  let callback: ResizeObserverCallback | null = null;
  const disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', function FakeResizeObserver(cb: ResizeObserverCallback) {
    callback = cb;
    return { observe: vi.fn(), unobserve: vi.fn(), disconnect };
  });
  const resize = (height: number) =>
    callback?.([{ contentRect: { height } } as ResizeObserverEntry], {} as ResizeObserver);
  return { resize, disconnect };
}

/**
 * jsdom's scrollTop never moves. Give an element a real, settable scrollTop
 * so scroll handlers and scrollToRow can be observed.
 */
export function makeScrollable(el: HTMLElement) {
  let value = 0;
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => value,
    set: (v: number) => { value = v; },
  });
  return { get: () => value };
}

/** A requestAnimationFrame that never fires, so rAF loops stay idle in tests. */
export function stubIdleRaf() {
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
}
