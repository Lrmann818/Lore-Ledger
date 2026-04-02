# Lore Ledger v0.5.0 Hardening Plan

## Goal

Finish the app’s quality-hardening phase so Lore Ledger can honestly be presented as a stable, production-minded flagship project: architecturally clean, boringly reliable, well-tested, and ready for future feature work.

This phase is about confidence, not shiny additions.

---

## Definition of “hardening complete”

Lore Ledger v0.5.0 should be considered hardened when all of the following are true:

- Remaining `@ts-nocheck` files are removed or reduced to truly justified exceptions.
- Critical save/load/import/migration paths have automated coverage.
- CI blocks bad builds from shipping.
- A small browser smoke suite protects the golden paths.
- Manual stress testing has been performed against large, realistic campaign data.
- Packaging and release hygiene are clean and repeatable.
- Documentation matches the real architecture and release process.

---

## Current assessment

### What is already in good shape

- Production build works.
- Migration tests exist and pass.
- Import/export is much safer than before.
- Save failure UX exists.
- Global error handling is better.
- Docs are much more serious and maintainable.
- PWA/deploy/versioning/release foundations are already in place.

### What still needs to be finished

1. Remaining `@ts-nocheck` cleanup.
2. Broader automated test coverage beyond migrations.
3. CI quality gates that run tests before deploy.
4. Minimal browser-level regression automation.
5. Formal stress validation with realistic large data.
6. Clean packaging and artifact hygiene.

---

## Work phases

# Phase 1 — Final codebase discipline

## Objective

Finish the last structural cleanup work so the codebase is consistently typed, less fragile, and easier to maintain.

## Tasks

### 1. Remove remaining `@ts-nocheck`

Target the remaining files and replace `@ts-nocheck` with `// @ts-check` plus real JSDoc typing, narrow typedefs, and boundary validation.

Likely target files:

- `js/domain/factories.js`
- `js/pages/character/characterSectionReorder.js`
- `js/pages/tracker/trackerSectionReorder.js`
- `js/features/numberSteppers.js`
- `js/utils/dev.js`
- `js/ui/panelHeaderCollapse.js`
- `js/ui/pagePanelReorder.js`

### 2. Remove any remaining “LooseObject theater”

Replace overly broad record-any patterns with actual typedefs for:

- state slices
- reorder payloads
- DOM refs
- injected dependencies
- persisted payload shapes

### 3. Tighten module boundaries

As each file is cleaned up:

- document input/output contracts
- validate required DOM refs early
- keep side effects at edges
- avoid hidden mutation paths

## Acceptance criteria

- No remaining casual `@ts-nocheck` files in app code.
- No broad `Record<string, any>` placeholders in critical flows.
- `npm run build` still passes.
- `npx tsc --noEmit` or equivalent checkJs validation produces no newly introduced type regressions.

---

# Phase 2 — Critical-path automated testing

## Objective

Protect the highest-risk data-integrity flows with real automated tests.

## Priority areas

### 1. Persistence tests

Add tests for:

- `loadAll` applying migrated state safely
- deep-clone assignment behavior
- missing/partial storage fallback handling
- corrupt storage payload rejection behavior

### 2. Backup tests

Add tests for:

- export shape validity
- import validation failures
- atomic rollback when import fails after partial work
- blob/text remap behavior
- save failure after state swap restoring prior snapshot

### 3. Save manager tests

Add tests for:

- dirty → saving → saved lifecycle
- save failure banner behavior
- retry behavior after prior failure
- debounce/queue behavior
- flush behavior under repeated edits

### 4. Migration coverage expansion

Keep the migration suite as the highest-trust area in the codebase.
Expand coverage until every supported legacy path and malformed edge case has explicit expectations.

## Acceptance criteria

- Test suite covers migrations, persistence, backup import/export, and save manager logic.
- Failures in critical save/import paths are caught by tests.
- `npm run test:run` passes cleanly.

---

# Phase 3 — CI quality gates

## Objective

Prevent broken builds from being shipped or deployed.

## Tasks

### 1. Update GitHub Actions workflow(s)

Before deploy, require:

- `npm ci`
- `npm run test:run`
- `npm run build`

### 2. Fail fast on missing or broken quality signals

Ensure workflows stop on:

- test failures
- build failures
- packaging verification failures

### 3. Keep deploy separate from verification logic when useful

If needed, split into:

- CI verification workflow
- deploy workflow

But deployment should never bypass verification.

## Acceptance criteria

- A failing test blocks deploy.
- A failing build blocks deploy.
- CI logs clearly show verification steps.

