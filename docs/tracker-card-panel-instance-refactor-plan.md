# Tracker Card Panel Instance Refactor Note

This file is now an archival implementation note, not a pending plan. The living architecture source of truth is [`docs/architecture.md`](./architecture.md).

## Status

The tracker card panel lifecycle cleanup described here has landed for:

- `js/pages/tracker/trackerPage.js`
- `js/pages/tracker/panels/npcCards.js`
- `js/pages/tracker/panels/partyCards.js`
- `js/pages/tracker/panels/locationCards.js`

## What changed

- `initTrackerPage(...)` now destroys the previous tracker-page controller before re-initializing Tracker wiring.
- The tracker page registers child `destroy()` APIs instead of relying on singleton skip flags for the NPC, Party, and Location panels.
- NPC, Party, and Location panel modules now create instance-scoped controller closures. Their mutable runtime state is controller-local rather than hidden in module-singleton variables.
- Each of those panel controllers owns listeners through an `AbortController`, detaches masonry on teardown, and returns a real `destroy()` API.
- `locationCards.js` also cleans up its enhanced filter dropdown during destroy.

## Reviewer-facing implications

- Repeated tracker-page init is now protected by lifecycle cleanup rather than by "only initialize once" workarounds.
- Listener duplication after re-init is treated as a regression and is covered by `tests/smoke/trackerPanelLifecycle.smoke.js`.
- The remaining duplication in tracker card panels should not be read as leftover singleton debt. The current duplication is mostly panel-local rendering and state-shape work that is still intentionally explicit.

## Intentionally not done here

- No controller factory was introduced.
- No schema-driven tracker card renderer was introduced.
- The full rerender shell shared by NPC/Party/Location panels was not extracted. That remains deferred for a later pass.
- Card-body renderers, search/filter rules, section defaulting, and panel-specific mutation wiring remain local to each panel by design.

## Where to look now

- Current architecture and ownership: [`docs/architecture.md`](./architecture.md)
- Current verification story: [`docs/testing-guide.md`](./testing-guide.md)
- Current dedupe boundary and deferred work: [`docs/tracker-card-rendering-dedupe-assessment.md`](./tracker-card-rendering-dedupe-assessment.md)
