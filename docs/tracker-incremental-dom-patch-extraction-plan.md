# Tracker Incremental DOM Patch Extraction Note

This file is now an archival implementation note. The extraction it described has landed.

## Landed result

The shared helper now exists at:

- `js/pages/tracker/panels/cards/shared/cardIncrementalPatchShared.js`

It owns the narrow DOM-only behavior shared by NPC, Party, and Location panels:

- card lookup by `data-card-id`
- masonry relayout scheduling
- focus restoration helpers
- reorder FLIP patching
- collapsed-state patching
- portrait DOM patching

## Boundary that was kept

The helper stays intentionally narrow. It does not own:

- panel state reads beyond injected callbacks
- `updateNpc(...)`, `updateParty(...)`, or `updateLoc(...)`
- portrait-hidden mutation helpers
- filtering or visible-list computation
- jump-debug setup
- card-body rendering
- full rerender shell behavior

## What still stays local

Each tracker panel still owns:

- visible-item selectors
- section/search/filter wiring
- collection keys and mutation semantics
- add/delete/reassign flows
- card-body rendering and field event wiring

## Deferred follow-up

The full rerender shell is still duplicated across the three panels and remains deferred on purpose. That extraction would cross a wider boundary than the incremental DOM patch helper and is not part of the current review-readiness scope.

For the durable current guidance, use:

- [`docs/architecture.md`](./architecture.md)
- [`docs/tracker-card-rendering-dedupe-assessment.md`](./tracker-card-rendering-dedupe-assessment.md)
