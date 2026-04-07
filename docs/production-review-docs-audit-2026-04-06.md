# Production Review Docs Audit - 2026-04-06

This note records the final documentation consistency pass for review readiness. It reflects the repo state on 2026-04-06 after the tracker panel lifecycle cleanup, the narrow incremental DOM patch extraction, and the current smoke-doc updates were aligned across the key review-facing docs.

## Current status

The main review-facing docs now agree on the current implementation:

- `README.md`, `docs/architecture.md`, and the tracker engineering notes all describe tracker card panels as destroyable instance-scoped controllers rather than singleton-style panel runtimes.
- `README.md`, `docs/testing-guide.md`, `docs/browser-smoke-plan.md`, and `docs/release-process.md` all describe the same local-only 10-test Playwright smoke suite and the same CI boundary: `npm ci`, `npm run test:run`, and `npm run build`.
- The review-facing docs now describe Character lifecycle more narrowly: repeated Character-page init has dedicated smoke coverage, while broader Character-page depth still remains a manual-release concern.
- Tracker dedupe docs now describe the landed incremental DOM patch helper as a narrow DOM-only extraction, not as a broader controller/rendering framework.
- Remaining tracker duplication is described consistently as intentional panel-local rendering, filtering, defaulting, and mutation wiring rather than unfinished singleton cleanup.

## Contradictions resolved in this pass

- Removed status wording that still implied tracker architecture docs were behind the current destroyable-controller lifecycle model.
- Removed roadmap wording that still implied browser smoke coverage already ran in CI.
- Removed planning/to-do language that still treated the incremental DOM patch extraction and tracker lifecycle cleanup as unfinished work.
- Kept deferred tracker work framed as deliberate scope control, not forgotten debt or half-finished framework work.

## Intentional deferred items to keep calling out in the next review

These items remain deferred on purpose and should still be stated clearly in future review prep:

- Do not describe the tracker work as a full renderer/framework dedupe. The landed extraction is only `js/pages/tracker/panels/cards/shared/cardIncrementalPatchShared.js`.
- The shared full rerender shell across NPC, Party, and Location panels is still duplicated and still intentionally deferred.
- No controller factory has been introduced for tracker card panels.
- No schema-driven tracker card renderer has been introduced.
- Browser verification still has deliberate manual gaps: broader Character-page coverage beyond the repeated-init smoke, `Reset Everything` plus full restore runs, map drawing/touch behavior, PWA/offline/update-banner behavior, and broader cross-browser validation.
- Playwright smoke coverage remains local-only today; CI still does not provision Chromium or run `npm run test:smoke`.

## Durable source-of-truth docs

Use these files for the current review:

- Architecture and tracker ownership: [`docs/architecture.md`](./architecture.md)
- Testing and verification scope: [`docs/testing-guide.md`](./testing-guide.md)
- Release/readiness flow: [`docs/release-process.md`](./release-process.md)
- Tracker lifecycle cleanup status: [`docs/tracker-card-panel-instance-refactor-plan.md`](./tracker-card-panel-instance-refactor-plan.md)
- Tracker dedupe boundary and deferred work: [`docs/tracker-card-rendering-dedupe-assessment.md`](./tracker-card-rendering-dedupe-assessment.md)
