import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { stubIdleRaf } from '../test/dom';
import { renderPage, workerState } from '../test/renderWithWorker';
import { LoadPage } from './LoadPage';

const outputText = (container: HTMLElement) =>
  container.querySelectorAll<HTMLPreElement>('.load-output pre')[0].textContent;
const clicksText = (container: HTMLElement) =>
  container.querySelectorAll<HTMLPreElement>('.load-output pre')[1].textContent;

describe('LoadPage', () => {
  beforeEach(() => stubIdleRaf());

  it('starts with no file loaded and no clicks', () => {
    const { container } = renderPage(<LoadPage />, '/', workerState());
    expect(outputText(container)).toBe('no file loaded');
    expect(clicksText(container)).toBe('no clicks yet');
    expect(screen.queryByText('Preview')).toBeNull();
  });

  it('passes the picked file to loadFile', () => {
    const state = workerState();
    const { container } = renderPage(<LoadPage />, '/', state);
    const file = new File(['a\n1'], 'x.csv');
    fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [file] } });
    expect(state.loadFile).toHaveBeenCalledWith(file);
  });

  it('ignores a change event with no file', () => {
    const state = workerState();
    const { container } = renderPage(<LoadPage />, '/', state);
    fireEvent.change(container.querySelector('input[type=file]')!, { target: { files: [] } });
    expect(state.loadFile).not.toHaveBeenCalled();
  });

  it('shows progress and disables the input while loading', () => {
    const { container } = renderPage(<LoadPage />, '/', workerState({ status: 'loading', progress: 1234 }));
    expect(outputText(container)).toBe(`Parsing… ${(1234).toLocaleString()} rows`);
    expect(container.querySelector<HTMLInputElement>('input[type=file]')!.disabled).toBe(true);
  });

  it('shows the error message', () => {
    const { container } = renderPage(<LoadPage />, '/', workerState({ status: 'error', error: 'bad file' }));
    expect(outputText(container)).toBe('error: bad file');
  });

  it('shows results and navigates to the preview when ready', () => {
    const { container } = renderPage(
      <LoadPage />,
      '/',
      workerState({ status: 'ready', rowCount: 500_000, bytes: 32_300_000, loadMs: 2179.4 }),
    );
    const out = outputText(container)!;
    expect(out).toContain(`rows:     ${(500_000).toLocaleString()}`);
    expect(out).toContain('retained: 32.3MB');
    expect(out).toContain('loaded:   2179ms');

    fireEvent.click(screen.getByText('Preview'));
    expect(screen.getByText('route: /preview')).toBeTruthy();
  });

  it('logs responsiveness clicks with the current frame', () => {
    const { container } = renderPage(<LoadPage />, '/', workerState());
    fireEvent.click(screen.getByText('Am I responsive?'));
    fireEvent.click(screen.getByText('Am I responsive?'));
    expect(clicksText(container)).toBe('clicked at frame 0\nclicked at frame 0');
  });

  it('adds parse progress to clicks made during a load', () => {
    const state = workerState({ status: 'loading', progress: 42 });
    const { container } = renderPage(<LoadPage />, '/', state);
    fireEvent.click(screen.getByText('Am I responsive?'));
    expect(clicksText(container)).toBe('clicked at frame 0 (parsing, 42 rows so far)');
  });

  it('clears the click log when a new file is picked', () => {
    const { container } = renderPage(<LoadPage />, '/', workerState());
    fireEvent.click(screen.getByText('Am I responsive?'));
    fireEvent.change(container.querySelector('input[type=file]')!, {
      target: { files: [new File(['x'], 'x.csv')] },
    });
    expect(clicksText(container)).toBe('no clicks yet');
  });

  it('links to the bench page', () => {
    renderPage(<LoadPage />, '/', workerState());
    fireEvent.click(screen.getByText(/comparison/));
    expect(screen.getByText('route: /bench')).toBeTruthy();
  });
});
