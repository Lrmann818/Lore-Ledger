# Storage and Backups

This document describes how persistence works in the current codebase.

Source-of-truth modules for this behavior:

- `app.js`
- `boot.js`
- `js/state.js`
- `js/storage/idb.js`
- `js/storage/blobs.js`
- `js/storage/texts-idb.js`
- `js/storage/persistence.js`
- `js/storage/saveManager.js`
- `js/storage/backup.js`
- `js/ui/navigation.js`
- `js/ui/dataPanel.js`
- `js/features/autosize.js`
- `js/features/portraitFlow.js`
- `js/pages/character/panels/spellsPanel.js`
- `js/pages/map/mapBackgroundActions.js`
- `js/pages/map/mapPersistence.js`

## 1. Storage philosophy

The app is local-first and browser-only. There is no server copy of user data.

The persistence design intentionally splits data by size and failure mode:

- Small, structured, schema-versioned state lives in `localStorage`.
- Large binary assets and large note bodies live in IndexedDB.
- Runtime-only state stays in memory and is rebuilt on load.

This keeps the main JSON payload small and migratable while avoiding inlining images or long note text into the main save blob.

Compatibility is handled in two places:

- `migrateState(...)` in [`js/state.js`](../js/state.js)
- startup storage migration in [`js/storage/persistence.js`](../js/storage/persistence.js)

That split matters because some compatibility work needs IndexedDB access, not just JSON reshaping.

## 2. Storage layers used and why

| Layer | Current use | Why it exists |
| --- | --- | --- |
| In-memory runtime state | map undo/redo, dice history, calculator history, DOM/controller state | Fast, ephemeral state that should not survive reloads |
| `localStorage["localCampaignTracker_v1"]` | sanitized structured app state | Simple synchronous save/load for the core JSON model |
| `localStorage["localCampaignTracker_activeTab"]` | last top-level tab | Restores tab choice even when no full save has happened yet |
| IndexedDB `localCampaignTracker_db` / `blobs` | portraits, map backgrounds, map drawing snapshots | Keeps large binary payloads out of the main JSON save |
| IndexedDB `localCampaignTracker_db` / `texts` | large note text, currently spell notes | Keeps long-form text out of the main JSON save |
| exported backup JSON | portable offline backup file | Captures cross-store data in one file for restore/reset recovery |

## 3. localStorage responsibilities

The main state key is `localCampaignTracker_v1`.

It stores the sanitized object returned by `sanitizeForSave(...)`:

- `schemaVersion`
- `tracker`
- `character`
- `map`
- `ui`

Important exclusions from the main JSON payload:

- `map.undo`
- `map.redo`
- `ui.dice`
- `ui.calc.history`

Important inclusions in the main JSON payload:

- search/filter/index UI state such as `activeSessionIndex`, `inventorySearch`, and `ui.activeTab`
- textarea height preferences in `ui.textareaHeights`
- panel collapse/order preferences
- blob references such as `imgBlobId`, `bgBlobId`, and `drawingBlobId`
- spell IDs, but not spell note bodies

The separate UI key is `localCampaignTracker_activeTab`.

That key is written immediately by [`js/ui/navigation.js`](../js/ui/navigation.js) when the top tab changes. It does not mark the full save dirty.

`boot.js` also reads `localCampaignTracker_v1` directly on startup to apply the saved theme as early as possible.

## 4. IndexedDB responsibilities

IndexedDB uses:

- database name: `localCampaignTracker_db`
- database version: `2`
- object stores: `blobs`, `texts`

The `blobs` store currently holds:

- character portrait blobs
- NPC portrait blobs
- party portrait blobs
- location portrait blobs
- map background image blobs
- persisted map drawing snapshots

The `texts` store currently holds:

- spell note bodies, keyed as `spell_notes_<spellId>`

IndexedDB records are stored as objects, not raw values:

- blobs: `{ id, blob, type, updatedAt }`
- texts: `{ id, text, updatedAt }`

