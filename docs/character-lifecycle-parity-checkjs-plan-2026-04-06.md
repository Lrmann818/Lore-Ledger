# Character Lifecycle Parity + CheckJS Plan (2026-04-06)

Scope: audit/design only. No production behavior changes were made in this pass.

Status note: this file is now a historical pre-landing audit snapshot, not the current source of truth. Since it was written, `initCharacterPageUI(...)` now destroys the previous page controller on re-init, `equipmentPanel.js` and `spellsPanel.js` now return real `destroy()` APIs, and `tests/smoke/characterPanelLifecycle.smoke.js` covers repeated Character-page init. Treat the remaining sections below as original findings and deferred follow-up ideas.

Baseline used for comparison:

- Tracker page/controller pattern in `js/pages/tracker/trackerPage.js`
- Cleaned tracker card panel pattern in `js/pages/tracker/panels/npcCards.js`, `js/pages/tracker/panels/partyCards.js`, and `js/pages/tracker/panels/locationCards.js`
- Broad CheckJS run via `npm exec --yes --package typescript@5.9.3 -- tsc -p tsconfig.checkjs.json --pretty false`

## Target First

1. `js/pages/character/characterPage.js`
2. `js/pages/character/panels/equipmentPanel.js`
3. `js/pages/character/panels/spellsPanel.js`
4. `js/pages/character/panels/abilitiesPanel.js`
5. `js/pages/character/panels/attackPanel.js`
6. `js/pages/character/panels/vitalsPanel.js`
7. `js/features/autosize.js`
8. `app.js`

## Original Must-Fix Lifecycle Gaps

### 1. Page-level lifecycle is still mixed-mode instead of controller-owned

- `js/pages/character/characterPage.js:17-21` keeps `_singletonCharacterPanelInits`.
- `js/pages/character/characterPage.js:142-153` uses singleton skip behavior for `spells` and `equipment` instead of requiring a child `destroy()`.
- `js/pages/character/characterPage.js:175-182` means a second `initCharacterPageUI()` can destroy the page controller, then skip both panels entirely on re-init.

Why this is the highest-risk gap:

- Tracker page re-init is cleanup-driven.
- Character page re-init is partly cleanup-driven and partly "only initialize once".
- That is not true lifecycle parity, and it will fail if character DOM is re-created or if tests start exercising repeated character-page init.

### 2. `equipmentPanel.js` still uses module-singleton runtime state and one-time wiring

- `js/pages/character/panels/equipmentPanel.js:14-32` stores state, DOM refs, services, and mutation helpers in module scope.
- `js/pages/character/panels/equipmentPanel.js:117-122` creates the search highlight overlay but never tears it down.
- `js/pages/character/panels/equipmentPanel.js:202-330` wires persistent toolbar/listeners behind `_wired`.

Practical risk:

- Safe only while the same DOM nodes survive forever.
- Not safe as an instance-owned panel controller.
- Currently depends on the page-level singleton skip in `characterPage.js`.

### 3. `spellsPanel.js` has no teardown path and is effectively protected by the page singleton skip

- `js/pages/character/panels/spellsPanel.js:48-50` creates panel-local caches/timers.
- `js/pages/character/panels/spellsPanel.js:95-103` starts debounced note-save timers with no destroy-time flush/clear.
- `js/pages/character/panels/spellsPanel.js:105-137` binds the persistent add-level button directly.
- `js/pages/character/panels/spellsPanel.js:474` returns no controller API.

Practical risk:

- No explicit listener teardown.
- No explicit timer cleanup.
- Re-init safety currently relies on `characterPage.js` not calling it again.

### 4. `abilitiesPanel.js` is the largest remaining character lifecycle hotspot

- `js/pages/character/panels/abilitiesPanel.js:81-109`, `162-174`, `219-300`, `600-638` use dataset guards for persistent listeners instead of controller-owned teardown.
- `js/pages/character/panels/abilitiesPanel.js:471-548` creates skill menus and appends them to `document.body`.
- `js/pages/character/panels/abilitiesPanel.js:570-593` registers dynamic popovers for those menus, but the panel does not own a destroy path for them.

Practical risk:

- The panel is mostly stable while DOM is permanent, but it is not teardown-safe.
- Body-appended menus are the character-page equivalent of the kind of hidden runtime state tracker panels already moved away from.

### 5. `attackPanel.js` and `vitalsPanel.js` are re-init guarded, but not teardown-owned

- `js/pages/character/panels/attackPanel.js:42-48` uses `dataset.attacksInit`.
- `js/pages/character/panels/vitalsPanel.js:403-409` uses `dataset.vitalsInit`.
- Both panels re-render on repeat init, but neither returns a controller with explicit listener teardown.

Practical risk:

- Lower than spells/equipment because the guards at least still re-render.
- Still behind tracker-panel architecture, which now owns listeners via controller-local `AbortController` and `destroy()`.

### 6. Lower-severity follow-ons after the first wave

- `js/pages/character/panels/basicsPanel.js:61-69` and `119-167` bind title-sync and portrait listeners via DOM markers only.
- `js/ui/collapsibleTextareas.js:22-50` binds collapse buttons once with no destroy path.

These should move under explicit character-page teardown eventually, but they are not the first blockers.

## Original Practical CheckJS Surface

The current broad error surface is concentrated in a few clusters:

