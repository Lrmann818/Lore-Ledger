# Lore Ledger Documentation

This is the navigation index for everything in `docs/`. Files are organized by purpose:

- **Reference** — load-bearing technical docs that describe current state of the system
- **Operations** — release, testing, and maintenance procedures
- **Plans** — active forward-looking planning docs
- **Design** — decision records and rationale for architecture or schema choices
- **Features** — design and implementation notes for specific features
- **Reference (policy)** — ratified policies for content, attribution, and scope
- **Archive** — superseded plans, trackers, and audits. Historical only.

For project-level docs (README, CONTRIBUTING, AGENTS, CLAUDE, CHANGELOG, LEGAL), see the repo root.

> **Coding agents:** read the task-specific doc map in [`AGENTS.md`](../AGENTS.md#agent-doc-map)
> before opening anything here. Read the docs your task needs, not all of them.
>
> Docs marked **📜 Historical** below are point-in-time records. They describe a state of
> the world that no longer exists. Do not treat them as current, and do not change code to
> match them. When a historical doc disagrees with a canonical one, the canonical one wins.

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

- [`operations/release-process.md`](./operations/release-process.md) — End-to-end **web** release procedure for tagging and shipping new versions.
- [`operations/ios-packaging.md`](./operations/ios-packaging.md) — **Native iOS / App Store / TestFlight** path (Capacitor). Separate from the web release; its 2026-05-16 legal audit is superseded — see `reference/srd-licensing-notes.md`.
- [`operations/pwa-notes.md`](./operations/pwa-notes.md) — Progressive Web App behavior notes: service worker, Workbox precache, install/update flows.
- [`operations/storage-and-backups.md`](./operations/storage-and-backups.md) — How localStorage is used, how backups are exported and imported, blob replacement rollback semantics.
- [`operations/security-privacy.md`](./operations/security-privacy.md) — Security and privacy posture: what data is stored where, debug-info safety, support-flow considerations.
- [`operations/troubleshooting.md`](./operations/troubleshooting.md) — Known failure modes and diagnostic approaches.

---

## Plans (active forward-looking work)

Planning docs for work that's queued or in progress. These get updated as plans evolve.

- [`plans/new-features-roadmap.md`](./plans/new-features-roadmap.md) — Forward-looking roadmap of features and improvements under consideration.
- [`plans/combat-workspace-plan.md`](./plans/combat-workspace-plan.md) — Combat Workspace plan and current slice status.

The builder plan has shipped and moved to [`archive/lore-ledger-builder-plan.md`](./archive/lore-ledger-builder-plan.md).

---

## Design (decision records and rationale)

Design records explain why a major schema or architecture direction was chosen. Canonical
rules still live in reference docs.

- 📜 **Historical** — [`design/vertical-slice-schema.md`](./design/vertical-slice-schema.md) — Rationale for the build-time choices schema and the vertical-slice-first SRD registry strategy. The vertical slice is complete and the registry is fully expanded; read this only for the *why*. Canonical rules live in `reference/content-registry-plan.md`.

---

## Features (per-feature design notes)

Design documents for shipped features. These survive shipping because they document decisions and tradeoffs that future changes need to respect.

- [`features/multi-character-design.md`](./features/multi-character-design.md) — **Canonical** current character-architecture rules (~55 lines). The Step 1–4 build notes moved to [`archive/multi-character-steps-1-4.md`](./archive/multi-character-steps-1-4.md).
- [`features/character-portability.md`](./features/character-portability.md) — Character portability design: how character data moves between campaigns and across backups.

---

## Reference (policy)

Ratified policies for content, attribution, and scope. These are authoritative — design decisions live here, not in personal notes.

- [`reference/attribution-requirements.md`](./reference/attribution-requirements.md) — Required attribution language for SRD-derived content, OGL/CC-BY surfaces.
- [`reference/srd-licensing-notes.md`](./reference/srd-licensing-notes.md) — Licensing context for SRD use: what's covered by which license, what attribution is required where.
- [`reference/content-registry-plan.md`](./reference/content-registry-plan.md) — Plan for the content registry: how SRD-derived content is structured, validated, and surfaced in the app. Includes the **Structured Attacks** model and the filtered spell-choice schema.
- [`reference/character-calculation-contract.md`](./reference/character-calculation-contract.md) — **Canonical.** How every calculated sheet value must behave for both builder and manually entered characters: the input / derived / adjustment / fixed-override contract, and attack-calculation ownership. Ratified 2026-07-14.
- [`reference/builder-scope-greenlist.md`](./reference/builder-scope-greenlist.md) — Greenlist of builtin content scope for the in-app builder: what ships, what's custom, decision rationale. **Start here before assuming any SRD content exists** — SRD 5.1 is much smaller than full 5E.
- [`reference/rest-rules-spec.md`](./reference/rest-rules-spec.md) — **Canonical rest behavior.** P0 rest correctness is complete: Short Rest Hit Dice spending; Long Rest HP, Hit Dice, slot, resource, and death-save recovery; prepared-spell changes at Long Rest; and active-character isolation.
- [`reference/level-up-flow-spec.md`](./reference/level-up-flow-spec.md) — Level-up flow spec. Its §10 decisions are ratified (down-leveling out of scope; appends exactly one level; prepared selection routes through Long Rest; do not rename the `used` slot field). **Phases 1–3 are implemented (2026-07-12/13); the B1–B3 audit batches also shipped 2026-07-13.**
- [`reference/restore-character-spec.md`](./reference/restore-character-spec.md) — **Normative, ratified 2026-07-18. Phase R1 (schema v13 + transactional pre-Level-Up snapshot capture) shipped 2026-07-18; R2–R6 still require owner authorization.** Pre-Level-Up character snapshots (campaign-scoped `characters.snapshots`, one-vault-write transaction with the Level Up commit) and the Restore Character flow that restores any snapshot as a separate playable copy. Defines the data model, identity/naming rules, backup behavior, dialog UX, and implementation phases R1–R6. No user-facing Restore UI exists yet.
- 📸 **Session snapshot** — [`reference/session-handoff-2026-07-19-r1-review.md`](./reference/session-handoff-2026-07-19-r1-review.md) — handoff for the 2026-07-19 post-R1 correctness review: PASS (no runtime change), findings for all seven review questions, the new forced persistence-failure lifecycle tests over the real save pipeline, the spec §4.3 key/limitation alignment, and the R2-readiness call.
- 📸 **Session snapshot** — [`reference/session-handoff-2026-07-18.md`](./reference/session-handoff-2026-07-18.md) — handoff for the 2026-07-18 run: the seven dev-only smoke harnesses reworked for production-preview compatibility (both smoke gates 61/61), the shared preview-safe helpers, and the character-page teardown-leak fix. Exact failures, root causes, verification, and the preview-safe harness rules pointer.
- 📸 **Session snapshot** — [`reference/session-handoff-2026-07-17.md`](./reference/session-handoff-2026-07-17.md) — handoff for the 2026-07-16/17 F2 run: Structured Vitals (live-deriving spell DC/attack, AC, max HP with adjustments, fixed overrides, legacy adoption), Defense fighting style, structured Dwarven Toughness, temporary combat AC, and the production-preview smoke gate. Exact commits, verification, and next steps.
- 📸 **Session snapshot** — [`reference/session-handoff-2026-07-15.md`](./reference/session-handoff-2026-07-15.md) — handoff for the 2026-07-15 run: unified character calculation contract, live-deriving structured attacks (Recalc dialog removed), and the reusable choice-based granted-spell mechanism with the High Elf wizard cantrip. Exact commits, verification, and next steps.
- 📸 **Session snapshot** — [`reference/session-handoff-2026-07-14.md`](./reference/session-handoff-2026-07-14.md) — handoff for the 2026-07-13/14 runs: matrix #15 custom-content authoring (+ campaign-vault content-persistence fix) and matrix #9 attack Recalculate from Build; exact commits, verification results, and the recommended next step.
- 📸 **Session snapshot (historical)** — [`reference/session-handoff-2026-07-13.md`](./reference/session-handoff-2026-07-13.md) — handoff for the 2026-07-13 builder-completion run (Level Up Phase 2, B1–B3, attribution gate).
- 📸 **Session snapshot, optional deep-dive** — [`reference/character-builder-handoff.md`](./reference/character-builder-handoff.md) — How the builder implementation fits together. Written at the end of one session (2026-07-07); good orientation, but verify its counts and hashes against the code. **Not required reading**, and its §7 "next fixes" is not the work order.

---

## Audits (planning artifacts — queued, not authorized)

⛔ [`audits/`](./audits/) holds gap audits and stabilization planning. Their **priority
order is real**; their **batch prompts are queued, not work orders**. Never self-start a
batch from an audit doc.

- [`audits/srd-5-1-character-builder-gap-audit-stabilization-docs.md`](./audits/srd-5-1-character-builder-gap-audit-stabilization-docs.md) — SRD 5.1 builder gap audit and stabilization plan. Its P0/P1 prerequisites have landed, but **batches B1/B2/B3 remain queued and are not authorized**. The binding sequence is [`AGENTS.md` → Current Working Order](../AGENTS.md#current-working-order).
- [`audits/builder-completion-matrix.md`](./audits/builder-completion-matrix.md) — **Current** capability matrix: what remains before a "complete SRD 5.1 builder with robust custom content" claim, with severity, dependencies, and the recommended (not authorized) next batch. Updated 2026-07-15 for live-deriving attacks and the choice-based granted-spell work.
- [`audits/character-calculation-audit-2026-07.md`](./audits/character-calculation-audit-2026-07.md) — The 2026-07-14 calculation-architecture audit: the builder/manual parity matrix (per value: model, parity, auto-update, adjustment, override, persistence, tests), findings F0–F4, and the choice-completeness report. Backs the calculation contract.
- [`audits/edit-in-builder-retirement-audit-2026-07.md`](./audits/edit-in-builder-retirement-audit-2026-07.md) — The 2026-07-18 Edit-in-Builder dependency audit backing the Restore Character spec: every entry point, mode flag, seeding/Finish/Level Up sharing, test, and doc classified (Remove / Keep / Replace / Owner-decision), the editable-field boundary, and owner decisions D1–D4 (**ruled 2026-07-18** — §3 records the rulings, including the R5 requirement to enable builder base-score editing on the existing Abilities & Skills editor).

---

## Archive (historical — do not treat as current)

📜 **Nothing in [`archive/`](./archive/) describes the current system.** These are superseded
plans, completed phase trackers, and point-in-time audits, kept for provenance. See
[`archive/README.md`](./archive/README.md) for the rules.

- [`archive/lore-ledger-builder-plan.md`](./archive/lore-ledger-builder-plan.md) — Phase-by-phase builder implementation tracker. The builder has shipped; every "deferred"/"future work" item is stale.
- [`archive/lore-ledger-multi-branch-review.md`](./archive/lore-ledger-multi-branch-review.md) — 2026-07-02 audit of the `main`/`develop`/`builder-wizard` divergence. That divergence has been resolved; all commit hashes are stale.
- [`archive/multi-character-steps-1-4.md`](./archive/multi-character-steps-1-4.md) — Step 1–4 build record for the multi-character system. Schema versions frozen at April 2026; its "SRD 5.1 green list" is wrong.
- [`archive/builder-phase-history.md`](./archive/builder-phase-history.md) — Phase-by-phase schema changelog lifted out of `state-schema.md`. Its v7/v8 numbers predate the v8–v11 renumbering.

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
