// src/components/FrameCounter.tsx
import { useEffect, useRef, type RefObject } from 'react';

/**
 * Liveness probe: a number that ticks every animation frame. If the main
 * thread blocks, rAF can't fire and the counter visibly stalls.
 *
 * It paints straight into a DOM node instead of going through React state.
 * The earlier version called setState every frame, re-rendering React 60x/s
 * for the whole load, and that stole enough CPU to make the worker's parse
 * look 3x slower than it was (Decision.md, Part 4). The instrument was
 * distorting the measurement.
 */
export function FrameCounter({ framesRef }: { framesRef?: RefObject<number> }) {
  const spanRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let frames = 0;
    let id = requestAnimationFrame(function tick() {
      frames += 1;
      if (framesRef) framesRef.current = frames;
      if (spanRef.current) spanRef.current.textContent = String(frames);
      id = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(id);
  }, [framesRef]);

  return (
    <div className="frames">
      frames: <span ref={spanRef}>0</span>
    </div>
  );
}
