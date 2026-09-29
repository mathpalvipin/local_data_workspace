import { act, render } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { FrameCounter } from './FrameCounter';

/** Drive requestAnimationFrame by hand so frames are deterministic. */
function stubRaf() {
  let queued: FrameRequestCallback[] = [];
  let id = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    queued.push(cb);
    return ++id;
  });
  const cancel = vi.fn();
  vi.stubGlobal('cancelAnimationFrame', cancel);
  const frame = () => {
    const run = queued;
    queued = [];
    run.forEach((cb) => cb(performance.now()));
  };
  return { frame, cancel };
}

describe('FrameCounter', () => {
  it('counts frames by writing to the DOM, without re-rendering', () => {
    const raf = stubRaf();
    const renders = vi.fn();
    const Probe = () => {
      renders();
      return <FrameCounter />;
    };
    const { container } = render(<Probe />);
    const rendersAfterMount = renders.mock.calls.length;

    act(() => {
      raf.frame();
      raf.frame();
      raf.frame();
    });

    expect(container.textContent).toBe('frames: 3');
    // The whole point: ticking must not cause React renders.
    expect(renders).toHaveBeenCalledTimes(rendersAfterMount);
  });

  it('writes the count into framesRef when given one', () => {
    const raf = stubRaf();
    const framesRef = createRef<number>() as { current: number };
    framesRef.current = 0;
    render(<FrameCounter framesRef={framesRef} />);

    act(() => {
      raf.frame();
      raf.frame();
    });
    expect(framesRef.current).toBe(2);
  });

  it('cancels its animation frame on unmount', () => {
    const raf = stubRaf();
    const { unmount } = render(<FrameCounter />);
    unmount();
    expect(raf.cancel).toHaveBeenCalled();
  });
});