- `js/pages/character/panels/abilitiesPanel.js`: 27 errors.
  Mostly DOM narrowing, `dataset`, `value`, `checked`, and `focus` typing.
- Tracker card shared helpers: 38 errors across:
  - `js/pages/tracker/panels/cards/shared/cardFooterShared.js`
  - `js/pages/tracker/panels/cards/shared/cardHeaderControlsShared.js`
  - `js/pages/tracker/panels/cards/shared/cardIncrementalPatchShared.js`
  - `js/pages/tracker/panels/cards/shared/cardPortraitRenderShared.js`
  - `js/pages/tracker/panels/cards/shared/cardPortraitShared.js`
  - `js/pages/tracker/panels/cards/shared/cardSearchHighlightShared.js`
  - `js/pages/tracker/panels/cards/shared/cardsShared.js`
- Tracker card panel call sites: 15 follow-on errors across:
  - `js/pages/tracker/panels/npcCards.js`
  - `js/pages/tracker/panels/partyCards.js`
  - `js/pages/tracker/panels/locationCards.js`
- Boundary contract mismatch: 2 errors across `js/features/autosize.js` and `app.js`.
- `js/pages/character/panels/equipmentPanel.js`: 1 error around the `ui/bindings.js` `bindNumber(...)` contract.

## Good-Next CheckJS Cleanup Targets

These are the best narrow shared/boundary targets to clean up next because they should reduce downstream noise fast.

### 1. Fix the `setupTextareaSizing(...)` boundary contract first

- `js/features/autosize.js`
- `app.js`

Why first:

- Only two errors.
- It is a real boundary contract, not panel-local noise.
- It directly affects the spell-notes textarea sizing path that character panels depend on.

### 2. Add explicit option typedefs to the tracker card shared helper layer

Target these before panel call sites:

- `js/pages/tracker/panels/cards/shared/cardHeaderControlsShared.js`
- `js/pages/tracker/panels/cards/shared/cardFooterShared.js`
- `js/pages/tracker/panels/cards/shared/cardPortraitRenderShared.js`
- `js/pages/tracker/panels/cards/shared/cardPortraitShared.js`
- `js/pages/tracker/panels/cards/shared/cardIncrementalPatchShared.js`
- `js/pages/tracker/panels/cards/shared/cardSearchHighlightShared.js`
- `js/pages/tracker/panels/cards/shared/cardsShared.js`

Why next:

- The current errors are mostly missing/desynchronized option-object JSDoc.
- Those helpers sit on the boundary between the cleaned tracker controllers and the remaining repo-wide CheckJS run.
- Cleaning them first should simplify the remaining `npcCards.js` / `partyCards.js` / `locationCards.js` errors.

### 3. Then clean the three tracker card panel call sites

- `js/pages/tracker/panels/npcCards.js`
- `js/pages/tracker/panels/partyCards.js`
- `js/pages/tracker/panels/locationCards.js`

Expected outcome:

- Mostly follow-on fixes once helper contracts are typed correctly.

### 4. Small, contained cleanup after shared helper work

- `js/pages/character/panels/equipmentPanel.js`

Why:

- Single current CheckJS error.
- Easy cleanup, but not as leverage-heavy as the shared helper layer.

## Later / Deferred Items

### Defer until after the first lifecycle parity pass

- `js/pages/character/panels/basicsPanel.js`
- `js/ui/collapsibleTextareas.js`

Reason:

- Real cleanup candidates, but not the highest-risk lifecycle gaps.

### Defer the large `abilitiesPanel.js` CheckJS pass until its lifecycle shape is clearer

- `js/pages/character/panels/abilitiesPanel.js`

Reason:

- It is the biggest remaining single-file error source.
- Most errors are local and mechanical.
- Doing that typing pass before deciding the destroy/menu ownership shape risks duplicate churn.

### Defer tracker Sessions lifecycle cleanup until character parity is landed

- `js/pages/tracker/panels/sessions.js`

Reason:

- It still uses module-level mutable state and `_wired` (`js/pages/tracker/panels/sessions.js:8-24`, `127-130`, `198-283`).
- It is the main remaining tracker-panel outlier, but the current request is character-page lifecycle parity first.

### Do not expand this into a rewrite

Not recommended in this pass:

- A generic character panel controller framework
- A sweeping shared renderer rewrite across character panels
- Converting the whole character page to a new schema or component model

## Narrow Implementation Plan

1. Make `initCharacterPageUI(...)` lifecycle-consistent with tracker page.
   Remove character-page singleton skip flags and require real child destroy APIs for panels that own persistent listeners.
2. Convert the highest-risk character panels into instance-scoped controllers first.
   First wave: `equipmentPanel.js` and `spellsPanel.js`.
   Second wave: `abilitiesPanel.js`, `attackPanel.js`, `vitalsPanel.js`.
3. Add a focused smoke test for repeated character-page init.
   Mirror the intent of `tests/smoke/trackerPanelLifecycle.smoke.js`, but cover repeated init for spells/equipment and one representative guarded panel.
4. After lifecycle parity lands, do the small shared/boundary CheckJS wave.
   First `js/features/autosize.js` + `app.js`, then the tracker card shared helpers, then the three tracker card panel call sites.
5. Finish with small contained leftovers.
   `equipmentPanel.js` CheckJS fix, then any deferred basics/collapsible cleanup if still needed.
