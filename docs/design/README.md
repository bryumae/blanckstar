# Design reference — Mission Interface

Source: claude.ai Design Canvas project
[Mission Interface](https://claude.ai/design/p/5f2c915c-d495-4cd0-9942-3a1d1f1bb798?file=Mission+Interface.dc.html&via=share)
(bundled export committed here; re-sync via `/design-login` + DesignSync if the
remote design changes).

| File | What |
|---|---|
| `mission-interface.html` | Original self-contained bundled export (open in a browser to view the interactive mockup). |
| `mission-interface-template.html` | Decoded template markup — the actual screen/component HTML+CSS+logic. Uses Design Canvas templating (`{{ }}`, `<sc-if>`, `<sc-for>`); **reference only**, must be hand-ported to vanilla DOM per repo rule 5. |
| `tokens.css` | Normalized design tokens (colors, fonts, radii, spacing, type scale) extracted from the mockup's inline styles. Source of truth for `src/ui/` styling. |
| `fonts/` | IBM Plex Mono/Sans woff2 subsets extracted from the bundle (local — gameplay has no network dependency). |

Caveats:

- The mockup's state is hardcoded (fixed MET, candidate `C-07`, burn `SB-2`,
  seed-2 badge) — it demonstrates layout and interaction, not real data flow.
- Stray-looking `</sc-for>` placements around the Candidates/Ephemeris tables
  are a Design Canvas templating quirk; verify markup when hand-porting.
