import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

// One vitest config for the whole project. Root is the repo root so coverage
// `include` globs can name `src/**/*.ts` directly.
//
// Coverage philosophy: per-file thresholds, scoped to src/core/ only — that's
// the pure, no-DOM/no-worker-globals layer (vectors, constants, RK4, gravity,
// orbital elements, ephemeris interpolation). sim/, sandbox/, render/, ui/, and
// main.ts are worker/DOM/browser glue with no hard numeric floor; they're
// integration-tested instead (mirrors how the sibling altinity-sql-browser
// project treats its app.js/main.js glue layer).
export default defineConfig({
  root: repoRoot,
  test: {
    environment: 'happy-dom',
    include: ['tests/unit/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: resolve(repoRoot, 'coverage'),
      include: ['src/core/**/*.ts'],
      thresholds: {
        perFile: true,
        statements: 100,
        functions: 95,
        branches: 90,
        lines: 100,
      },
    },
  },
});
