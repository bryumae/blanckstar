// Ambient module declaration for side-effect CSS imports (e.g.
// `import './telescope.css'`). Vite handles these at build time; this just
// satisfies the TypeScript compiler. tsconfig.json's `types`/`lib` are
// out of scope for this change, so the declaration lives here instead of
// pulling in the full `vite/client` triple-slash reference.
declare module '*.css';
