// src/test/setup.ts
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Testing Library only auto-cleans when Vitest globals are on. Imports are
// explicit here instead, so unmount rendered trees after each test ourselves.
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
