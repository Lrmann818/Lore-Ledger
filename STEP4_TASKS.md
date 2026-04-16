# Step 4 — Cross-Campaign Character Import / Export: Task Plan

> **Step 4 is complete, audited, and fully verified as of 2026-04-16. Do not treat any item below as pending implementation work.**
>
> This file is preserved for historical/reference purposes before Step 3 planning.

Read `MULTI-CHARACTER_DESIGN.md` first for full context. This file is the ordered task list for Step 4.

Work one task at a time. Run `npm run test:run` after each task. Do not proceed to the next task if tests fail.

---

## Confirmed scope decisions

### Decision 1 — No schema version bump

Unlike Steps 1 and 2, this feature adds no new fields to stored state. Export and import are file-level operations that read and write `CharacterEntry` values using the existing schema. No migration is needed.

### Decision 2 — File format: full data URL, not raw base64

The design doc shows `portrait: { mimeType, base64 }`. In practice, `blobToDataUrl` (already in `js/storage/blobs.js`) produces a full data URL like `data:image/webp;base64,...`. Storing the full data URL is more convenient because:

1. The round-trip is one function call in each direction (`blobToDataUrl` / `dataUrlToBlob`), both already exist.
2. No ambiguity about how to reassemble the data URL from separate fields.
3. The format tag (`formatVersion: 1`) still allows changing this later if needed.

Revised export shape:

```json
{
  "formatVersion": 1,
  "type": "lore-ledger-character",
  "character": { ...full CharacterEntry },
  "portrait": {
    "dataUrl": "data:image/webp;base64,...",
    "mimeType": "image/webp"
  }
}
```

The `mimeType` is retained as a convenience field for display / validation, but the canonical source is the data URL.

### Decision 3 — Spell notes ARE exported (bundled in the file)

