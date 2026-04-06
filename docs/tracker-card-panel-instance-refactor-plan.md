# Tracker Card Panel Instance Refactor Plan

## Scope

- `js/pages/tracker/panels/npcCards.js`
- `js/pages/tracker/panels/partyCards.js`
- `js/pages/tracker/panels/locationCards.js`
- `js/pages/tracker/trackerPage.js`

This plan reflects the code as it exists today and is intentionally limited to converting the three tracker card panels from module-singleton wiring to per-instance controllers. No behavior changes, no shared-helper rewrites, and no dedupe work are planned in these passes.

## Current Composition Snapshot

- `trackerPage.js` imports `initNpcsPanel`, `initPartyPanel`, and `initLocationsPanel`.
- `trackerPage.js` also maintains `_singletonTrackerPanelInits`, which prevents a panel from re-initializing once it has been started without returning a `destroy()` API.
- None of the three card panel modules currently provide full teardown. They bind DOM listeners directly, attach masonry, and retain module-level mutable state.
- `partyCards.js` and `locationCards.js` additionally export render functions that only work after hidden module state has already been initialized.

## Current Mutable Singleton State

### `js/pages/tracker/panels/npcCards.js`

Current module-level mutable state:

- `_cardsEl`
- `_Popovers`
- `_state`
- `_blobIdToObjectUrl`
- `_autoSizeInput`
- `_matchesSearch`
- `_enhanceNumberSteppers`
- `_pickNpcImage`
- `_updateNpc`
- `_setNpcPortraitHidden`
- `_moveNpcCard`
- `_moveNpc`
- `_deleteNpc`
- `_numberOrNull`

What should become per-instance closure state:

- All of the mutable values above except `_moveNpc`.
- `_moveNpc` is dead state today: it is never assigned or read and should not be carried into the new controller.

### `js/pages/tracker/panels/partyCards.js`

Current module-level mutable state:

- `_cardsEl`
- `_state`
- `_blobIdToObjectUrl`
- `_autoSizeInput`
- `_Popovers`
- `_matchesSearch`
- `_enhanceNumberSteppers`
- `_pickPartyImage`
- `_updateParty`
- `_setPartyPortraitHidden`
- `_movePartyCard`
- `_deleteParty`
- `_numberOrNull`
- `_renderPartyTabs`

What should become per-instance closure state:

- All of the mutable values above.

### `js/pages/tracker/panels/locationCards.js`

Current module-level mutable state:

- `_cardsEl`
- `_state`
- `_blobIdToObjectUrl`
- `_Popovers`
- `_pickLocImage`
- `_updateLoc`
- `_setLocPortraitHidden`
- `_moveLocCard`
- `_deleteLoc`

What should become per-instance closure state:

- All of the mutable values above.
- `initLocationsToolbar()` currently reaches `_state` indirectly; that state should move to a controller-local context object in the same pass as the location panel conversion.

## Current Public API vs Proposed Instance API

### `js/pages/tracker/panels/npcCards.js`

Current public API:

- `initNpcsPanel(deps)`

Current behavior notes:

- `initNpcsPanel()` does all setup and returns no controller.
- Rendering is driven by internal functions that depend on module globals populated by `initNpcCards()`.

Proposed instance-scoped API:

```js
export function createNpcCardsPanel(deps) {
  return {
    render,
    renderTabs,
    setActiveSection,
    destroy,
  };
}

// Temporary migration alias for call-site stability during the passes.
export function initNpcsPanel(deps) {
  return createNpcCardsPanel(deps);
}
```

Private-to-controller only:

- `updateNpc`
- `setNpcPortraitHidden`
- `moveNpcCard`
- `pickNpcImage`
- `deleteNpc`
- `renderNpcCard`
- `patchNpcCardCollapsed`
- `patchNpcCardPortrait`
- `patchNpcCardReorder`

### `js/pages/tracker/panels/partyCards.js`

Current public API:

- `renderPartyCards()`
- `initPartyPanel(deps)`
- `initPartyPanel()` currently returns `{ updateParty, pickPartyImage, deleteParty, renderPartyTabs }`

Current behavior notes:

- `renderPartyCards()` is exported but only works after prior hidden singleton initialization.
- The returned helper object is not used by `trackerPage.js`.

Proposed instance-scoped API:

