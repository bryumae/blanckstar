# Security Policy

Blanckstar is a client-only browser game: no backend, no authentication, no
user accounts, and no user data leaves the browser (scripts, notes, and
candidate estimates persist only in `localStorage`, per
`docs/mvp0_spec.md` §2.3, §7.6). The only security-relevant boundary is the
player-script sandbox: player-authored JavaScript runs in a dedicated Web
Worker with a clean global scope (no DOM, no network, no `importScripts`) and
a deliberately restricted API surface. The forbidden-API list — anything that
would leak the ship's true position/velocity/orbit or hand the player a
solver — is specified in `docs/mvp0_spec.md` §8.3; a sandbox escape or a leak
of hidden truth through that boundary is the class of issue this policy cares
about most.

## Reporting a vulnerability

**Please do not open a public GitHub issue for a security vulnerability.**

Report privately via **GitHub private advisory**: on this repository, go to
**Security → Advisories → Report a vulnerability**. This opens a private
thread with the maintainers.

We aim to acknowledge a report within a few business days and to keep you
updated as we triage and fix. Please give us a reasonable window to ship a fix
before any public disclosure; we're happy to credit reporters who want it.