---

# Phase 4 — Browser smoke automation

## Objective

Add a very small, high-value browser suite to catch obvious regressions in real UI flows.

## Recommended scope

Keep this intentionally small.
Only automate golden paths that protect confidence.

### Suggested smoke scenarios

1. App loads without fatal init errors.
2. Core tracker page renders.
3. Character page renders.
4. Create or edit representative content and verify it persists after reload.
5. Export backup works.
6. Import a valid backup works.
7. Invalid import shows user-visible failure.

### Notes

- Prefer Playwright.
- Keep tests deterministic and narrow.
- Do not try to automate every visual nuance.
- Focus on “would this catch a broken release?”

## Acceptance criteria

- A small smoke suite runs locally and in CI.
- Smoke tests cover at least one save/reload flow and one backup flow.

---

# Phase 5 — Manual stress and resilience pass

## Objective

Prove the app behaves well with realistic “large campaign” usage.

## Stress scenarios

### 1. Large content stress

Test with:

- many NPC cards
- many party members
- many locations
- long notes
- multiple maps
- many images

### 2. Session resilience

Verify:

- repeated edits over time
- reload persistence
- install/open behavior
- import/export round-trip on large data

### 3. Storage pressure behavior

Verify:

- save failure banner appears when local save fails
- export path is still understandable
- no silent corruption occurs

### 4. Performance observation

Check for:

- obvious jank during common actions
- expensive re-render hotspots
- scroll jumps or layout instability in key panels

## Deliverable

Record results in a dated verification entry with:

- environment
- scenario details
- pass/fail notes
- any regressions found
- screenshots if useful

## Acceptance criteria

- One formal large-campaign manual pass is documented.
- Any discovered regressions are either fixed or logged for the next milestone.

---

# Phase 6 — Release hygiene and packaging discipline

## Objective

Make release artifacts clean, repeatable, and trustworthy.

## Tasks

### 1. Clean packaging rules

Ensure release artifacts exclude:

- `.git`
- `node_modules`
- local editor config
- temporary test files
- stale build output not meant for release bundles

### 2. Verify packaging scripts

Run and validate the existing packaging and verification scripts as part of release prep.

### 3. Version/release consistency

Confirm the displayed app version/build metadata matches the intended release source of truth.

### 4. Release checklist review

Before cutting v0.5.0:

- tests passing
- build passing
- smoke pass passing
- manual stress pass completed
- docs updated
- release artifact verified

## Acceptance criteria

- Release bundle contains only what is intended.
- Release checklist is fully executable by future-you without guesswork.

---

# Phase 7 — Documentation lock-in

## Objective

Make the docs reflect the actual app, not a past version of the app.

## Docs that should be current before v0.5.0

- `README.md`
- architecture doc
- storage/backups doc
- testing doc
- release/deployment doc
- troubleshooting doc
- schema/migrations doc
- verification checklist/history

## Specific doc updates to verify

### README

Should clearly state:

- what Lore Ledger is
- current architecture at a high level
- how to run/build/test
- what “production-minded” means in this project

### Testing docs

Should describe:

- unit coverage areas
- smoke coverage areas
- how to run all checks
- what is still intentionally manual

### Release docs

Should describe:

- versioning rules
- build and packaging steps
- verification expectations
- deployment flow

## Acceptance criteria

- A new contributor or future-you could reliably build, verify, and release the app from docs alone.

---

## Recommended execution order

1. Final `@ts-nocheck` cleanup.
2. Add persistence/backup/save-manager tests.
3. Gate CI on tests + build.
4. Add tiny Playwright smoke suite.
5. Run and document large-campaign stress pass.
6. Final packaging/release hygiene pass.
7. Documentation sync and v0.5.0 release prep.

---

## What should wait until after this milestone

These are good future features, but they should come after the hardening pass unless they directly support stability:

- major new workflow features
- broad UI redesigns
- speculative convenience features
- scope-expanding systems not tied to reliability or integrity

The point of v0.5.0 is to make the existing app trustworthy.

---

## Suggested milestone framing

**v0.5.0 = Quality Release**

Theme:

- confidence
- integrity
- automation
- repeatability
- maintainability

Possible release note summary:

> Lore Ledger v0.5.0 focuses on hardening the app as a production-minded offline PWA: stronger data safety, broader automated testing, better CI protection, cleaner typing discipline, and verified release quality.

---

## Final standard

At the end of this milestone, Lore Ledger should feel like:

- not a toy
- not a fragile prototype
- not a “mostly works on my machine” app

It should feel like a real, shipped application built with discipline.
