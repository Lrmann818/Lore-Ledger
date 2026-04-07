# Asset Replacement Safety Plan

Date: 2026-04-06

Scope: focused audit/design pass for portrait and map asset replacement safety. This document does not change production behavior.

Status note: this file is now a historical pre-hardening audit snapshot. Current production behavior has since changed: tracker portraits, the Character portrait, map background replacement, and map drawing snapshot persistence now route through `replaceStoredBlob(...)` so the old blob is not deleted until the new reference has been saved successfully. Treat the sequences below as the rationale for the landed fix, not the current runtime behavior.

## In Scope

Affected runtime replacement flows:

- `js/features/portraitFlow.js`
  Shared portrait replacement helper used by tracker and character portrait flows.
- `js/pages/tracker/panels/cards/shared/cardPortraitShared.js`
  Shared tracker-card portrait wiring.
- `js/pages/tracker/panels/npcCards.js`
  NPC portrait replacement entry point.
- `js/pages/tracker/panels/partyCards.js`
  Party portrait replacement entry point.
- `js/pages/tracker/panels/locationCards.js`
  Location image replacement entry point.
- `js/pages/character/panels/basicsPanel.js`
  Character portrait replacement entry point.
- `js/pages/map/mapBackgroundActions.js`
  Map background replacement.
- `js/pages/map/mapPersistence.js`
  Map drawing snapshot persistence.
- `js/pages/map/mapController.js`
  `commitDrawingSnapshot()` entry point.
- `js/pages/map/mapPointerHandlers.js`
  Primary drawing-snapshot trigger points.

Out of scope for the implementation pass:

- explicit delete/remove flows such as card deletion, map deletion, or remove-background actions
- backup import/export logic
- unrelated text storage logic

Note on text-backed assets: no portrait/map replacement flow in scope currently replaces an IndexedDB text asset. The risky paths found here are blob-backed.

## Original Unsafe Pattern

The repeated unsafe shape is:

1. delete old blob
2. attempt to build/store replacement
3. update state reference later
4. rely on debounced save after the fact

This violates the intended rule:

- write new before deleting old
- never destroy what you cannot restore yet

The backup import path in `js/storage/backup.js` already uses the safer model: write new assets first, swap saved references, then clean up old assets only after save succeeds.

## Original Sequences Observed In Audit

### 1. Tracker portraits: NPC, party, location

Entry points:

- `js/pages/tracker/panels/npcCards.js` -> `pickNpcImage(...)`
- `js/pages/tracker/panels/partyCards.js` -> `pickPartyImage(...)`
- `js/pages/tracker/panels/locationCards.js` -> `pickLocImage(...)`
- shared through `js/pages/tracker/panels/cards/shared/cardPortraitShared.js`
- shared storage logic in `js/features/portraitFlow.js`

Current sequence:

1. panel handler calls `pickAndStorePortrait(...)`
2. `pickAndStorePortrait(...)` calls `pickCropStorePortrait(...)` with `currentBlobId`
3. `pickCropStorePortrait(...)` picks a file
4. `pickCropStorePortrait(...)` immediately deletes `currentBlobId` if present
5. image is cropped
6. cropped blob is written with `putBlob(...)`
7. new blob id is returned
8. panel handler writes `imgBlobId = newBlobId` and marks dirty indirectly via the panel update helper

Unsafe outcomes:

- if crop is cancelled after file selection, the old blob may already be gone
- if `putBlob(...)` fails, the old blob may already be gone
- old blob cleanup happens before the replacement reference has been saved
- a reload/crash between `markDirty()` and the later debounced save can leave saved state pointing at a deleted blob

### 2. Character portrait

Entry point:

- `js/pages/character/panels/basicsPanel.js`
- shared storage logic in `js/features/portraitFlow.js`

Current sequence:

1. click handler calls `pickCropStorePortrait(...)` with `state.character.imgBlobId`
2. `pickCropStorePortrait(...)` deletes the current blob first
3. crop runs
4. `putBlob(...)` stores the replacement
5. caller writes `state.character.imgBlobId = newBlobId`
6. caller re-renders portrait and relies on normal save scheduling

Unsafe outcomes:

- same delete-before-write problem as tracker portraits
- if replacement storage fails, the old portrait may already be deleted
- old blob cleanup still happens before the updated reference is durably saved

### 3. Map background replacement

Entry point:

- `js/pages/map/mapBackgroundActions.js` -> `setMapImage(...)`

Current sequence:

1. user picks a new background file
2. current `mp.bgBlobId` is deleted first
3. new file is written with `putBlob(...)`
4. `mp.bgBlobId` is updated to the new id
5. background image is loaded from the new blob id
6. on image load, map re-renders and `commitDrawingSnapshot()` runs
7. `SaveManager.markDirty()` is called

