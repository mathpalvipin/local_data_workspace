import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stubIdleRaf } from '../test/dom';
import { BenchPage } from './BenchPage';

const CSV = 'id,score,region\n0,56.45,us-east\n1,12.40,eu-central\n2,,us-east\n';

const setup = () => {
  const utils = render(<MemoryRouter><BenchPage /></MemoryRouter>);
  const panel = (title: string) => screen.getByRole('heading', { name: title }).closest('section')!;
  const log = (title: string) => panel(title).querySelector('pre')!.textContent;
  const pick = (title: string, csv: string) =>
    fireEvent.change(panel(title).querySelector('input[type=file]')!, {
      target: { files: [new File([csv], 'test.csv')] },
    });
  return { ...utils, panel, log, pick };
};

// Clipboard pieces jsdom lacks or fixes in place; each test sets what it needs.
const setClipboard = (secure: boolean, writeText?: (t: string) => Promise<void>) => {
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: secure });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: writeText ? { writeText } : undefined,
  });
};

describe('BenchPage', () => {
  beforeEach(() => {
    stubIdleRaf();
    vi.spyOn(console, 'table').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    Reflect.deleteProperty(document, 'execCommand');
    Reflect.deleteProperty(performance, 'memory');
  });

  it('starts with two empty panels and copy buttons disabled', () => {
    const { log } = setup();
    expect(log('Naive')).toBe('no file loaded');
    expect(log('Columnar')).toBe('no file loaded');
    expect(screen.getByText<HTMLButtonElement>('Copy all logs').disabled).toBe(true);
  });

  it('runs the naive A/B/C experiment and reports rows', async () => {
    Object.defineProperty(performance, 'memory', { configurable: true, value: { usedJSHeapSize: 278e6 } });
    const { log, pick } = setup();
    pick('Naive', CSV);
    await waitFor(() => expect(log('Naive')).toContain('rows: 3'));
    const text = log('Naive');
    expect(text).toMatch(/^file: 0\.0MB/);
    expect(text).toContain('A tokenize-only');
    expect(text).toContain('(4 rows)'); // header + 3 rows when not using header mode
    expect(text).toContain('C objects retained');
    expect(text).toContain('TOTAL:');
    expect(text).toContain('heap: 278MB');
  });

  it('loads columnar and reports retained size', async () => {
    const { log, pick } = setup();
    pick('Columnar', CSV);
    await waitFor(() => expect(log('Columnar')).toContain('retained:'));
    expect(log('Columnar')).toContain('columnar parse:');
    expect(console.table).toHaveBeenCalled();
  });

  it('ignores a change with no file', () => {
    const { panel, log } = setup();
    fireEvent.change(panel('Naive').querySelector('input[type=file]')!, { target: { files: [] } });
    expect(log('Naive')).toBe('no file loaded');
  });

  it('row 400k asks for a file first, then reports a short file', async () => {
    const { panel, log, pick } = setup();
    for (const title of ['Naive', 'Columnar']) {
      fireEvent.click(within(panel(title)).getByText('row 400k'));
      expect(log(title)).toBe('load a file first');
      pick(title, CSV);
      await waitFor(() => expect(log(title)).toMatch(/rows: 3|retained:/));
      fireEvent.click(within(panel(title)).getByText('row 400k'));
      expect(log(title)).toContain('no row 400000 (only 3)');
    }
  });

  it('row 400k prints the row from each lane when the file is big enough', async () => {
    const big = ['id', ...Array.from({ length: 400_001 }, (_, i) => String(i))].join('\n');
    const { panel, log, pick } = setup();
    for (const title of ['Naive', 'Columnar']) {
      pick(title, big);
      await waitFor(() => expect(log(title)).toMatch(/rows: 400001|retained:/), { timeout: 20_000 });
      fireEvent.click(within(panel(title)).getByText('row 400k'));
      expect(log(title)).toContain('row 400000: {"id":');
    }
  }, 30_000);

  it('logs responsiveness clicks per panel', () => {
    const { panel, log } = setup();
    fireEvent.click(within(panel('Columnar')).getByText('Am I responsive?'));
    expect(log('Columnar')).toBe('clicked at frame 0');
    expect(log('Naive')).toBe('no file loaded');
  });

  it('copies one panel via the clipboard API and resets the label', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard(true, writeText);
    const { panel } = setup();
    fireEvent.click(within(panel('Naive')).getByText('Am I responsive?'));
    fireEvent.click(within(panel('Naive')).getByText('Copy'));

    await waitFor(() => expect(within(panel('Naive')).getByText('Copied!')).toBeTruthy());
    expect(writeText).toHaveBeenCalledWith(
      '## Naive — Whole file to string, parsed on the main thread\nclicked at frame 0',
    );
    await waitFor(() => expect(within(panel('Naive')).getByText('Copy')).toBeTruthy(), { timeout: 3000 });
  });

  it('falls back to execCommand outside a secure context', async () => {
    setClipboard(false);
    const execCommand = vi.fn(() => true);
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });
    const { panel } = setup();
    fireEvent.click(within(panel('Naive')).getByText('Am I responsive?'));
    fireEvent.click(within(panel('Naive')).getByText('Copy'));
    await waitFor(() => expect(within(panel('Naive')).getByText('Copied!')).toBeTruthy());
    expect(execCommand).toHaveBeenCalledWith('copy');
  });

  it('shows Copy failed when no copy route works', async () => {
    setClipboard(false); // and no execCommand in jsdom: it throws
    const { panel } = setup();
    fireEvent.click(within(panel('Naive')).getByText('Am I responsive?'));
    fireEvent.click(within(panel('Naive')).getByText('Copy'));
    await waitFor(() => expect(within(panel('Naive')).getByText('Copy failed')).toBeTruthy());
  });

  it('copies all panels in one formatted block', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard(true, writeText);
    const { panel } = setup();
    fireEvent.click(within(panel('Naive')).getByText('Am I responsive?'));
    fireEvent.click(screen.getByText('Copy all logs'));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const text = writeText.mock.calls[0][0] as string;
    expect(text).toMatch(/^# CSV Workspace logs\n\d{4}-\d{2}-\d{2}T/);
    expect(text).toContain('## Naive — Whole file to string, parsed on the main thread\nclicked at frame 0');
    expect(text).toContain('## Columnar — Typed columns, still on the main thread\n(no file loaded)');
  });

  it('links back to the load page', () => {
    setup();
    expect(screen.getByText('← Load page').getAttribute('href')).toBe('/');
  });
});
