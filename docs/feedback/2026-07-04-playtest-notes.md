# Playtest notes — 2026-07-04

Running list of comments/problems found while manually testing the app
(Telescope/Sequence/Data screens, `mvp0` branch).

1. **Telescope: can't remove an object from "Identified Objects".** Clicking
   around the sky tags unnamed stars (`star:2604`, `star:2232`, ...) into the
   sidebar list just as easily as named bodies, and there's no way to
   un-tag/delete one once it's there — the list only grows and gets flooded
   with unnamed stars, making it hard to find the ones that matter.
   - `src/ui/telescope/state.ts` only exposes `addIdentified`; there's no
     `removeIdentified` counterpart.
   - `src/ui/telescope/index.ts:223` renders `ui.identified` with no
     delete/remove control per row.
   - Want: a way to remove a single identified object from the list (e.g. a
     small ✕ per row), and/or avoid auto-tagging unnamed stars on click in
     the first place.

2. **[SERIOUS] Opening the angular-separation `<select>` dropdown causes
   rapid blinking/redrawing and freezes the browser (and nearly the whole
   macOS desktop).**
   - Root cause: `render()` in `src/ui/telescope/index.ts:200-276`
     unconditionally tears down and rebuilds both `sepASelect`/`sepBSelect`
     (`:240-258`, `select.textContent = ''` + re-append every `<option>`)
     and the identified-objects list (`:216-238`) on *every* call.
   - `render()` runs from `renderFrame()` (`:392-397`), which
     `src/main.ts:111-115` calls on every `requestAnimationFrame` tick
     (~60/sec) while the Telescope screen is visible — with no gating on
     whether `ui.identified` (or anything else) actually changed.
   - Opening a native `<select>` spawns an OS-level popup backed by the
     live DOM. Destroying/recreating its `<option>` children 60×/sec while
     that popup is open causes continuous popup invalidation/reflow, which
     is heavy enough to stall the compositor — explains the
     near-system-wide freeze on macOS (native select popups are drawn by
     the window server, not just the browser tab).
   - Fix direction: don't rebuild `<select>` options / id-list rows
     unconditionally per frame. Split `render()` into a "state changed"
     sync (called from click/change handlers, only touching DOM when
     `ui.identified` etc. actually changed) vs. a lightweight per-frame
     update for the two sensor readouts (`sunDirSensor`/`forwardSensor`),
     which are the only things that legitimately need every-frame updates.
