import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { execSync } from 'node:child_process';

function buildId(): string {
  let hash = 'dev';
  try {
    hash = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    /* אין git בסביבת הבנייה */
  }
  return hash + ' · ' + new Date().toISOString().slice(0, 16).replace('T', ' ');
}

export default defineConfig({
  plugins: [preact()],
  define: { __BUILD__: JSON.stringify(buildId()) },
  server: { proxy: { '/api': 'http://localhost:8787' } },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
