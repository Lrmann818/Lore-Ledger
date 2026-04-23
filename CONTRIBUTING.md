# Contributing to Lore Ledger

This project is a local-first, browser-only D&D campaign companion built with vanilla HTML, CSS, and JavaScript. It is designed to run entirely in the browser, work offline after install, and preserve user data across refreshes, backups, and version upgrades.

This guide is for contributors and maintainers working in this repository. It complements, but does not replace, [AI_RULES.md](AI_RULES.md), which is the stricter AI-agent editing policy.

## 1. Project goals and guardrails

The project currently optimizes for reliability, maintainability, and backward compatibility over rapid surface-area growth.

Core goals:

- Keep the app local-first. There is no backend, shared account system, or server-side database.
- Preserve offline-capable PWA behavior and GitHub Pages deployment.
- Keep the codebase modular without introducing framework-style indirection.
- Make state changes explicit and save-aware.
- Preserve saved data, backups, blob references, and migration behavior across releases.

Guardrails:

- Prefer small, targeted changes over broad cleanup passes.
- Keep `app.js` as the single composition root.
- Keep page ownership clear: Tracker, Character, and Map logic belong in their own page folders unless a behavior is truly shared.
- Preserve CSP-friendly patterns. Do not add inline handlers, `eval`-style behavior, or new UI systems that bypass existing dialog/popover patterns.
- Avoid new architectural dependencies without an explicit project-level decision. This repo is intentionally vanilla JS plus Vite.
- Treat persistence, navigation, panel state, dropdown behavior, and mobile layout as high-risk areas.

If a proposed change makes the architecture less obvious, weakens compatibility, or adds a second way to do an existing job, it is probably the wrong change for this codebase.

## 2. Local setup

The CI and Pages workflow build with Node `20`. Use the same major version locally when possible.

Initial setup:

```bash
npm ci
```

Day-to-day development:

```bash
npm run dev
```

Recommended dev URL for refactor or state-safety work:

```text
/?dev=1&stateGuard=warn
```

Useful local commands:

```bash
npm run verify
npm run build
npm run preview
npm run test:smoke
```

Working expectations:

- Serve the app through Vite or another local server. Do not test from `file://`.
- Use `npm run verify` before merge for any app change. Run `npm ci` first when you want the closest local match to CI.
- Use `npm run test:smoke` for the small local Chromium browser suite when you change browser-level boot, reload persistence, or backup/import behavior. If Playwright Chromium is missing locally, install it once with `npx playwright install chromium`.
- Use `npm run preview` or a deployed build for PWA and offline validation. Dev mode does not register the production service worker.
- For persistence-sensitive work, prefer a clean browser profile and seed realistic data before testing.

Primary maintainer references:

- [README.md](README.md)
- [docs/architecture.md](docs/architecture.md)
- [docs/state-schema.md](docs/state-schema.md)
- [docs/storage-and-backups.md](docs/storage-and-backups.md)
- [docs/testing-guide.md](docs/testing-guide.md)
- [docs/release-process.md](docs/release-process.md)
- [AI_RULES.md](AI_RULES.md)

## 3. Branch and commit expectations

`main` is the deploy branch. Pushes to `main` trigger the GitHub Pages workflow, and `Deploy` only runs after `Verify and build` passes, so treat `main` as releaseable at all times.

Branch expectations:

- Create short-lived topic branches from `main`.
- Keep each branch scoped to one feature, fix, refactor, or documentation change.
- Prefer descriptive names such as `fix/map-persistence`, `refactor/tracker-card-rendering`, or `docs/testing-guide`.
- Avoid mixing storage/schema changes with unrelated UI cleanup in the same branch.

Commit expectations:

- Prefer small, reviewable commits with a clear intent.
- Use imperative commit messages, for example `fix map background persistence` or `docs update architecture for spell notes`.
- Keep mechanical renames or formatting-only changes separate from behavior changes when practical.
- If a commit changes persistence, startup order, or module boundaries, include the matching docs update in the same commit or branch.

Merge expectations:

- Do not merge known-console-error, known-data-loss, or known-mobile-regression changes.
- If the change is risky, include a short note in the PR or merge summary describing what was tested and what remains unverified.

## 4. Module placement rules

Follow the current architecture before creating new files or moving logic.

Top-level ownership:

- `app.js`: composition root and startup ordering
- `boot.js`: early theme/version bootstrapping only
- `js/state.js`: default state, schema versioning, migration, normalization, save sanitization
- `js/domain/*`: factories and explicit state action helpers
- `js/storage/*`: browser persistence, save lifecycle, backups, IndexedDB helpers
- `js/ui/*`: shared page-agnostic UI systems
- `js/features/*`: reusable higher-level flows that are still not page-specific
- `js/pages/*`: page-specific orchestration and page-local panels/controllers
- `js/pwa/*`: service worker registration and update handling
- `js/utils/*`: low-level helpers with minimal app knowledge

Placement rules:

- Put page-specific behavior in the owning page folder, not in `js/ui`.
- Put truly shared UI infrastructure in `js/ui`, not in a page folder.
- Put persistence concerns in `js/storage`, not in page modules.
- Put business/state mutation helpers in `js/domain` when more than one module needs them.
- Prefer dependency injection through `deps` objects over adding new cross-layer imports.
- Do not make `js/pages/*` a dependency for shared layers.
- Do not use `js/pages/tracker/panels/cards/shared/*` as a generic shared folder; it is only for tracker card panels that genuinely share behavior.

When in doubt, match the closest existing pattern instead of inventing a new structure.

## 5. Type safety and boundary-hardening rules

This repo is still plain JavaScript. The current type-safety approach is incremental boundary hardening, not a TypeScript rewrite.

Current model:

- `tsconfig.checkjs.json` enables `allowJs` + `checkJs` across `app.js`, `boot.js`, `vite.config.js`, `js/**/*.js`, and `types/**/*.d.ts`.
- Hardened modules opt into file-level `// @ts-check` and use JSDoc typedefs/imports to describe inputs, outputs, and `deps` contracts.
- Ambient declarations for globals, virtual modules, and Node-side config helpers live in `types/*.d.ts`.

Current `@ts-check` coverage is concentrated in:

- `app.js`
- `js/state.js`
- all current `js/domain/*` and `js/storage/*`
- tracker and map orchestration modules
- shared UI boundary modules such as `dataPanel`, `navigation`, `pagePanelReorder`, `panelHeaderCollapse`, `popovers`, `positioning`, `saveBanner`, `settingsPanel`, `status`, `theme`, and `topbar`
- focused utility/feature modules such as `autosize`, `numberSteppers`, `updates`, `updateBanner`, and `utils/dev`

Rules:

- For new shared infrastructure, state/domain helpers, persistence code, and page-orchestration modules, start with `// @ts-check`.
- Prefer reusing owner-defined typedefs from `js/state.js`, `js/domain/*`, or the nearest boundary module instead of re-declaring wide anonymous objects.
- Keep `deps` objects narrow and explicit. Use `import(...)`, `ReturnType<>`, and `Parameters<>` when they describe the real contract.
- Keep ambient/global types in `types/*.d.ts`; do not scatter duplicate global declarations through app modules.
- Keep runtime validation at persistence, import/export, DOM, and file boundaries. Static typing helps document contracts but does not replace guards or migration logic.
- Do not describe the whole repo as fully CheckJS-clean. The broader pass still has known issues in older Character-panel and Tracker card/panel code.

## 6. Persistence and backward-compatibility rules

This is a compatibility-first project. Changes to saved state must be designed to preserve old user data.

Current persistence model:

- Structured state is stored in `localStorage["localCampaignTracker_v1"]`.
- The active top-level tab is also mirrored in `localStorage["localCampaignTracker_activeTab"]`.
- Binary assets and drawing snapshots live in IndexedDB `blobs`.
- Long-form spell notes live in IndexedDB `texts`.
- Backups bundle sanitized structured state plus referenced blobs and stored texts.

Rules for persisted changes:

- Do not change storage keys, backup shape, or saved field names casually.
- Do not remove or rename persisted fields without a migration path.
- Add defaults in `js/state.js` first.
- Extend `SCHEMA_MIGRATION_HISTORY` and `migrateState(...)` when older saves need reshaping or backfill.
- Update `sanitizeForSave(...)` when a field should remain runtime-only.
- Preserve unknown future schema versions instead of downgrading them destructively.
- Keep the live exported `state` object stable; load/import should merge into existing objects, not replace them wholesale.
- Use nullish fallback patterns such as `existingValue ?? defaultValue` when reading old data.

Rules for save behavior:

- Any user-visible structured-state change should participate in the save lifecycle.
- Call `SaveManager.markDirty()` for mutations unless the flow intentionally uses `queueSave: false` and has an equivalent save path.
- Remember that blob writes and text writes are only half the job; the structured state must also persist the associated IDs.
- Do not assume that every field on `state` is persisted. `sanitizeForSave(...)` is the source of truth.

Rules for compatibility-sensitive surfaces:

- Existing saved data must continue to load without manual repair.
- Backup export, reset, and import must remain usable across releases.
- Map background images, drawing snapshots, portraits, and spell notes are not optional edge cases. They are part of the normal compatibility contract.
- Intentional non-persistence, such as map undo/redo history or dice/calculator history, should stay intentional and documented.

If a change alters storage behavior, schema behavior, import/export behavior, or migration behavior, update the storage/schema docs in the same change.

## 7. Documentation update expectations

Documentation should change alongside the code when contributor understanding or release safety depends on it.

Update these files when their source-of-truth area changes:

