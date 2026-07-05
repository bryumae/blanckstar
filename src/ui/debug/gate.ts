// Debug-mode gating (mvp0_spec.md §10). Debug is enabled iff the build is a
// dev build AND the URL carries `?debug=1`. Both conditions are required so a
// leaked/curious query param can never enable debug in a production build, and
// a dev server without the query param still shows the normal game. Pure and
// synchronous so it's trivially unit-testable and safe to call before any
// module with worker/DOM side effects is loaded.
export function isDebugEnabled(search: string, isDev: boolean): boolean {
  if (!isDev) {
    return false;
  }
  return new URLSearchParams(search).get('debug') === '1';
}
