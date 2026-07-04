import { defineConfig } from 'vite';

// Native `new Worker(new URL('./x.ts', import.meta.url), { type: 'module' })`
// covers both worker#1 (sim) and worker#2 (sandbox) — no worker plugin needed.
export default defineConfig({});