```js
export function createPartyCardsPanel(deps) {
  return {
    render,
    renderTabs,
    setActiveSection,
    destroy,
  };
}

export function initPartyPanel(deps) {
  return createPartyCardsPanel(deps);
}
```

Private-to-controller only:

- `updateParty`
- `setPartyPortraitHidden`
- `movePartyCard`
- `pickPartyImage`
- `deleteParty`
- `renderPartyCard`
- `patchPartyCardCollapsed`
- `patchPartyCardPortrait`
- `patchPartyCardReorder`

### `js/pages/tracker/panels/locationCards.js`

Current public API:

- `renderLocationCards()`
- `renderLocationCard(loc)`
- `initLocationsPanel(deps)`
- `initLocationsPanel()` currently returns `{ updateLoc, pickLocImage, deleteLoc }`

Current behavior notes:

- `renderLocationCards()` and `renderLocationCard()` are exported but are not safe as standalone functions because they depend on module globals.
- Toolbar wiring (`initLocationsToolbar`) shares the same hidden module state as card rendering.

Proposed instance-scoped API:

```js
export function createLocationCardsPanel(deps) {
  return {
    render,
    renderTabs,
    setActiveSection,
    destroy,
  };
}

export function initLocationsPanel(deps) {
  return createLocationCardsPanel(deps);
}
```

Private-to-controller only:

- `updateLoc`
- `setLocPortraitHidden`
- `moveLocCard`
- `pickLocImage`
- `deleteLoc`
- `renderLocationCard`
- `patchLocationCardCollapsed`
- `patchLocationCardPortrait`
- `patchLocationCardReorder`
- `initLocationsToolbar`

## Dependencies Reaching Through Globals or Implicit Module State

### Hidden module-state dependencies

- All three panel modules currently route core work through hidden singleton fields rather than explicit parameters or a controller-local context.
- In `npcCards.js`, search behavior is split between the injected `_matchesSearch` and the module constant `matchesSearch`.
- In `partyCards.js`, `renderPartyCards()` uses `_matchesSearch`, while tab rendering and reorder logic use the module constant `matchesSearch`.
- In `locationCards.js`, `initLocationsToolbar()` captures `_state` rather than receiving state through its own arguments.
- `partyCards.js` stores `_renderPartyTabs` as mutable module state so card footer dropdowns can force a tab rerender.

### Browser globals currently used directly

- `document`
  - `requireMany(..., { root: document })`
  - `document.createElement(...)`
  - `document.activeElement`
- `window`
  - `window.matchMedia(...)`
  - NPC collapse fallback also uses `window.scrollX`, `window.scrollY`, and `window.scrollTo(...)`
- global timers / frame APIs
  - `requestAnimationFrame(...)`
  - `setTimeout(...)`

These browser globals can remain browser globals. The refactor target is to remove implicit panel/service state, not to abstract the DOM platform.

### Lifecycle dependencies that must be made explicit

- `masonry.attach(cardsEl, ...)` is called in each init path today, but none of the three panels call `masonry.detach(cardsEl)` on teardown.
- Search, add, filter, and section CRUD listeners are attached directly and never removed.
- `trackerPage.js` relies on a singleton-init workaround because the panels do not currently own a real lifecycle.

## Expected Init and Teardown API

Each converted panel should behave like a destroyable controller instance:

```js
const panel = createNpcCardsPanel({
  state,
  SaveManager,
  Popovers,
  uiPrompt,
  uiAlert,
  uiConfirm,
  setStatus,
  // existing panel-specific deps...
});

panel.render();
// later
panel.destroy();
```

Expected controller responsibilities:

- Resolve required DOM once during controller creation.
- Keep mutable panel state in one closure-local `ctx` object.
- Bind all DOM listeners through one `AbortController` or one tracked `destroyFns` list.
- Attach masonry during init and call `masonry.detach(cardsEl)` in `destroy()`.
- Keep render helpers, patch helpers, and action helpers private to the controller.
- Return a real `destroy()` API even if the rest of the returned surface stays minimal.

Expected `destroy()` behavior:

- Abort/remove panel-owned DOM listeners.
- Detach masonry from the panel card container.
- Drop references from the controller closure where practical.
- Leave shared app services alone; do not destroy `SaveManager`, shared `Popovers`, or shared dialogs.

## Safest Refactor Order

