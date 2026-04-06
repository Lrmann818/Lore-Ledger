# Tracker Card Rendering Dedupe Assessment

This note reflects the current tracker card-panel code as it exists today. It is not a future-tense refactor proposal.

## Scope

- `js/pages/tracker/panels/npcCards.js`
- `js/pages/tracker/panels/partyCards.js`
- `js/pages/tracker/panels/locationCards.js`
- `js/pages/tracker/panels/cards/shared/`

## Landed shared extraction

The narrow shared extraction has already landed at:

- `js/pages/tracker/panels/cards/shared/cardIncrementalPatchShared.js`

That helper currently owns only incremental DOM patch behavior shared by NPC, Party, and Location panels:

- card lookup by `data-card-id`
- masonry relayout scheduling
- focus restoration helpers
- reorder FLIP patching
- collapsed-state patching
- portrait DOM patching

This boundary is intentionally narrow. The helper is DOM-only and callback-driven. It does not infer tracker state shape or own panel mutations.

## What remains panel-local by design

The following duplication is still intentional:

### 1. Card body rendering

Keep `renderNpcCard(...)`, `renderPartyCard(...)`, and `renderLocationCard(...)` separate.

- NPC and Party share some layout patterns but still encode different product concepts.
- Location cards differ materially in fields, copy, filter behavior, and select handling.
- The event wiring is dense enough that a generic renderer would hide behavior rather than simplify it.

### 2. Panel state shape and filtering

Keep local:

- visible-item selectors
- search keys and matching inputs
- active-section state keys
- collection keys passed to `updateTrackerCardField(...)`, `addTrackerCard(...)`, `removeTrackerCard(...)`, and `swapTrackerCards(...)`
- location-only type filtering and toolbar wiring

These are real data-shape and behavior differences, not cosmetic naming differences.

### 3. Bootstrap/defaulting/migration behavior

Keep local:

- panel bootstrap defaults
- section setup
- legacy migration/default handling
- add-item behavior
- section-delete reassignment logic

This work is still clearer and safer when explicit in each panel.

## Deferred work

### Full rerender shell extraction

The three panels still repeat a similar full rerender shell:

- preserve scroll
- optionally mask rerender while scrolled
- clear grid
- render empty state or append cards
- attach/relayout masonry
- restore scroll on double `requestAnimationFrame`

That extraction is deferred for now.

Reason:

- the shell sits close to panel-specific empty-state copy and optional post-render behavior such as number-stepper enhancement
- the higher-risk regression area was incremental patch drift, which is the part already extracted
- there is no current need to widen the abstraction boundary before another review

### Controller factory

Do not introduce a controller factory yet.

- The current controller shape is repetitive, but still readable.
- A factory would need to cross into panel-specific defaults, section wiring, and mutation semantics too quickly.

### Schema-driven card rendering

Do not introduce schema-driven rendering now.

- The remaining differences are larger than a field schema suggests.
- A descriptor layer would make simple panel edits harder to follow.

## Bottom line

Completed:

- shared incremental DOM patch extraction
- lifecycle cleanup that makes the card panels safe to destroy and re-initialize

Still intentionally local:

- card-body renderers
- panel state keys and filters
- toolbar/setup/defaulting logic
- section wiring and collection-specific mutations

Deferred:

- full rerender shell extraction
- controller factory work
- schema-driven tracker card rendering
