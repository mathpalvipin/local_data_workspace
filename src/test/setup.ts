// src/test/setup.ts
import { cleanup, configure } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// Real parsing (PapaParse over a File) runs inside these tests. The 1s
// default for waitFor/findBy is fine on an idle machine but flaked when the
// machine was busy, so allow 5s before a wait counts as a failure.
configure({ asyncUtilTimeout: 5000 });

// Testing Library only auto-cleans when Vitest globals are on. Imports are
// explicit here instead, so unmount rendered trees after each test ourselves.
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
