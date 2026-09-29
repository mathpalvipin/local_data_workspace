import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createFakeWorker } from './test/fakeWorker';
import { stubIdleRaf } from './test/dom';

const fake = createFakeWorker();
vi.mock('./worker/csv.worker?worker', () => ({
  default: function FakeCsvWorker() {
    return fake.worker;
  },
}));

describe('main entry', () => {
  it('mounts the app with the worker provider and the load page at /', async () => {
    stubIdleRaf();
    const root = document.createElement('div');
    root.id = 'root';
    document.body.appendChild(root);

    await import('./main');

    await waitFor(() => expect(screen.getByRole('heading', { name: 'CSV Workspace' })).toBeTruthy());
    // The provider created the worker; the load page is wired to it.
    expect(screen.getByText('no file loaded')).toBeTruthy();
    root.remove();
  });
});