Spell notes are stored as campaign-scoped IDB text records (key pattern: `spell_notes_{campaignId}__{spellId}`). Since spell IDs are generated per-spell-entry (unique per row in a character's spell list) and travel with the character entry itself, the cleanest approach is to bundle notes into the export file and re-key them on import.

Revised export shape includes a `spellNotes` field:

```json
{
  "formatVersion": 1,
  "type": "lore-ledger-character",
  "character": { ...entry with spells.levels[].spells[].id values... },
  "portrait": { "dataUrl": "...", "mimeType": "..." } | null,
  "spellNotes": {
    "spell_abc123": "Save for boss fights.",
    "spell_def456": "Cast at sunset for bonus damage."
  } | {}
}
```

The map is `{ spellId: noteText }` — spell IDs are already unique per spell entry across a character, so no campaign prefix is needed inside the bundle. Empty-string notes are omitted to keep files clean.

**Export flow:** After resolving the active character, walk `character.spells.levels[].spells[]` and collect each spell's `id`. For each, call `getText(textKey_spellNotes(currentCampaignId, spellId))` and add non-empty notes to the bundle.

**Import flow:** After the character entry is committed to state, iterate the `spellNotes` map and call `putText(noteText, textKey_spellNotes(newCampaignId, spellId))` for each. The spell IDs themselves are preserved as-is from the character object — no regeneration needed.

**Why this over alternatives:**
- Moving notes onto `character.spells.levels[].spells[].notes` would fold potentially long text into state, defeating the original reason notes live in a separate IDB store.
- Re-scoping storage keys to `{campaignId}__{characterId}__{spellId}` is a pure migration tax — the current keys work, and the bundle approach already scopes notes to the character by collecting only that character's spell IDs.

**Failure ordering:** Notes write is the LAST step of import, after the character is in state and any portrait blob is stored. If notes fail to write, the character still exists; the user can retry or live with empty notes. The inverse — writing notes before the character exists — would leave orphaned text records if anything else failed.

### Decision 4 — Linked cards are NOT exported

The design doc already specifies this. A character's `characterId` references from tracker cards are campaign-local and do not travel with the character. The imported character arrives standalone.

### Decision 5 — File extension and naming

Export file name: `{sanitized-character-name}-{short-id}.ll-character.json`

- Example: `thorin-oakenshield-a3f7.ll-character.json`
- The double extension (`.ll-character.json`) makes the file identifiable as a Lore Ledger character while still being a regular JSON file that tools recognize.
- The short ID suffix prevents filename collisions when exporting characters with the same name.

### Decision 6 — Import behavior: always adds, never replaces

Imported characters are always added as new entries with newly generated IDs. There is no "overwrite existing" flow. If the user wants to replace a character, they delete the old one first, then import. This keeps the import flow simple and removes a class of destructive confirmations.

### Decision 7 — Validation before state mutation

The import flow must validate the entire file before touching any state. This follows the atomic-import pattern already established in `backup.js` (abort vs rollback distinction). If validation fails, no state changes, no orphaned blobs, no partial character entries.

---

## Task 1 — Export format and serialization

**Files:** new file `js/domain/characterPortability.js`

This is the core serialization module. Both export and import logic lives here. No UI concerns — this module is pure data transformation.

1. Define `EXPORT_FORMAT_VERSION = 1` as a constant.
2. Define `EXPORT_FORMAT_TYPE = "lore-ledger-character"` as a constant.
3. Create `exportCharacterToObject(character, portraitBlob, spellNotes)`:
   - Takes a `CharacterEntry`, an optional portrait `Blob`, and a `spellNotes` map `{ [spellId]: noteText }`.
   - Returns the export object shape (see Decisions 2 and 3).
   - Converts the blob to a data URL via `blobToDataUrl` if present.
   - Clones the character entry (defensive — don't share references with live state).
   - Leaves `imgBlobId` intact in the cloned character — it will be replaced during import.
   - Includes the `spellNotes` map as-is. If empty, emits `"spellNotes": {}`.
4. Create `collectCharacterSpellIds(character)`:
   - Pure helper that walks `character.spells.levels[].spells[]` and returns an array of all `spell.id` strings.
   - Defensive against missing `spells`, missing `levels`, non-array values, and missing/non-string ids.
   - Used by both the export orchestrator (to know which notes to fetch) and the import orchestrator (to validate the `spellNotes` map only references known spell IDs).
5. Create `validateImportFile(json)`:
   - Checks `formatVersion === 1`, `type === "lore-ledger-character"`.
   - Checks `character` is an object with at minimum `name` (string) and `id` (string).
   - Checks `portrait` is either null/absent or an object with a valid `dataUrl` string starting with `data:`.
   - Checks `spellNotes` is either absent or a plain object where every value is a string. Non-string values or nested objects → reject.
   - Returns `{ valid: true }` or `{ valid: false, reason: "..." }` with a human-readable reason.
   - Does NOT mutate anything. Pure validation.
6. Create `prepareImportedCharacter(importObject, { newBlobId })`:
   - Takes the validated import object.
   - Generates a new character ID (same pattern as `makeDefaultCharacterEntry`).
   - If a portrait is present, uses the provided `newBlobId` as the character's `imgBlobId`.
   - If no portrait, sets `imgBlobId: null` regardless of what the original had.
   - Returns `{ characterEntry, portraitBlob | null, spellNotes }` — caller handles the actual blob storage, state mutation, and notes persistence.
   - This function is pure data transformation; it does not touch IndexedDB or state.
   - The `spellNotes` map is passed through unchanged (re-keyed with the new campaign ID later, during commit).

**Tests to write:** Export a character with a portrait and spell notes → validates round-trip via `validateImportFile`. Export without portrait → `portrait: null` in result. Export with no notes → `spellNotes: {}`. `validateImportFile` rejects wrong version, wrong type, missing character, malformed portrait, malformed `spellNotes` (non-object, non-string values). `collectCharacterSpellIds` handles missing/malformed spell structure. `prepareImportedCharacter` always generates a new ID. `prepareImportedCharacter` strips `imgBlobId` when portrait is absent. `prepareImportedCharacter` passes through the `spellNotes` map unchanged.

---

## Task 2 — Import/export IDB integration

**Files:** new file `js/domain/characterPortability.js` (continued) or a sibling orchestrator module — Claude's choice, but keep the pure transformation functions separate from the side-effect-heavy ones.

This layer handles the actual Blob ↔ IDB interactions and the campaign-scoped key resolution.

1. Create `exportActiveCharacter({ state, getBlob, getText })`:
   - Resolves the active character via `getActiveCharacter(state)`.
   - If no active character, throws a clear error.
   - Resolves the current campaign id from `state.appShell.activeCampaignId` (use the existing `getActiveCampaignId` helper in `backup.js` as a reference pattern — defensive against missing `appShell`).
   - Fetches the portrait blob via `getBlob(character.imgBlobId)` if present.
   - Collects spell IDs via `collectCharacterSpellIds(character)`.
   - For each spell ID, calls `getText(textKey_spellNotes(campaignId, spellId))`. Only non-empty notes are included in the `spellNotes` bundle.
   - Returns the export object (via `exportCharacterToObject`).
   - Caller is responsible for serializing to JSON and triggering download.
2. Split `importCharacterFromFile` into two phases for the Task 4 confirmation flow:
   - `parseAndValidateImport(file)`:
     - Reads the file as text, parses JSON. Any parse error → throw with "Invalid JSON file."
     - Calls `validateImportFile`. Any validation failure → throw with the reason.
     - Returns the parsed, validated import object (so callers can inspect `.character.name` etc. for confirmation dialogs before committing).
   - `commitImport(importObject, { state, SaveManager, putBlob, deleteBlob, putText, dataUrlToBlob, mutateState })`:
     - Resolves the current campaign id from `state.appShell.activeCampaignId`. If null/missing, throw "No active campaign."
     - **Step 1 — Portrait blob (if present):** Convert data URL → Blob → `putBlob(blob)` to get a new blob ID. On failure, throw with "Failed to store portrait." State is unchanged at this point.
     - **Step 2 — Prepare entry:** Call `prepareImportedCharacter(importObject, { newBlobId })` to get the `{ characterEntry, portraitBlob, spellNotes }` result.
     - **Step 3 — State mutation:** Push the new entry to `state.characters.entries`, set `activeId` to the new entry's id. If this throws, clean up the portrait blob (Step 1) via `deleteBlob(newBlobId)` before re-throwing. This preserves the "either all succeed or nothing persists" contract.
     - **Step 4 — Mark dirty:** `SaveManager.markDirty()` so the new entry is persisted.
     - **Step 5 — Spell notes (best-effort, last):** For each `[spellId, noteText]` in `spellNotes`, call `putText(noteText, textKey_spellNotes(campaignId, spellId))`. If a notes write fails, log a warning and continue — the character and portrait are already committed, and the user can fix individual notes manually. Do NOT roll back the character on notes failure; the cost (losing the whole import) outweighs the benefit (having perfect notes).
     - Returns the new character's id so the caller can show confirmation.
3. Implement **blob cleanup on state-mutation failure** exactly as described in Step 3 above. This is the same write-before-delete / cleanup-on-rollback pattern from `backup.js`.

**Ordering rationale:** Steps 1–4 MUST be atomic — if any fail, nothing persists. Step 5 (spell notes) is intentionally after the atomic boundary because (a) notes are secondary to the character itself and (b) rolling back the character over a failed notes write would be user-hostile. The "last step" placement also means a failure in Steps 1–4 never produces orphaned notes in IDB.

**Tests to write:** `parseAndValidateImport` with valid file returns parsed object. Invalid JSON throws before any state touches. Validation failure throws before any state touches. `commitImport` with a valid file adds entry, sets active, stores blob, writes notes. `putBlob` failure leaves no partial state. State mutation failure (simulated) cleans up the blob. Notes write failure does NOT roll back the character. Portrait-less export/import round-trips cleanly. Notes-less export/import round-trips cleanly. Full round-trip (export → import → export) produces equivalent data (modulo regenerated IDs).

---

## Task 3 — Character sub-toolbar menu integration

**Files:** `index.html`, `js/pages/character/characterPage.js`

1. Add two new menu items to `#charActionDropdownMenu` in `index.html`:
   ```html
   <button type="button" class="swatchOption charActionMenuItem" id="charActionExportBtn"
     data-char-action="export">Export Character</button>
   <button type="button" class="swatchOption charActionMenuItem" id="charActionImportBtn"
     data-char-action="import">Import Character</button>
   ```
   Place them after "Add to Party" and before "Delete Character" — logical grouping (character-data actions before destructive actions).

2. In `characterPage.js`, add two new handler functions:
   - `runExportCharacterAction()`:
     - Get active character; disable/skip if none.
     - Call `exportActiveCharacter({ state, getBlob, getText })`.
     - Serialize to JSON with 2-space indentation (human-readable).
     - Generate filename per Decision 5.
     - Trigger a download using the standard `Blob` + `URL.createObjectURL` + anchor click pattern (same as existing backup export).
     - Status: "Character exported."
   - `runImportCharacterAction()`:
     - Show a file input (`<input type="file" accept=".json,application/json">` — created dynamically, not a persistent DOM element).
     - On file selection, call `parseAndValidateImport(file)` first.
     - Show the Task 4 confirmation dialog using the parsed character's name.
     - On confirm, call `commitImport(parsedObject, deps)` with `{ state, SaveManager, putBlob, deleteBlob, putText, dataUrlToBlob, mutateState }`.
     - On success: `rerender()` (the existing character page re-init), show status: `Imported "{name}"`.
     - On error (parse, validate, or commit): `uiAlert` with the error reason. Do NOT rerender (state is unchanged per atomicity contract).

3. Wire both into `runCharacterAction(action)`:
   ```js
   } else if (action === "export") {
     await runExportCharacterAction();
   } else if (action === "import") {
     await runImportCharacterAction();
   }
   ```

4. Disable "Export Character" when there is no active character (same pattern as the existing add-npc/add-party buttons).

**Tests to write:** Menu items render in correct order. Export button disabled when no active character. Import handler rejects non-JSON files gracefully. (Playwright smoke tests for the actual file picker flow can be added to the smoke suite — the unit tests should focus on the handler logic with mocked file inputs.)

---

## Task 4 — Import confirmation and user feedback

**Files:** `js/pages/character/characterPage.js`

1. The import handler in Task 3 uses the two-phase API from Task 2:
   - First call `parseAndValidateImport(file)` to get the validated object.
   - Show a confirmation dialog using the character's name from the parsed object:
   ```
   Import "Thorin Oakenshield" into this campaign?

   - A new character will be added to this campaign.
   - Linked card connections from the original campaign are not imported.
   ```
   Use the existing `uiConfirm` helper.
2. If the user cancels → no state changes, no status message, no blob stored.
3. If confirmed → call `commitImport(parsedObject, deps)`, then show success status: `Imported "{name}"`.
4. If `commitImport` throws, show the error via `uiAlert` and do NOT rerender (state is unchanged per the atomicity contract).

**Tests to write:** Cancel on confirm → no state mutation, no blob stored, no notes written. Confirm → normal import flow completes. Error during commit surfaces to the user without rerendering.

---

## Task 5 — Edge case handling and hardening

**Files:** `js/domain/characterPortability.js`, tests

Defensive cases to verify with explicit tests:

1. **Malformed character object**: `character` present but missing required fields. Should fail validation cleanly.
2. **Future format version**: `formatVersion: 2`. Reject with "This file was created by a newer version of Lore Ledger."
3. **Unknown type**: `type: "something-else"`. Reject with "This is not a Lore Ledger character file."
4. **Oversized file**: Files above some sensible limit (say 10MB) should be rejected before parsing to avoid UI hangs. The main concern is a pathologically large embedded portrait.
5. **Portrait data URL doesn't match mimeType**: Low priority — tolerate silently, use whatever the data URL header declares.
6. **Duplicate character name already in campaign**: Allow it. Names are not unique keys; IDs are. Do not block or modify.
7. **Non-string ID in imported file**: Generate a new ID regardless (we always do this anyway per Decision 6), so this is harmless.
8. **`characters.entries` is missing/null in current state**: Defensive — initialize if needed before pushing.

**Tests to write:** One test per edge case. These are the tests that catch real-world file corruption and version skew.

---

## Task 6 — File size guard and user feedback

**Files:** `js/pages/character/characterPage.js`, `js/domain/characterPortability.js`

1. Add `MAX_IMPORT_FILE_SIZE = 10 * 1024 * 1024` (10MB) constant in `characterPortability.js`.
2. In `runImportCharacterAction`, check file size before reading. If over limit, `uiAlert` with "Character file is too large. Please check that this is a valid Lore Ledger character file."
3. Document the limit in a JSDoc comment — it's a UX/safety guard, not a hard architectural constraint.

**No tests needed** for this — it's UI-level defensive handling. Can be covered by a smoke test if desired.

---

## Task 7 — Documentation

**Files:** `docs/storage-and-backups.md` or a new `docs/character-portability.md`, `CHANGELOG.md`

1. Document the export file format so future-you (or someone else) can parse these files with or without the app.
2. Document the field-level rationale: why `imgBlobId` is rewritten on import, why spell notes are bundled and re-keyed on import, why linked cards don't travel, why the `formatVersion` tag exists, and why notes are written last (non-atomic with character commit).
3. Update `CHANGELOG.md` with the new feature under `[Unreleased] → Added`.

---

## Done criteria

- All existing tests pass (`npm run test:run`).
- New portability tests pass.
- Build succeeds (`npm run build`).
- Can export the active character → downloads a `.ll-character.json` file with the expected shape (character, portrait, spellNotes).
- Can import that same file back into any campaign → a new character appears with a new ID, portrait, all fields, and spell notes re-keyed to the new campaign.
- Round-trip export → import → export produces equivalent output (modulo IDs, which are regenerated).
- Import with no portrait works.
- Import with no spell notes works.
- Import of malformed file shows a clear error without mutating state.
- Import confirmation dialog explicitly mentions what is NOT imported (linked cards).
- A failure in spell-notes writing does NOT roll back the successfully-imported character.
- Step 3 (rules engine / character builder) remains future work.

---

## Future considerations (not in scope for Step 4)

- **Batch export:** Export all characters in a campaign at once. Out of scope per the design doc.
- **Character template library:** A way to save characters as reusable templates. Out of scope.
- **Shareable character URLs:** Beyond the scope of a local-first PWA; would require a backend.
- **Import as a tracker card directly:** The current flow always adds to the character collection. A future enhancement could allow importing straight to an NPC/Party card with an auto-link.
- **Atomic spell-notes commit:** Currently notes write is best-effort (post-atomic-boundary). If user feedback shows partial-notes imports are confusing, this could be promoted into the atomic block with proper rollback.

---

## Risk notes

1. **Blob cleanup on partial failure is the main reliability risk.** The `putBlob` → state mutation sequence must either both succeed or neither leaves a trace. Follow the `backup.js` pattern closely. Write tests that specifically simulate `putBlob` success + mutation failure to prove the cleanup path works.

2. **JSON parse of untrusted input.** The file is user-supplied. Large files should be size-gated (Task 6). Any property in the parsed object could be a hostile value — validation must be strict and explicit. Do not spread user-supplied objects into state without going through `prepareImportedCharacter`.

3. **The `CharacterEntry` shape will grow over time.** When Step 3 adds `build` and `overrides` fields, old export files (v1) will not have those fields. The import path must tolerate missing fields — treat them as defaults, not errors. This is why `formatVersion` exists, but it's also why defensive defaulting inside `prepareImportedCharacter` matters.

4. **Portrait data URLs can be large.** A typical character portrait is 50-500KB base64-encoded. A high-resolution one could be several MB. The 10MB file limit is generous but catches pathological cases.

5. **Spell notes are written outside the atomic boundary.** This is a deliberate design choice (see Task 2 ordering rationale), but it means a user could end up with a successfully-imported character whose notes are partially missing. The success status message should be neutral ("Imported \"{name}\"") rather than implying notes are guaranteed. Claude Code's test for notes-write failure should assert the character is still present, not rolled back.

---

## Dependency graph

```
Task 1 (pure serialization/validation)
  ↓
Task 2 (IDB integration + import orchestration)
  ↓
Task 3 (UI menu + export handler + import handler) ← depends on Task 2
  ↓
Task 4 (import confirmation dialog) ← refines Task 3
  ↓
Task 5 (edge cases) ← can be done in parallel with Task 4
  ↓
Task 6 (file size guard)
  ↓
Task 7 (documentation)
```

Tasks 1 and 2 are the foundation. Everything else builds on them. Tasks 5 and 6 are hardening; Task 7 is the paper trail.
