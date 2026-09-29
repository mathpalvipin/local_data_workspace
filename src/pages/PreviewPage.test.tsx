import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ROW_HEIGHT } from '../grid/geometry';
import { createFakeWorker } from '../test/fakeWorker';
import { makeScrollable, stubResizeObserver } from '../test/dom';
import { renderPage, workerState } from '../test/renderWithWorker';
import { PreviewPage } from './PreviewPage';

const columns = [
  { name: 'id', kind: 'int32', bytes: 4 },
  { name: 'email', kind: 'blob', bytes: 20 },
];

const ready = (rowCount: number) =>
  workerState({ status: 'ready', worker: createFakeWorker().worker, rowCount, columns });

describe('PreviewPage', () => {
  it.each(['idle', 'loading', 'error'] as const)('redirects to / when status is %s', (status) => {
    renderPage(<PreviewPage />, '/preview', workerState({ status }));
    expect(screen.getByText('route: /')).toBeTruthy();
  });

  it('shows the size of the data and the grid when ready', () => {
    stubResizeObserver();
    const { container } = renderPage(<PreviewPage />, '/preview', ready(500_000));
    expect(screen.getByText(`${(500_000).toLocaleString()} rows × 2 columns`)).toBeTruthy();
    expect(container.querySelector('.grid-viewport')).toBeTruthy();
  });

  it('jump buttons scroll the grid to their row', () => {
    stubResizeObserver();
    const { container } = renderPage(<PreviewPage />, '/preview', ready(500_000));
    const scroll = makeScrollable(container.querySelector<HTMLDivElement>('.grid-viewport')!);

    fireEvent.click(screen.getByText('row 40k'));
    expect(scroll.get()).toBe(40_000 * ROW_HEIGHT);
    fireEvent.click(screen.getByText('row 400k'));
    expect(scroll.get()).toBe(400_000 * ROW_HEIGHT);
  });

  it('disables jumps beyond the loaded rows', () => {
    stubResizeObserver();
    renderPage(<PreviewPage />, '/preview', ready(10_000));
    expect(screen.getByText<HTMLButtonElement>('row 4k').disabled).toBe(false);
    expect(screen.getByText<HTMLButtonElement>('row 40k').disabled).toBe(true);
    expect(screen.getByText<HTMLButtonElement>('row 400k').disabled).toBe(true);
  });

  it('has a Back link to the load page', () => {
    stubResizeObserver();
    renderPage(<PreviewPage />, '/preview', ready(10));
    fireEvent.click(screen.getByText('← Back'));
    expect(screen.getByText('route: /')).toBeTruthy();
  });
});