This storage is separate from the `localStorage` save lifecycle. There is no cross-store transaction covering both IndexedDB and `localStorage`.

## 5. Blob/text storage notes

Blob IDs are generated like `blob_<random>_<time>`.

Blob helper behavior:

- `putBlob(blob, id?)` writes a blob record and optionally preserves a caller-supplied ID
- `getBlob(id)` returns the stored `Blob` or `null`
- `blobIdToObjectUrl(id)` creates and caches an object URL
- `deleteBlob(id)` revokes any cached object URL before deleting
- `clearAllBlobs()` revokes all cached object URLs and clears the whole store

Text helper behavior:

- `putText(text, id)` always stores `String(text ?? "")`
- `getText(id)` returns `""` when missing
- `deleteText(id)` removes one text record
- `clearAllTexts()` clears the whole text store
- `getAllTexts()` returns every text record as an object map

Current storage-specific nuances:

- character/tracker portraits are usually cropped and stored as `image/webp`
- map drawing snapshots are written as PNG blobs from `canvas.toBlob(...)`
- map background uploads are stored as the selected file blob
- portrait, character-portrait, map-background, and drawing-snapshot replacement now use `replaceStoredBlob(...)` so they stage the new blob, update the saved reference, flush the structured save, and only then delete the old blob
- spell note bodies save on their own debounce directly to IndexedDB and do not use `SaveManager`
- backup export includes all text records from `texts`, not just texts referenced by the current state
- backup export includes only blob IDs that are currently referenced from state

## 6. SaveManager lifecycle

`SaveManager` is created in [`app.js`](../app.js) around `saveAllLocal(...)`.

Configured behavior:

- debounce before save attempt: `250ms`
- delay before showing `Unsaved changes`: `400ms`
- statuses: `Saved locally.`, `Unsaved changes`, `Saving...`, `Save failed (local). Export a backup.`

Startup lifecycle:

1. `SaveManager` is created.
2. `installExitSave(SaveManager)` is registered.
3. `loadAll(...)` loads and migrates persisted state.
4. `loadAll(...)` calls `markDirty()` after a successful load so the app rewrites the normalized/migrated shape.
5. After all page modules are initialized, `app.js` calls `await SaveManager.flush()`.
6. `app.js` then calls `SaveManager.init()` to reset status to a clean saved state.

Two important current details:

- the boot-time flush happens even when the successful load did not obviously change visible data, because `loadAll(...)` always marks dirty after a successful parse/migration
- `SaveManager.flush()` only covers the structured `localStorage` save path

## 7. Dirty marking and flush behavior

The canonical "queue a save" API is `SaveManager.markDirty()`.

Most UI mutations reach it through:

- `createStateActions(...)`
- `bindText(...)`, `bindNumber(...)`, `bindContentText(...)`, `bindChecked(...)`
- direct panel handlers that mutate state and then call `SaveManager.markDirty()`

When `markDirty()` runs:

- `dirty = true`
- the "dirty" UI is delayed to avoid flicker
- any pending debounce timer is reset
- a save attempt is scheduled

When `flush()` runs:

- if nothing is dirty, it renders `Saved locally.`
- if a save is already in progress, it records `saveRequested = true` and exits
- otherwise it calls `saveAll()` synchronously
- success clears `dirty`
- failure leaves `dirty` set and moves status to `ERROR`

Not every persistence-related mutation marks dirty immediately:

- top-tab changes update `state.ui.activeTab` with `queueSave: false` and also write `localStorage["localCampaignTracker_activeTab"]` immediately
- textarea size persistence writes to `state.ui.textareaHeights` with `queueSave: false`, then schedules a save after `150ms`
- map undo/redo sync writes into state with `queueSave: false`, and those fields are stripped from the saved payload anyway
- spell note body edits skip `SaveManager` entirely and write straight to IndexedDB after a separate `250ms` debounce