Unsafe outcomes:

- if `putBlob(...)` fails, the old background blob is already deleted
- until the new id is assigned, state still contains the old deleted id
- even after in-memory swap, old blob deletion has happened before the replacement reference is durably saved
- background replacement also triggers drawing snapshot replacement, which currently has its own delete-first bug

### 4. Map drawing snapshot persistence

Entry points:

- `js/pages/map/mapController.js` -> `commitDrawingSnapshot(...)`
- triggered from `js/pages/map/mapPointerHandlers.js`
- also triggered after background changes and map switches

Current sequence inside `persistDrawingSnapshot(...)`:

1. `drawLayer.toBlob(...)` creates a snapshot blob
2. current `mp.drawingBlobId` is deleted first
3. new snapshot blob is written with `putBlob(...)`
4. `mp.drawingBlobId` is updated
5. `SaveManager.markDirty()` is called

Unsafe outcomes:

- if `putBlob(...)` fails, the old drawing snapshot is already deleted
- saved state can still point to the deleted old id until the later save runs
- the current promise path can stall on a rejected `putBlob(...)`, because the async `toBlob(...)` callback does not catch and resolve that failure

## Narrow Fix Boundary

The future implementation should be deliberately small:

1. Keep portrait picking/cropping UI local.
2. Keep map background image loading/rendering local.
3. Keep drawing snapshot generation local.
4. Add one small shared helper for blob replacement only.

Recommended shared helper responsibility:

- accept `oldBlobId`, a prepared replacement `Blob`, `putBlob`, `deleteBlob`, a caller-supplied reference swap callback, and a save commit callback
- write the new blob first
- swap the in-memory reference to the new blob id
- force the structured state commit with `SaveManager.flush()`
- only after flush succeeds, best-effort delete the old blob
- if the swap or flush fails, restore the old reference and delete the newly written blob

Commit point for this work:

- treat successful `SaveManager.flush()` as the safe point after which deleting the old blob is allowed

This keeps the fix aligned with the existing import safety model in `js/storage/backup.js`, but without refactoring unrelated storage code.

## Shared Vs Local

Shared:

- one tiny blob-replacement helper used by portrait replacement, map background replacement, and drawing snapshot replacement
- optional focused tests for that helper

Remain local:

- file picking, crop modal usage, and portrait-specific status/error UX in `js/features/portraitFlow.js`
- tracker panel-specific state updates and rerender behavior
- character portrait rendering behavior
- map background decode/load/render behavior in `js/pages/map/mapBackgroundActions.js`
- canvas snapshot generation and pointer-trigger behavior in `js/pages/map/mapPersistence.js` and `js/pages/map/mapPointerHandlers.js`

Do not share yet:

- delete/remove flows
- backup import cleanup logic
- generic text replacement helpers

## Implementation Order

1. Add the shared blob-replacement helper and tests for:
   - put succeeds, flush succeeds, old blob deleted afterward
   - put fails, old blob kept
   - flush fails, old blob kept and new blob cleaned up
2. Update `js/features/portraitFlow.js` plus the tracker/character callers to stage the new portrait blob first, then swap/save, then delete the old portrait blob.
3. Update `js/pages/map/mapBackgroundActions.js` to use the same replacement helper before re-rendering and before triggering drawing snapshot persistence.
4. Update `js/pages/map/mapPersistence.js` to use the same replacement helper and to resolve failures cleanly instead of leaving the promise path hanging.
5. Add focused tests around portrait replacement and map snapshot/background failure handling.

## Files To Change In The Future Implementation Pass

Must change:

- `js/features/portraitFlow.js`
- `js/pages/tracker/panels/cards/shared/cardPortraitShared.js`
- `js/pages/tracker/panels/npcCards.js`
- `js/pages/tracker/panels/partyCards.js`
- `js/pages/tracker/panels/locationCards.js`
- `js/pages/character/panels/basicsPanel.js`
- `js/pages/map/mapBackgroundActions.js`
- `js/pages/map/mapPersistence.js`

Likely add:

- a new tiny shared helper under `js/storage/` or another narrow shared module
- focused tests covering replacement failure/success ordering

Should stay unchanged unless a small test seam is needed:

- `js/pages/map/mapPointerHandlers.js`
- `js/pages/map/mapController.js`
- unrelated blob/text storage modules

## Summary

All affected portrait and map replacement paths currently delete the old blob too early. The narrow safe fix is to stage the new blob, swap and flush the new reference, and only then best-effort delete the old blob. No production behavior was changed in this audit pass.
