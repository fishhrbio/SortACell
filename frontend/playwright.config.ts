import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const frontend = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(frontend, '..');
const python = process.env.SORTACELL_PYTHON ?? 'python';
const url = 'http://127.0.0.1:8000';

export default defineConfig({
  testDir: './e2e',
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 12_000 },
  outputDir: './test-results',
  use: {
    baseURL: url,
    actionTimeout: 10_000,
    viewport: { width: 1440, height: 1050 },
    acceptDownloads: true,
    launchOptions: process.env.SORTACELL_BROWSER ? { executablePath: process.env.SORTACELL_BROWSER } : {},
  },
  webServer: {
    command: '"' + python + '" -m uvicorn backend.main:app --host 127.0.0.1 --port 8000',
    cwd: root,
    url: url + '/api/health',
    env: { SORTACELL_DATA_DIR: resolve(frontend, 'test-results', 'workspace') },
    timeout: 60_000,
    reuseExistingServer: false,
    stderr: 'pipe',
  },
});
