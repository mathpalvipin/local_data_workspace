import { act, fireEvent, render } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { createFakeWorker } from '../test/fakeWorker';
import { makeScrollable, stubResizeObserver } from '../test/dom';
import { Grid, type GridHandle } from './Grid';
import { ROW_HEIGHT } from './geometry';

const columns = [
  { name: 'id', kind: 'int32' },
  { name: 'email', kind: 'blob' },
];
const page = (start: number, count = 200) =>
  Array.from({ length: count }, (_, i) => [String(start + i), `user${start + i}@example.com`]);

const setup = (rowCount = 1000) => {
  const ro = stubResizeObserver();
  const fake = createFakeWorker();
  const ref = createRef<GridHandle>();
  const utils = render(<Grid ref={ref} worker={fake.worker} rowCount={rowCount} columns={columns} />);
  const viewport = utils.container.querySelector<HTMLDivElement>('.grid-viewport')!;
  const rows = () => [...utils.container.querySelectorAll<HTMLDivElement>('.grid-row')];
  return { ...utils, ro, fake, ref, viewport, rows };
};

describe('Grid', () => {
  it('renders a sticky header with alignment by column kind', () => {
    const { container } = setup();
    const header = [...container.querySelectorAll('.grid-header .grid-cell')];
    expect(header.map((c) => c.textContent)).toEqual(['id', 'email']);
    expect(header[0].className).toContain('num');
    expect(header[1].className).toContain('text');
  });

  it('shows full-height placeholder rows until the page arrives', () => {
    const { rows, fake } = setup();
    expect(rows().length).toBeGreaterThan(0);
    expect(rows().every((r) => r.classList.contains('placeholder'))).toBe(true);
    expect(rows()[0].textContent).toBe('——');
    expect(fake.postMessage).toHaveBeenCalledWith({ type: 'page', start: 0, count: 200 });
  });

  it('swaps placeholders for real rows when the page arrives', () => {
    const { rows, fake } = setup();
    act(() => fake.reply({ type: 'page', start: 0, rows: page(0) }));
    expect(rows()[0].classList.contains('placeholder')).toBe(false);
    expect(rows()[0].textContent).toBe('0user0@example.com');
  });

  it('renders only the visible window plus overscan, sized by ResizeObserver', () => {
    const { rows, ro } = setup();
    // Before measuring: 800px fallback → (800 - header) / 32 = 24 rows + 10 overscan.
    expect(rows()).toHaveLength(34);
    act(() => ro.resize(10 * ROW_HEIGHT));
    // 10 rows tall minus the header row = 9 visible + 10 overscan.
    expect(rows()).toHaveLength(19);
  });

  it('keys rows by absolute index and offsets the window with translateY from start', () => {
    const { rows, viewport, container } = setup();
    const scroll = makeScrollable(viewport);
    viewport.scrollTop = 100 * ROW_HEIGHT;
    fireEvent.scroll(viewport);

    expect(scroll.get()).toBe(3200);
    // start = 100 - OVERSCAN = 90; aria-rowindex is 1-based and after the header.
    expect(rows()[0].getAttribute('aria-rowindex')).toBe(String(90 + 2));
    const window = container.querySelector<HTMLDivElement>('.grid-rows')!;
    expect(window.style.transform).toBe(`translateY(${90 * ROW_HEIGHT}px)`);
  });

  it('sets the spacer to the full data height', () => {
    const { container } = setup(500_000);
    const spacer = container.querySelector<HTMLDivElement>('.grid-spacer')!;
    expect(spacer.style.height).toBe(`${500_000 * ROW_HEIGHT}px`);
  });

  it('scrollToRow moves the real scroll position, clamped to the data', () => {
    const { ref, viewport } = setup(1000);
    const scroll = makeScrollable(viewport);

    act(() => ref.current!.scrollToRow(400));
    expect(scroll.get()).toBe(400 * ROW_HEIGHT);

    act(() => ref.current!.scrollToRow(-5));
    expect(scroll.get()).toBe(0);

    act(() => ref.current!.scrollToRow(5_000));
    expect(scroll.get()).toBe(999 * ROW_HEIGHT);
  });

  it('disconnects its ResizeObserver on unmount', () => {
    const { unmount, ro } = setup();
    unmount();
    expect(ro.disconnect).toHaveBeenCalled();
  });
});
