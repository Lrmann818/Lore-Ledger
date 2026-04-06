# Tracker Card Rendering Dedupe Assessment

## Scope

Requested scope maps to the current tracker panel files:

- `js/pages/tracker/panels/npcCards.js`
- `js/pages/tracker/panels/partyCards.js`
- `js/pages/tracker/panels/locationCards.js`
- existing shared helpers under `js/pages/tracker/panels/cards/shared/`

This is a design-only assessment. No production behavior changes are proposed in this pass.

## Recommendation

Recommend: extract a few shared primitives only.

Reasoning:

- The repo already has the right kind of low-level sharing for obvious UI pieces: section CRUD, search matching, search highlighting, portrait picking/rendering, header buttons, section-select footer, and select enhancement.
- The biggest remaining duplication is not field schema; it is the controller-side DOM patching and rerender shell repeated almost verbatim across all three panels.
- A schema-driven card renderer would be too much abstraction for the current differences, especially because the real variation lives in filtering, state keys, migration/defaulting, toolbar wiring, and field-specific event handling.

## Extract Now

These are structural duplicates and the safest future extraction targets:

### 1. Incremental card DOM patch helpers

All three panels repeat near-identical logic for:

- `find*CardElById(...)`
- `schedule*MasonryRelayout(...)`
- move-button focus restoration
- collapse-button focus restoration
- `patch*CardReorder(...)`
- `patch*CardCollapsed(...)`
- `patch*CardPortrait(...)`
- `focusElementWithoutScroll(...)`

Why this is worth extracting:

- The behavior is almost identical across NPC, Party, and Location.
- The code is mechanical, DOM-oriented, and easy to regression-test in isolation.
- It is also the most likely place for subtle drift bugs if one panel gets a future fix and the others do not.

Safe shape:

- Prefer a tiny helper such as `createCardDomPatcher(...)` or a small set of stateless helpers.
- Keep panel-specific callbacks injected rather than inferring state shape.
- Do not fold in card-body rendering or data updates.

### 2. Full-list rerender shell

All three panels also repeat the same render loop structure:

- preserve scroll
- mask rerender while scrolled
- start jump-debug run
- clear grid
- render empty state or append cards
- attach/relayout masonry
- restore scroll on double `requestAnimationFrame`

Why this is worth extracting only if touched:

- It is clearly duplicated, but it sits close to panel-specific empty-copy text and optional `enhanceNumberSteppers(...)`.
- This is a good second-step extraction after the incremental patch helpers, not the first step.

Safe shape:

- A helper like `renderCardListShell(...)` that accepts `getItems`, `renderCard`, `emptyText`, and optional `afterRender`.
- Keep per-panel `render*Card(...)` functions local.

## Leave Alone

This duplication is acceptable because the card types are meaningfully different:

### 1. Card body composition

Keep `renderNpcCard(...)`, `renderPartyCard(...)`, and `renderLocationCard(...)` separate.

- NPC and Party look similar today, but they encode different product concepts and will likely diverge again.
- Location cards already differ materially: title/type/notes, type select enhancement, location-specific placeholder copy, and different search-highlight selector behavior.
- The field wiring is event-heavy and behavior-rich; abstracting it now would hide intent and raise change risk.

### 2. Panel state keys and filtering rules

Keep local:

- visible-item selectors
- search keys
- active-section keys
- collection keys passed to `updateTrackerCardField(...)`, `addTrackerCard(...)`, `removeTrackerCard(...)`, and `swapTrackerCards(...)`
- location-only type filtering and toolbar setup

These are not just naming differences. They reflect real state-shape differences.

### 3. Init/defaulting/migration behavior

Keep local:

- panel bootstrap defaults
- per-panel section setup
- legacy migration/default handling
- add-item behavior
- section-delete reassignment logic

This code is domain-specific and safer when explicit.

## Maybe Later

These are plausible later steps, but not the safest next move:

### 1. Small controller factory

Only consider this after the incremental DOM patch helpers have been extracted and stable for a while.

- A factory for shared controller wiring could reduce repetition in `setSearch`, `setActiveSection`, add-item flow, and section CRUD hookup.
- It should stay shallow and callback-driven.
- It should not own per-card field rendering.

### 2. Schema-driven card rendering

Do not move here yet.

Possible trigger conditions later:

- a fourth tracker card type is added
- NPC and Party remain intentionally parallel across multiple releases
- the team wants shared field descriptors for rendering, search, validation, autosize, and persistence wiring together

Why not now:

- Current differences are larger than a field schema suggests.
- The risky parts are controller lifecycle and DOM patch behavior, not field declaration boilerplate.
- A schema layer would likely spread logic across descriptors, helper factories, and render adapters, making simple card edits harder.

## Suggested Extraction Order

1. Leave production behavior alone until there is an actual need to touch these files.
2. When a card-behavior bug or feature touches all three panels, extract only the incremental DOM patch helpers first.
3. If duplication still hurts after that, extract the rerender shell.
4. Re-evaluate a tiny controller factory only after those two steps settle.
5. Revisit schema-driven rendering only if the product surface grows enough to justify it.

## Bottom Line

The safest future dedupe strategy is not "keep everything as-is forever," but it is also not "build a generic card framework."

- Extract now: incremental DOM patch primitives, and maybe later the rerender shell.
- Leave alone: card-body rendering, state-shape wiring, filtering, migration/defaulting, and per-panel toolbars.
- Maybe later: a shallow controller factory.
- Not recommended now: schema-driven card rendering.
