# Step 1 Handoff Report — Multi-Character Support

**Date:** 2026-04-14  
**Branch:** Refactoring  
**Test suite:** 287 tests, all passing (`npm run test:run`)  
**Build:** Clean (`npm run build`)

---

## Completed Tasks

All 8 tasks from `STEP1_TASKS.md` are complete.

### Task 1 — State shape and migration (`js/state.js`)
- `CURRENT_SCHEMA_VERSION` bumped 3 → 4
- Added `CharacterEntry` and `CharactersCollection` typedefs
- Default state changed from `character: { ... }` to `characters: { activeId: null, entries: [] }`
- `sanitizeForSave()` updated to serialize `characters` instead of `character`
- `migrateToV4()` added: wraps legacy `character` data in the new collection, or produces `{ activeId: null, entries: [] }` if the character was empty/default
- `isCharacterMeaningful()` helper: determines if a legacy character has real user data (so it warrants wrapping as an entry)
- `migrateToV1()` and `migrateToV2()` guarded against re-running when `characters` already exists (idempotency)
- Re-apply block calls `migrateToV4()` to clean up any stale `character` key

### Task 1 (tests) — `tests/state.migrate.test.js`, `tests/state.sanitize.test.js`, `tests/stateActions.test.js`
- All three test files updated to use the new `characters` collection shape
- New file: `tests/state.characters.test.js` — 18 tests covering migration edge cases, idempotency, round-trip stability

### Task 2 — Vault and persistence layer (`js/storage/campaignVault.js`)
- `CampaignDoc` typedef: `character` → `characters`
- `extractCampaignDoc()`, `replaceRuntimeState()`, `projectActiveCampaignState()` all updated
- `collectCampaignSpellIds()` iterates `characters.entries[]` (with legacy `character` fallback)

### Task 3 — Backup import/export (`js/storage/backup.js`)
- `collectReferencedBlobIds()`, `collectReferencedTextIds()`, `collectSpellIds()`: iterate `characters.entries[]`
- `validateIncomingStateShape()`: accepts both `character` (legacy) and `characters` keys
- `replaceStateBuckets()`: copies `characters` instead of `character`
- `remapBlobIds()`: loops over `characters.entries[]` for portrait blob remapping
- Tests: `tests/storage.backup.test.js`, `tests/storage.persistence.test.js` updated

### Task 4 — `js/domain/characterHelpers.js` (new file)
- `getActiveCharacter(state)` — returns active `CharacterEntry` or null; fully defensive
- `getCharacterById(state, id)` — returns entry by id or null; fully defensive
- Tests: `tests/characterHelpers.test.js` — 20 tests

### Task 5 — Character page panels (8 files in `js/pages/character/panels/`)
- All 8 panels updated to import `getActiveCharacter` and resolve the active character at init
- If no active character exists, panels return early (null/noop) instead of crashing
- `state.character.*` reads → `char.*` (live reference to the entry object)
- `js/pages/character/characterPage.js`: removed legacy `state.character` pre-init guards, added `getActiveCharacter` import

### Task 6 — Combat embedded panels (`js/pages/combat/combatEmbeddedPanels.js`)
- `getVitalsEmbeddedViewModel`, `getSpellsEmbeddedViewModel`, `getWeaponsEmbeddedViewModel`: use `getActiveCharacter(state)` instead of `state.character`
- `tests/combatEmbeddedPanels.test.js`: updated to use `{ characters: { activeId, entries[] } }` shape via `makeStateWithChar()` helper

### Task 7 — Character selector sub-toolbar
- `index.html`: added `#charSelectorBar` with `#charSelector` (select element) and `#charMenuBtn` (⋯ button) inside `#page-character`
- `styles.css`: added `.charSelectorBar`, `.charSelectorSelect`, `.charMenuBtn` styles (compact, mobile-friendly)
- `characterPage.js`: `initCharacterSelectorBar()` — populates selector from `state.characters.entries`, wires selection change, builds overflow popover menu with New/Rename/Delete Character actions
- All CRUD actions call `rerender()` which re-calls `initCharacterPageUI(deps)` for a clean full reinit

### Task 8 — Empty state UX
- `index.html`: added `#charEmptyState` div (hidden by default) with Create/Not Now buttons
- `styles.css`: added `.charEmptyState`, `.charEmptyStateMsg`, `.charEmptyStateActions` styles
- `characterPage.js`: `initCharacterEmptyState()` — shows the prompt when `characters.entries` is empty; "Create Character" creates a blank entry and rerenders; "Not Now" dismisses

---

## Decisions Not in Design Doc

1. **Panels throw/return on null char**: Attack and Spells panels originally threw errors when no active character; changed to return `null` (graceful) to match the "render empty if no active character" contract.

2. **`rerender()` = full `initCharacterPageUI(deps)` reinit**: Rather than a targeted panel-refresh, character CRUD actions call `initCharacterPageUI(deps)` again, which leverages the existing destroy/reinit lifecycle. This is simpler and guarantees no stale state.

3. **Selector uses native `<select>`**: Chose a native `<select>` element over a custom tab/scrollable list for simplicity, accessibility, and mobile compatibility.

4. **Empty state dismissal is session-only**: "Not Now" hides the prompt in the current session only. No persistent flag is stored. If the user returns to the character page with empty entries, the prompt appears again. This is intentional for Step 1; Step 8 notes this as a potential future enhancement.

5. **`mutateState` in selector bar**: Character CRUD actions use `createStateActions({ state, SaveManager }).mutateState()` to go through the existing mutation/save machinery.

6. **Comments in `combatEmbeddedPanels.js` left as-is**: The module header comments still reference `state.character` — these are architecture notes and left unchanged to avoid noisy diff.

---

## Issues and Surprises

1. **Tasks 1–3 are tightly coupled**: Task 1 alone breaks the storage test suite because vault/backup still read/write `character`. All three had to be implemented atomically before running tests.

2. **`migrateToV1` idempotency bug**: The re-apply block calls `migrateToV1()` which creates `data.character = {}` via `ensureObj`. This stale key then confused `migrateToV4()`'s meaningful-check logic. Fixed by: (a) making `ensureObj(data, "character")` conditional on `!data.characters`, and (b) having `migrateToV4()` delete any stale `character` key when `characters` already exists.

3. **`characterPage.js` had no `createStateActions` import**: The file previously delegated all state mutations to the panels. Added the import for the new selector bar and empty state logic.

---

## Test Suite State

- **24 test files, 287 tests, all passing**
- New test files added:
  - `tests/state.characters.test.js` (18 tests — migration edge cases, round-trip)
  - `tests/characterHelpers.test.js` (20 tests — getActiveCharacter/getCharacterById edge cases)

---

## What's Next (Step 2 and beyond)

Per `MULTI_CHARACTER_DESIGN.md`:
- **Character import/export** (export single character, import into collection)
- **Level Up / Short Rest / Long Rest** (stub buttons in overflow menu are intentionally absent)
- **Add to Party/NPCs/Locations** from character sheet
- **Persistent dismissal flag** for empty state prompt
- **Character reordering** in the selector
- **Portrait per character** (already works — each `CharacterEntry` has its own `imgBlobId`)