- `README.md`: project overview, setup, feature summary, or high-level architecture direction
- `docs/architecture.md`: startup order, module boundaries, ownership, dependency direction, or page wiring
- `docs/state-schema.md`: persisted field shape, schema versioning, or migration expectations
- `docs/storage-and-backups.md`: persistence layers, save lifecycle, backup/import/export behavior, blob/text storage
- `docs/testing-guide.md`: pre-merge or pre-release validation expectations
- `docs/release-process.md`: versioning, tagging, deploy flow, release evidence, packaging workflow
- typing and boundary-hardening docs: update `README.md`, `docs/architecture.md`, `docs/testing-guide.md`, `CONTRIBUTING.md`, and `AI_RULES.md` when the current `@ts-check` surface or contributor guardrails change
- `AI_RULES.md`: only when the AI-agent editing contract itself changes

Documentation rules:

- Update docs in the same branch as the code change.
- Do not leave architectural or persistence changes documented only in commit messages.
- If behavior changed intentionally, say what changed and what stayed compatible.
- If behavior stayed the same but module ownership moved, update the ownership docs anyway.

## 8. Testing expectations before merge

This repository now has targeted automated tests in `package.json` and an in-progress CheckJS static-validation path. Pre-merge validation is still mostly manual and should be proportionate to risk.

Minimum expectation for any app change:

1. Run `npm run verify`.
2. Test the changed area in a local served environment.
3. Reload and confirm the affected flow still behaves correctly after refresh.
4. Check for unexpected console errors.

Additional required checks by change type:

- `@ts-check`, JSDoc, `types/*.d.ts`, or boundary-contract changes:
  Run the current CheckJS command from [docs/testing-guide.md](docs/testing-guide.md) when practical, and avoid introducing new typing regressions in the touched area.
- Persistence, schema, storage, image, or save-timing changes:
  Run the persistence and backup flows in [docs/testing-guide.md](docs/testing-guide.md).
- Tracker changes:
  Test Tracker add/edit/delete, relevant panel behavior, and reload persistence.
- Character changes:
  Test the affected panel plus any derived calculations or spell-note persistence it touches.
- Map, drawing, gesture, or image changes:
  Test map background persistence, drawing persistence, and undo/redo expectations.
- PWA, asset-loading, routing-base, or startup changes:
  Test a production build with `npm run preview`.
- CSP, boot, or theme changes:
  Run the relevant checks from [docs/testing-guide.md](docs/testing-guide.md) and confirm saved theme application still works.

Release-sensitive changes should be validated in a clean browser profile with realistic seeded data. Any data-loss, restore, offline-shell, or CSP regression should block merge.

## 9. Guidance for AI-assisted edits

AI assistance is allowed, but human reviewers remain responsible for correctness, compatibility, and maintainability.

Expectations:

- Read [AI_RULES.md](AI_RULES.md) before using an AI tool on app code.
- Give the AI the relevant local context, especially `docs/architecture.md`, persistence docs, and the module it is editing.
- Ask for small, bounded changes rather than whole-app rewrites.
- Review every generated diff before merge.
- Re-run the same manual validation you would require for a human-written change.
- Keep AI-generated refactors smaller than you think you need; this repo is especially sensitive to indirect regressions.

When submitting AI-assisted work, include:

- what the tool changed
- what you manually reviewed
- what you tested
- any assumptions, uncertainty, or skipped validation

AI should accelerate repetitive work and documentation, not replace architectural judgment.

## 10. Safe vs risky refactors

Safe refactors are usually local, behavior-preserving, and easy to verify:

- extracting a small helper within the same ownership boundary
- renaming private locals for clarity
- tightening null guards or defensive checks
- replacing duplicate page-local code with an existing shared pattern
- improving docs to match the code
- adding narrowly scoped CSS modifiers instead of broad global styling

Risky refactors need extra caution, smaller diffs, and stronger testing:

- changing startup order in `app.js` or `boot.js`
- moving logic across architecture layers
- changing saved state shape, schema versioning, storage keys, or backup format
- touching `sanitizeForSave(...)`, `migrateState(...)`, import/export, or reset behavior
- altering DOM IDs, data attributes, or ARIA/state contracts used by the current UI wiring
- changing tab navigation, panel collapse, panel reordering, dropdown/popover behavior, or the shared status system
- broad CSS rewrites, global element styling, or layout changes that can affect mobile rendering
- changing map controller, drawing, gesture, canvas, or image persistence code
- changing PWA registration, GitHub Pages base path, manifest paths, or service worker behavior

For risky refactors:

- split the work into smaller passes when possible
- document the intended invariants before or during the change
- update the relevant maintainer docs in the same branch
- test the real user flows, not just the code path you touched

## 11. Contributor checklist

Before merging, confirm all of the following are true:

- The change matches the current architecture instead of bypassing it.
- Persisted data and compatibility expectations were preserved or migrated.
- Relevant docs were updated in the same branch.
- `npm run verify` succeeded.
- The changed area was manually tested, including refresh behavior where relevant.
- Any risky refactor was called out explicitly for reviewers.
- Any AI assistance was reviewed and validated by a human.