Exit/save hooks are best-effort only:

- `beforeunload`
- `pagehide`
- `visibilitychange` when the page becomes hidden

`beforeunload` can trigger the native leave prompt when `SaveManager` is still dirty, but the flush is still not guaranteed to finish.

## 8. Backup export flow

Export lives in [`js/storage/backup.js`](../js/storage/backup.js).

Current flow:

1. Call `ensureMapManager()` so map references are in a consistent shape.
2. Collect referenced blob IDs from:
   - `character.imgBlobId`
   - tracker NPCs, party members, and locations
   - each map entry's `bgBlobId` and `drawingBlobId`
3. Read each referenced blob from IndexedDB and convert it to a data URL.
4. Build a backup object:
   - `version: 2`
   - `exportedAt`
   - `state: sanitizeForSave(...)`
   - `blobs`
   - `texts: await getAllTexts()`
5. Serialize to JSON and trigger a download named `campaign-backup-YYYY-MM-DD.json`.

Export safety behavior:

- unreadable blobs are skipped with `console.warn(...)`
- export does not abort when one blob read fails
- if the download click fails, the user gets an alert

Compatibility note:

- backup format `version: 2` is the current format
- `version: 1` backups existed without `blobs` or `texts`

## 9. Backup import flow

Import also lives in [`js/storage/backup.js`](../js/storage/backup.js).

Accepted incoming formats:

- raw state object
- `{ version: 1, state: ... }`
- `{ version: 2, state: ..., blobs: ..., texts: ... }`

Current flow:

1. Read the selected file.
2. Reject files larger than `15 MB`.
3. Parse JSON.
4. Normalize and shallow-validate the format.
5. Run `migrateState(...)` on the incoming state.
6. Reject backups with more than `200` blob entries.
7. Reject blob entries whose data URLs are not `image/png`, `image/jpeg`, `image/jpg`, or `image/webp`.
8. Stage blobs first:
   - try to preserve each original blob ID via `putBlob(blob, oldId)`
   - if that fails, store the blob under a new ID and record an old-to-new remap
9. Stage texts next with `putText(text, id)`.
10. Rewrite any remapped blob IDs inside migrated state.
11. Clone the migrated result and replace the live long-lived `state` object's top-level buckets.
12. Call `ensureMapManager()`.
13. Call `saveAll()` and require that write to succeed before the import is accepted.
14. After a successful save, selectively delete old blob/text records that are no longer referenced by the restored state.
15. If the backup contained no blobs, show the completion notice.
16. Run `afterImport()`, which currently reloads the page from `app.js`.

Import safety behavior:

- live state is not mutated until blob/text staging succeeds
- corrupt or unsupported image payloads fail the import before state restore
- blob ID remapping is applied to every currently known blob-reference location

Important current nuances:

- import does not clear existing blob/text stores before restore
- before the state swap, failures clean up newly written blobs but do not roll back any texts that were already written
- after a successful save, import tries to delete old blobs/texts that are no longer referenced, but cleanup failures only log warnings
- import does not write `localStorage["localCampaignTracker_activeTab"]` directly; tab restore comes from hash, the separate active-tab key when present, or restored `state.ui.activeTab` on the next boot
- if a backup contains no blobs, the import does not restore image data from the file; already-present blob records are only kept when the restored state still references them
- import restores root `ui` values too, including `ui.activeTab`

## 10. Reset Everything behavior

`resetAll(...)` is the full local wipe path.

Current flow:

1. Show a confirmation dialog warning that local saved data, images, and large notes will be cleared.
2. Set status to `Resetting...`.
3. Best-effort call `flush()` before wiping.
4. Remove:
   - `localStorage["localCampaignTracker_activeTab"]`
   - `localStorage["localCampaignTracker_v1"]`
5. Clear IndexedDB:
   - `clearAllBlobs()`
   - `clearAllTexts()`
6. Reload the page.

