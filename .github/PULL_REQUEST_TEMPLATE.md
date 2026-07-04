## What & why
<!-- What does this change and why? Link issues, e.g. "Closes #123". -->

## Checklist
- [ ] `npm test` passes (the `src/core/` per-file coverage gate is non-negotiable)
- [ ] Tests added/updated in the same change as the code
- [ ] `npm run build` succeeds
- [ ] Layers kept honest: pure logic in `src/core/`, worker glue in `src/sim/`/`src/sandbox/`, Three.js glue in `src/render/`, DOM in `src/ui/`, side effects injected via `src/net/`
- [ ] No new runtime dependency (or it's a deliberate, justified addition — see CONTRIBUTING)
- [ ] README / `CHANGELOG.md` (`[Unreleased]`) updated if behavior changed
- [ ] Reconciled affected tracked work (roadmap meta-issue — TBD, once one exists — the issue body, ADR/CHANGELOG) if this change reshaped it
