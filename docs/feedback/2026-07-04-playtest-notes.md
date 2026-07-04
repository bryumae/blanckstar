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
   - Status: fixed — added `removeIdentified` (`src/ui/telescope/state.ts`,
     also clears a separation selection pointing at the removed object) and
     a ✕ button per row (`.telescope-id-remove`, right of the STAR/BODY
     kind label).

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
   - Status: fixed in commit `b5d1df7`.

3. **Telescope: hint text overlaps the zoom control.** The "drag to look ·
   scroll to zoom · click a body or named star to identify" hint sits under/
   behind the zoom slider bar instead of alongside it — see screenshot.
   - `.telescope-hint` (`src/ui/telescope/telescope.css:122-129`, `bottom:
     16px; left: 16px`) and `.telescope-zoom-bar` (`:88-101`, `bottom: 16px;
     left: 50%; transform: translateX(-50%)`) are both pinned to the same
     bottom row with no width reservation between them, so at narrower
     viewport widths they overlap.
   - Want: reposition one of them (e.g. move the hint above the zoom bar, or
     right-align/shrink it) so they don't collide.
   - Status: fixed — hint moved to top-left (`top: 60px; left: 14px`),
     below the mode toggle, clear of the zoom bar.

4. **Telescope: identified objects survive starting a fresh game.** Starting
   a new scenario didn't clear "Identified Objects" from the previous run —
   objects the player hasn't found yet in the new run showed up already
   tagged.
   - Root cause: the Telescope screen mounts once at app boot and its
     `ui.identified` state lived only in `mountTelescopeScreen`'s closure,
     never reset when the sim reinitializes for a new scenario.
   - Status: fixed — added `reset()` to `TelescopeScreenHandle`
     (`src/ui/telescope/index.ts`), called from `src/main.ts` on the sim's
     `ready` event (mirrors the existing `measurements.clear()` on `ready`).

5. **Telescope: identified-objects list had no scroll and was too narrow.**
   A long list of identified objects had no independent scrollbar and grew
   to push other sidebar sections out of view; long star names got cramped.
   - Root cause: `.telescope-sidebar` had `overflow-y: auto` but no
     `min-height: 0` — the classic flex-item bug where a flex child won't
     shrink below its content size, so overflow never actually kicked in.
   - Status: fixed — `.telescope-sidebar` gets `min-height: 0` and widened
     to 380px; `.telescope-id-list` now has its own `max-height: 260px` +
     independent scroll so the separation tool/sensors below it stay
     reachable; long names truncate with an ellipsis + `title` tooltip
     instead of overflowing.

6. **Ephemeris and Measurement Log promoted to first-level nav screens.**
   Both were cards buried inside Data's 12-col grid, cramped for anything
   with a long list (see screenshot — the ephemeris table got clipped with
   no way to see the rest). Moved both out to their own nav entries below
   Data.
   - New `src/ui/ephemeris/` and `src/ui/measurementLog/` screen modules
     (each a single full-width `data-card--span-12`, reusing Data's
     card/table CSS). `src/ui/data/index.ts` now only owns
     Radio/Ship/Burns/Time/Inserted-state-analysis.
   - Measurement Log renders the same shared `MeasurementMirror` instance
     from `main.ts` (no more separate private mirror inside Data).
   - Extracted the `card()` helper to `src/ui/dataCard.ts` since 3 modules
     now build the same panel markup.

7. **Telescope: filter identified objects by type.** Added a "Filter ▾"
   dropdown next to the "IDENTIFIED OBJECTS" header with checkboxes for
   Bodies/Stars — unchecking a kind hides matching rows from the list (the
   "X of Y tagged" count stays unfiltered/absolute). Caught and fixed a bug
   in the same change: a bare `window` click-to-close listener was also
   firing on clicks inside the dropdown menu itself, closing it after every
   single checkbox toggle — fixed by stopping propagation on clicks inside
   the menu.

8. **Follow-up polish on the filter dropdown:**
   - **FOV badge vertical alignment bug.** "FIELD OF VIEW" label and its
     value weren't vertically centered in the top-right badge — fixed by
     adding `align-items: center` to `.telescope-overlay`.
   - **Filter now also restricts the Angular Separation selects.** Body
     A/B dropdowns previously always listed every identified object
     regardless of the sidebar filter; both now share the same filtered
     list (`options = visibleIdentified`).
   - **Split "Stars" into "Named Stars" / "Numeric Stars".** A star is
     "named" if its catalog entry has a real name (e.g. Toliman), else
     "numeric" (shows as `star:NNNN`) — the numeric ones are what flood
     the list, so they're now independently filterable.

9. **Header: TIME WARP took too much space, wrapping the beacon/scenario
   badges onto a second line.** Collapsed the always-visible 6-button warp
   row into a compact "WARP ⏸/1×/..." button showing only the current
   state; clicking or hovering it opens a floating panel (absolute-
   positioned, doesn't reflow the header) with the full warp row plus
   SKIP-TO-TIME (moved here from Data's now-redundant TIME CONTROLS card,
   which is deleted — same "advance simulation time" concern, one place).
   `src/ui/shell/index.ts`/`shell.css`; `src/ui/data/index.ts` no longer
   tracks `warp`/`skipFraction`/`interruptNote` at all.
