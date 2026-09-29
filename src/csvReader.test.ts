import { fireEvent, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// The original vanilla-TS baseline builds its UI into #app at import time.
describe('csvReader (vanilla baseline)', () => {
  it('parses a picked file on the main thread and logs timings', async () => {
    // One rAF tick runs synchronously (the IIFE); later ones are dropped.
    vi.stubGlobal('requestAnimationFrame', () => 1);
    Object.defineProperty(performance, 'memory', { configurable: true, value: { usedJSHeapSize: 50e6 } });

    const app = document.createElement('div');
    app.id = 'app';
    document.body.appendChild(app);
    await import('./csvReader');

    const out = document.querySelector<HTMLPreElement>('#out')!;
    const probe = [...document.body.children].find((el) => el.textContent?.startsWith('frames:'));
    expect(probe?.textContent).toBe('frames: 0');

    fireEvent.click(document.querySelector('#spin')!);
    expect(out.textContent).toBe('clicked at frame 1\n');

    const input = document.querySelector<HTMLInputElement>('#file')!;
    fireEvent.change(input, {
      target: { files: [new File(['id,name\n1,a\n2,b\n3,c\n'], 'x.csv')] },
    });

    await waitFor(() => expect(out.textContent).toContain('rows: 3'));
    expect(out.textContent).toMatch(/^file: 0\.0MB/);
    expect(out.textContent).toContain('read into string:');
    expect(out.textContent).toContain('TOTAL:');
    expect(out.textContent).toContain('heap: 50MB');

    // A change without a file does nothing.
    const before = out.textContent;
    fireEvent.change(input, { target: { files: [] } });
    expect(out.textContent).toBe(before);

    Reflect.deleteProperty(performance, 'memory');
    app.remove();
  });
});