### Pass 1: `npcCards.js` first

Files:

- `js/pages/tracker/panels/npcCards.js`
- `js/pages/tracker/trackerPage.js`

Plan:

- Introduce a controller-local context in `npcCards.js`; move all mutable singleton state into that closure.
- Keep the export name `initNpcsPanel` for the pass, but make it return a destroyable controller.
- Convert search/add/section listeners to teardown-aware wiring.
- Detach masonry in `destroy()`.
- Do not touch shared helpers yet.

Why first:

- NPC already has the narrowest external API surface: only `initNpcsPanel()` is exported publicly.
- It is the cleanest place to prove the controller pattern before dealing with exported render functions in the other modules.

### Pass 2: `partyCards.js`

Files:

- `js/pages/tracker/panels/partyCards.js`
- `js/pages/tracker/trackerPage.js`

Plan:

- Apply the same controller pattern used for NPC.
- Stop relying on exported `renderPartyCards()` as a hidden singleton function; make render behavior instance-owned.
- Remove `_renderPartyTabs` as mutable module state; footer dropdowns should call a closure-local `renderTabs`.
- Preserve current behavior of card movement, search filtering, portrait flow, and section CRUD.

Specific migration note:

- Party currently mixes `_matchesSearch` and the module constant `matchesSearch`; unify those to one controller-local matcher in this pass.

### Pass 3: `locationCards.js`

Files:

- `js/pages/tracker/panels/locationCards.js`
- `js/pages/tracker/trackerPage.js`

Plan:

- Convert cards and toolbar wiring together so `initLocationsToolbar()` no longer reaches `_state`.
- Make `renderLocationCards()` and `renderLocationCard()` private controller helpers unless a real external caller appears.
- Preserve current location filter behavior and section filtering exactly.

Specific migration note:

- Location has the widest mixed responsibility surface because cards, toolbar state, and filters live in one file. Convert it last, after the controller pattern is stable from NPC and Party.

### Final tracker wiring cleanup after all three passes

Files:

- `js/pages/tracker/trackerPage.js`

Plan:

- Remove the singleton workaround for these three panels once all of them return real `destroy()` APIs.
- Keep `trackerPage.js` as the composition root, but store destroyable panel controllers instead of depending on module-singleton behavior.

## Risks and Migration Notes

- `trackerPage.js` currently sets `_singletonTrackerPanelInits[key] = true` when a panel does not return `destroy()`. Until all three panels are converted, repeated `initTrackerPage()` calls can still skip unconverted panels.
- Do not remove the tracker-page singleton workaround globally in the NPC pass. Remove it only after Party and Location also have teardown.
- `partyCards.js` and `locationCards.js` expose render exports that are effectively unsafe before init. Update the module surface and `trackerPage` together in the same pass for each file.
- The location module currently normalizes tracker defaults in both `initLocationsPanel()` and `initLocationsToolbar()`. Keep the normalization behavior unchanged during conversion; only move ownership into one controller-local flow.
- Incremental patch helpers (`patch*Collapsed`, `patch*Portrait`, `patch*Reorder`) must continue to operate on the current visible DOM and state list logic exactly as they do now.
- Card footer section dropdowns currently force tab rerenders by reaching back into hidden state. That behavior should become a closure-local function call, not a shared-module singleton.

## Exact File List Likely To Change In Implementation Passes

Implementation files:

- `js/pages/tracker/panels/npcCards.js`
- `js/pages/tracker/panels/partyCards.js`
- `js/pages/tracker/panels/locationCards.js`
- `js/pages/tracker/trackerPage.js`

Planning / documentation file:

- `docs/tracker-card-panel-instance-refactor-plan.md`

No shared helper file changes are planned up front. Only touch `js/pages/tracker/panels/cards/shared/*` if a later implementation pass proves that one narrow lifecycle helper extraction is required to preserve behavior.

## Developer Verification Note

When validating tracker panel lifecycle work manually:

- Stay on the Tracker page and trigger the same init path more than once in one browser session.
- After each re-init, click `+ NPC`, `+ Member`, and `+ Add Location` once each and confirm only one card is added per click.
- Click each section add button once and confirm only one new tab appears.
- For Locations, open and close the filter dropdown after re-init and confirm the toolbar still has a single enhanced dropdown wrapper and the filter still applies normally.
