# Lore Ledger Documentation

This is the navigation index for everything in `docs/`. Files are organized by purpose:

- **Reference** — load-bearing technical docs that describe current state of the system
- **Operations** — release, testing, and maintenance procedures
- **Plans** — active forward-looking planning docs
- **Features** — design and implementation notes for specific features
- **Reference (policy)** — ratified policies for content, attribution, and scope
- **Personal notes** — personal working notes and prompts retained for context

For project-level docs (README, CONTRIBUTING, AGENTS, CLAUDE, CHANGELOG, LEGAL), see the repo root.

---

## Reference (system architecture and state)

These describe how the app currently works. Read before making architectural changes.

- [`architecture.md`](./architecture.md) — Current system architecture: module boundaries, state flow, init lifecycle, and the key patterns (incremental DOM patches, blob replacement rollback, dependency injection over window globals).
- [`state-schema.md`](./state-schema.md) — Canonical schema for persisted state: shape of tracker, character, map, and settings buckets, plus migration history.

---

## Operations (release, testing, maintenance)

Procedures and checklists for shipping and maintaining the app.

### Testing

- [`operations/testing-guide.md`](./operations/testing-guide.md) — Comprehensive manual testing reference: philosophy, pre-merge and pre-release checks, persistence checks, page-by-page coverage (Tracker, Character, Map), backup/import, PWA/offline, CSP, browser matrix. **The hub doc** — links out to the focused checklists below.
- [`operations/browser-smoke-status.md`](./operations/browser-smoke-status.md) — Canonical source for the current Playwright automation posture. What's automated, what's intentionally manual, what's out of scope this version.
- [`operations/pre-ship-smoke-test.md`](./operations/pre-ship-smoke-test.md) — 5-minute pre-ship checklist: NPC portrait persistence, map drawing persistence, undo/redo ephemerality, full backup round-trip.
- [`operations/vite-smoke-test.md`](./operations/vite-smoke-test.md) — Post-Vite-change validation: dev server boot, theme apply without flash, hash routing, static assets, production build + preview parity, offline app shell.
- [`operations/csp-audit.md`](./operations/csp-audit.md) — Content Security Policy audit notes: what the current CSP allows and why, plus dev-mode considerations.

### Release and runtime concerns

- [`operations/release-process.md`](./operations/release-process.md) — End-to-end release procedure for tagging and shipping new versions.
- [`operations/pwa-notes.md`](./operations/pwa-notes.md) — Progressive Web App behavior notes: service worker, Workbox precache, install/update flows.
- [`operations/storage-and-backups.md`](./operations/storage-and-backups.md) — How localStorage is used, how backups are exported and imported, blob replacement rollback semantics.
- [`operations/security-privacy.md`](./operations/security-privacy.md) — Security and privacy posture: what data is stored where, debug-info safety, support-flow considerations.
- [`operations/troubleshooting.md`](./operations/troubleshooting.md) — Known failure modes and diagnostic approaches.

---

## Plans (active forward-looking work)

Planning docs for work that's queued or in progress. These get updated as plans evolve.

- [`plans/new-features-roadmap.md`](./plans/new-features-roadmap.md) — Forward-looking roadmap of features and improvements under consideration.
- [`plans/lore-ledger-builder-plan.md`](./plans/lore-ledger-builder-plan.md) — Plan for the in-app builder feature: scope, content registry approach, attribution requirements.

---

## Features (per-feature design notes)

Design documents for shipped features. These survive shipping because they document decisions and tradeoffs that future changes need to respect.

- [`features/multi-character-design.md`](./features/multi-character-design.md) — Multi-character design and implementation: shipped feature record covering Steps 1–4 of the multi-character work.
- [`features/character-portability.md`](./features/character-portability.md) — Character portability design: how character data moves between campaigns and across backups.

---

## Reference (policy)

Ratified policies for content, attribution, and scope. These are authoritative — design decisions live here, not in personal notes.

- [`reference/attribution-requirements.md`](./reference/attribution-requirements.md) — Required attribution language for SRD-derived content, OGL/CC-BY surfaces.
- [`reference/srd-licensing-notes.md`](./reference/srd-licensing-notes.md) — Licensing context for SRD use: what's covered by which license, what attribution is required where.
- [`reference/content-registry-plan.md`](./reference/content-registry-plan.md) — Plan for the content registry: how SRD-derived content is structured, validated, and surfaced in the app.
- [`reference/builder-scope-greenlist.md`](./reference/builder-scope-greenlist.md) — Greenlist of feature scope for the in-app builder: what's in, what's out, decision rationale.

---

## Personal notes

Personal working notes and prompts. These are retained for context but are not authoritative when they conflict with reference docs or `AGENTS.md`.

- [`#personal/SRD building master prompts.md`](./#personal/SRD building master prompts.md) — Reusable strict audit and patch prompts for validating SRD registry files before treating them as source-of-truth builder data.
- [`#personal/TODO-NEXT.md`](./#personal/TODO-NEXT.md) — Personal documentation-reorganization audit notes and proposed target structure.
- [`#personal/vertical-slice-schema.md`](./#personal/vertical-slice-schema.md) — Personal design record for the build-time choices schema and vertical-slice validation approach.

---

## Where to start

**Returning to the project after a break?**
Start with [`architecture.md`](./architecture.md), then check [`plans/new-features-roadmap.md`](./plans/new-features-roadmap.md) for what's queued.

**About to ship a release?**
[`operations/pre-ship-smoke-test.md`](./operations/pre-ship-smoke-test.md) for the fast spot-check, then [`operations/testing-guide.md`](./operations/testing-guide.md) Section 4 for the full pre-release set, then [`operations/release-process.md`](./operations/release-process.md) for the tagging procedure.

**Changed Vite config or build tooling?**
[`operations/vite-smoke-test.md`](./operations/vite-smoke-test.md).

**Touched persistence, storage, or migration code?**
[`operations/testing-guide.md`](./operations/testing-guide.md) Section 5, plus [`operations/storage-and-backups.md`](./operations/storage-and-backups.md) for the rollback contract.

**Adding SRD-derived content or builder content?**
[`reference/srd-licensing-notes.md`](./reference/srd-licensing-notes.md), [`reference/attribution-requirements.md`](./reference/attribution-requirements.md), and [`reference/builder-scope-greenlist.md`](./reference/builder-scope-greenlist.md) before touching code.

**Wondering what's automated vs. manual in tests?**
[`operations/browser-smoke-status.md`](./operations/browser-smoke-status.md).