If any wipe step throws, reset shows an alert and stops instead of reloading into a half-acknowledged success state.

Related but narrower flows in the data panel:

- `Reset UI Only` clears UI-only preferences and reloads
- `Clear Images Only` nulls all `*BlobId` references in state, flushes that state, clears the blob store, then reloads
- `Clear Text Notes Only` clears the text store and reloads

## 11. Failure/recovery expectations

There is no server recovery path. If browser storage is cleared, the recovery artifact is the exported backup JSON.

Current expectations by failure type:

- `localStorage` save failure:
  - `saveAllLocal(...)` returns `false`
  - `SaveManager` shows `Save failed (local). Export a backup.`
  - dirty state is retained so another flush can still succeed later
- corrupted or unreadable saved JSON on startup:
  - `loadAll(...)` logs the error
  - app stays on in-memory defaults
  - status becomes `Loaded with issues. Consider exporting a backup.`
- startup legacy image migration failure:
  - the app keeps loading
  - the user gets a status warning about storage being full or an image being corrupted
  - migrated state may be partial
- export blob read failure:
  - the backup can still be generated
  - some images may be missing from the exported file
- import failure:
  - live state is protected until late in the process
  - newly written blobs are cleaned up on pre-swap failure paths, but partially written texts or post-success cleanup failures can still leave orphaned records
- early theme boot failure:
  - `boot.js` falls back to default CSS theme silently

Because storage is split, partial persistence is possible:

- a blob write can succeed and the follow-up `localStorage` save can fail
- a spell note text write can lag behind or fail independently of the main save status
- exit-triggered flushes are best-effort, not guaranteed

That means "Saved locally." only describes the structured JSON save path managed by `SaveManager`, not every IndexedDB write in the app.

## 12. Developer safety rules when modifying persistence

1. Pick one canonical storage owner for every new field.
   Use structured state, blob storage, text storage, or runtime-only memory deliberately. Do not duplicate ownership without a migration reason.

2. Keep `sanitizeForSave(...)` accurate.
   If a field is runtime-only, strip it there. If it must survive backup/export, make sure it remains in the sanitized payload.

3. Treat schema changes as compatibility work, not just refactors.
   Bump `CURRENT_SCHEMA_VERSION`, append to `SCHEMA_MIGRATION_HISTORY`, and add a migration step in `migrateState(...)` when persisted meaning changes.

4. Keep startup migration and schema migration responsibilities separate.
   Pure JSON shape repair belongs in `migrateState(...)`. Anything that needs IndexedDB access belongs in startup persistence/import code.

5. Update backup import/export whenever you add cross-store references.
   Blob IDs and text IDs must remain restorable.

6. Do not assume `SaveManager.flush()` makes blob/text writes durable.
   It only drives the main `localStorage` save.

7. Be careful with replacement writes.
   Current portrait and map replacement flows now use `replaceStoredBlob(...)` so they write new -> update reference -> flush -> delete old. Preserve that ordering if you touch these paths.

8. Be explicit about save-status semantics when bypassing `SaveManager`.
   `ui.activeTab` and spell note bodies already bypass the normal dirty/save UI. Any new direct-storage path should document that clearly.

9. Avoid dangling references and dangling records.
   If you clear blobs, remove blob IDs from state first. If you remap blob IDs on import, rewrite every reference. If an operation can leave orphaned IndexedDB rows, document or clean them.

10. Preserve the long-lived root state object contract unless intentionally redesigning it.
    Current code merges into the existing `state` object instead of replacing it outright.

11. Test the full recovery path after persistence changes.
    Minimum maintainer check: edit data -> refresh -> export backup -> reset everything -> import backup -> confirm reload restores the data.

12. Prefer user-data preservation over cleanup aggressiveness.
    Unknown future schema versions are accepted as-is by `migrateState(...)` to avoid downgrade clobbering. Keep that bias unless the project intentionally changes compatibility policy.
