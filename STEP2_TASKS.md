# Step 2 — Character ↔ Tracker Card Linking: Task Plan

> **Step 2 is complete, audited, and fully verified as of 2026-04-15. Do not treat any item below as pending implementation work. See the [closeout section](#step-2-closeout--complete-2026-04-15) at the bottom for a summary of what shipped and what was intentionally deferred.**

Read `MULTI-CHARACTER_DESIGN.md` first for full context. This file is the ordered task list for Step 2.

Work one task at a time. Run `npm run test:run` after each task. Do not proceed to the next task if tests fail.

---

## Confirmed scope decisions

### Decision 1 — Location card linking: deferred to Step 2b

Location cards have `title` and `type`. Characters have `name`, `classLevel`, `hpCur`, etc. The field overlap is portrait and notes only. The "multiple windows into the same room" metaphor doesn't hold when the data shapes are fundamentally different. **This plan covers NPC and Party card linking only.** Location card linking can be revisited as Step 2b if desired.

### Decision 2 — Card notes: card-only, not linked

Card `notes` remain card-only. Tracker card notes serve a different purpose (combat notes, session reminders, DM-facing context) than character sheet personality notes. A linked card gets name, HP, portrait, class, and status from the character — the notes staying independent is intentional and useful. The `looseNotes` field proposed in the design doc is not needed for this step.

### Decision 3 — Schema version bump: yes (v4 → v5)

A proper migration is warranted:

1. `sanitizeForSave` needs to know about `characterId` so it doesn't strip it as unknown data.
2. Backup validation needs to accept the new field shape.
3. Defensive consistency with the established pattern — every shape change gets a migration with tests.

### Decision 4 — Character `status` field: added and linked

Characters gain a `status: ""` field. Status effects (Poisoned, Charmed, etc.) are character-level state — they should live on the character and be visible everywhere that character appears. Linked cards read/write status from the character entry.

### Decision 5 — Field name mismatches: handled by mapping layer, not renamed

Card fields use `hpCurrent` and `className`. Character fields use `hpCur` and `classLevel`. These names will **not** be renamed as part of Step 2. Reasons:

1. Renaming `hpCur` → `hpCurrent` requires a state migration to rename the persisted key in every user's saved data — real migration risk for a cosmetic change.
2. `className` and `classLevel` are arguably *correct* as different names — a card's "class" field is a freeform role label ("Bandit Captain", "Town Healer"), while a character's `classLevel` is a mechanical descriptor ("Wizard 5"). They're semantically different concepts that happen to be linked.
3. Combining a field rename with the linking feature in the same step violates one-concern-per-step. If something breaks, you won't know whether the rename or the linking caused it.

The mapping layer in `cardLinking.js` (Task 2) handles the translation cleanly. A standalone `hpCur → hpCurrent` rename can be considered as a future cleanup task after Step 2 ships.

---

## Linked fields mapping

This is the single source of truth for which card fields read from/write to the character entry when linked. Centralize this mapping in one module — every piece of linking code references it.

| Card field     | Character field | Notes                                          |
|----------------|----------------|------------------------------------------------|
| `name`         | `name`         | Direct match                                   |
| `className`    | `classLevel`   | Semantically different — mapping layer handles |
| `hpCurrent`    | `hpCur`        | Legacy naming — mapping layer handles          |
| `hpMax`        | `hpMax`        | Direct match                                   |
| `status`       | `status`       | New field on character (Task 1)                |
| `imgBlobId`    | `imgBlobId`    | Direct match                                   |

Card-only fields (never linked): `id`, `sectionId`, `group`, `collapsed`, `portraitHidden`, `notes`.

---

## Task 1 — State shape: add `characterId` to tracker cards

**Files:** `js/state.js`, `js/domain/factories.js`

1. Add `characterId: string | null` to `TrackerCardBase` typedef in `factories.js`. Set default to `null` in `makeNpc()` and `makePartyMember()`.
2. Add `status: string` to `CharacterState` typedef in `state.js`. Add `status: ""` to the default character state and to `makeDefaultCharacterEntry()` in `characterHelpers.js`.
3. Bump `CURRENT_SCHEMA_VERSION` from 4 → 5.
4. Add `migrateToV5()`: iterate all NPC and Party cards, set `characterId = null` if missing. Add `status = ""` to any character entries missing it. This migration is simple but establishes the version gate.
5. Update `sanitizeForSave` to include `characterId` when serializing tracker cards and `status` when serializing character entries.

**Tests to write:** Migration from v4 → v5 (cards gain `characterId: null`, characters gain `status: ""`). Round-trip: migrate → sanitize → migrate again should be stable. Existing v3 → v4 → v5 chain works.

---

## Task 2 — Linked card data resolution helpers

**Files:** new file `js/domain/cardLinking.js`

This is the centralized linking module. All linking logic lives here — no field-mapping knowledge should leak into rendering or event handling code.

1. Create `LINKED_FIELD_MAP` — the mapping table from the section above, as a code constant.

2. Create `resolveCardDisplayData(card, state)`:
   - If `card.characterId` is falsy or the character isn't found → return the card's own fields (standalone mode).
   - If linked and character found → return an object with linked fields read from the character, card-only fields read from the card.
   - Always returns a uniform shape regardless of linked status. Renderers don't need to know whether data is linked.

3. Create `writeCardLinkedField(card, field, value, state, deps)`:
   - If the card is linked and the field is in `LINKED_FIELD_MAP` → write to the character entry (via `mutateCharacter` or direct entry mutation).
   - If the card is not linked or the field is card-only → write to the card itself.
   - Returns `{ target: "character" | "card", written: boolean }` for caller awareness.

4. Create `snapshotLinkedFieldsToCard(card, state)`:
   - Copies current character values into the card's own fields.
   - Used when unlinking (character deletion or explicit unlink).
   - After snapshot, set `card.characterId = null`.

5. Create `linkCardToCharacter(card, characterId)`:
   - Sets `card.characterId = characterId`.
   - Does NOT copy character data into the card — the card's own fields become stale/backup.

6. Create `getLinkedCards(state, characterId)`:
   - Returns all NPC and Party cards where `card.characterId === characterId`.
   - Used by deletion flow to show warnings and perform snapshot.

**Tests to write:** `resolveCardDisplayData` with linked and unlinked cards. `writeCardLinkedField` targeting character vs card. `snapshotLinkedFieldsToCard` copies correctly and nulls `characterId`. `getLinkedCards` finds cards across both NPC and Party lists. Edge cases: orphaned link (character deleted but card still has `characterId` pointing to nothing) → falls back to card's own data gracefully.

---

## Task 3 — Card rendering updates (NPC cards)

**Files:** `js/pages/tracker/panels/npcCards.js`

1. Import `resolveCardDisplayData` from `cardLinking.js`.
2. In `renderNpcCard(npc)`, call `const display = resolveCardDisplayData(npc, state)` at the top. Use `display.name`, `display.className`, `display.hpCurrent`, `display.hpMax`, `display.status`, `display.imgBlobId` instead of reading directly from `npc.*`.
3. Update input event handlers to use `writeCardLinkedField` for linked fields. For example, the name input handler becomes:
   ```js
   nameInput.addEventListener("input", () => {
     writeCardLinkedField(npc, "name", nameInput.value, state, { SaveManager });
   });
   ```
4. Add a visual indicator for linked cards — a small icon or badge that shows this card is linked to a character. This helps users understand why editing a card also changes the character.
5. **Do not change** card-only field handlers (`sectionId`, `collapsed`, `portraitHidden`, `notes`). These always write to the card.

**Tests to write:** Render a linked NPC card — display data comes from character. Edit linked card name — character entry updates. Edit unlinked card name — card itself updates. Portrait resolves from character when linked.

---

## Task 4 — Card rendering updates (Party cards)

**Files:** `js/pages/tracker/panels/partyCards.js`

Same changes as Task 3, applied to Party cards. The Party card structure is nearly identical to NPC cards (minus the `group` field, which is card-only anyway).

1. Import `resolveCardDisplayData` and `writeCardLinkedField`.
2. Update `renderPartyCard(member)` to use resolved display data.
3. Update input handlers to use `writeCardLinkedField`.
4. Add linked card visual indicator.

**Tests to write:** Same edge cases as Task 3 but for Party cards.

---

## Task 5 — "Add to Party / NPCs" actions from character page

**Files:** `js/pages/character/characterPage.js`, `index.html`

1. Add "Add to Party" and "Add to NPCs" items to the character page sub-toolbar overflow menu (`#charActionDropdownMenu` in `index.html`).
2. Wire each action:
   - Get the active character via `getActiveCharacter(state)`.
   - Create a new tracker card via `makeNpc()` or `makePartyMember()` with `characterId` set to the active character's id.
   - Add the card to the appropriate tracker list via `addTrackerCard()`.
   - Show a confirmation toast/status: "Added to NPCs" / "Added to Party".
   - Stay on the character page (no navigation).
3. Disable these menu items when no active character exists.

**Implementation note:** The new card's own fields (`name`, `className`, etc.) should be populated with a snapshot of the character's current data. This ensures the card has fallback data if the link is ever broken. The snapshot is written once at creation time and then ignored while the link is active (rendering reads from the character).

**Tests to write:** Create linked NPC from character page — card appears in `state.tracker.npcs` with correct `characterId`. Create linked Party member — same. Verify card's own fields contain snapshot. Action disabled when no active character.

---

## Task 6 — Character deletion with linked cards

**Files:** `js/pages/character/characterPage.js`, `js/domain/cardLinking.js`

1. Update `runDeleteCharacterAction()` in `characterPage.js`:
   - Before deletion, call `getLinkedCards(state, activeCharId)` to find all linked cards.
   - If linked cards exist, show an enhanced warning dialog listing where the character appears: "This character has linked cards in: NPCs (2), Party (1). Linked cards will keep their last known data and become standalone."
   - On confirm: call `snapshotLinkedFieldsToCard()` for each linked card, then delete the character entry.
2. The snapshot-then-delete order is critical — snapshot copies character data into card fields, then `characterId` is set to null, then the character is removed from `entries[]`.

**Tests to write:** Delete character with linked cards — cards survive with snapshot data, `characterId` becomes null. Delete character with no linked cards — same as current behavior. Snapshot preserves name, HP, class, status, portrait correctly.

---

## Task 7 — Backup and import/export updates

**Files:** `js/storage/backup.js`

1. Update `collectReferencedBlobIds()`: when a linked card has a `characterId`, its portrait blob comes from the character entry, not the card. Avoid double-counting the same blob ID.
2. Update `validateIncomingStateShape()`: accept `characterId` on tracker cards.
3. Update `remapBlobIds()`: if a card is linked, its `imgBlobId` is on the character, not the card. Don't remap the card's stale `imgBlobId` — it's a backup snapshot field.
4. Test that importing a backup with linked cards preserves the links. Test that importing a legacy backup (no `characterId` fields) works via migration.

**Tests to write:** Export with linked cards → import → links preserved. Import legacy backup without `characterId` → migration adds it. Blob collection doesn't double-count shared portraits.

---

## Task 8 — Combat embedded panels awareness

**Files:** `js/pages/combat/combatEmbeddedPanels.js`

This task is likely minimal. Combat embedded panels already resolve the active character through `getActiveCharacter(state)`. However, verify:

1. If a character is added to combat via a linked tracker card (the "Add to Combat" button on a card), the combat participant should reference the character, not duplicate data.
2. The existing `addTrackerCardToCombatEncounter` function creates combat participants from card data. For linked cards, it should pull display data from the character (use `resolveCardDisplayData`).
3. Verify that HP changes in combat flow back to the character entry, not just the combat participant.

**Tests to write:** Add linked card to combat — participant data comes from character. HP changes in combat update the character entry.

---

## Task 9 — Visual polish and UX

**Files:** `styles.css`, `index.html`, card renderer files

1. Linked card indicator: a subtle icon (chain link or similar) in the card header row, visible when `characterId` is set. Tooltip: "Linked to [character name]".
2. Clicking the linked indicator could navigate to the character page with that character selected (stretch goal — defer if complex).
3. Ensure the "Add to NPCs" / "Add to Party" menu items are styled consistently with existing action menu items.
4. If a linked card's character no longer exists (orphaned link), show a subtle warning: "Character not found — showing last known data." Automatically unlink on next save to clean up.

**No tests for this task** — it's pure CSS/DOM polish.

---

## Done criteria

- All existing tests pass (`npm run test:run`).
- New linking/migration/backup tests pass.
- Build succeeds (`npm run build`).
- App loads with legacy data (no `characterId` on cards) and migrates cleanly.
- Can create a character, "Add to NPCs", and see the linked card render character data.
- Editing the linked card's name updates the character. Editing the character's name updates the linked card.
- Deleting a character with linked cards shows warning, snapshots data, unlinks cards.
- Deleting a linked card does not affect the character.
- Combat "Add to Combat" from a linked card works correctly.
- Backup export/import preserves links.
- Orphaned links (character deleted outside normal flow) degrade gracefully.
- Step 3 (rules engine / character builder) remains future work.
- Location card linking remains deferred to Step 2b.
- `hpCur → hpCurrent` rename remains a standalone future cleanup task.

---

## Future cleanup (not in scope for Step 2)

- **`hpCur` → `hpCurrent` rename:** A state migration to rename the persisted key. Low risk, but should be its own commit with its own test cycle.
- **Location card linking (Step 2b):** Requires defining what "linking" means for a card type with no HP, class, or status fields. May be portrait-only linking, or may need a rethink.
- **`looseNotes` field:** If card notes linking is desired later, add a `looseNotes` field to CharacterEntry and a corresponding UI section on the character page.
- **Explicit unlink action:** A way for users to manually unlink a card from its character without deleting either. Not needed for MVP but useful.

---

## Step 2 Closeout — Complete (2026-04-15)

### Shipped

- **NPC and Party card linking** — `characterId` field on tracker cards; `resolveCardDisplayData` and `writeCardLinkedField` write-through in `js/domain/cardLinking.js`.
- **Centralized linked-field mapping** — `LINKED_FIELD_MAP` in `cardLinking.js` is the single source of truth for which card fields read from/write to the character entry; no field-mapping knowledge leaks into renderers or handlers.
- **Schema v5 migration** — `migrateToV5()` adds `characterId: null` to all NPC and Party cards and `status: ""` to all character entries. `sanitizeForSave` updated accordingly.
- **Character deletion with linked cards** — warning dialog lists all tracker sections where the character appears; on confirm, `snapshotLinkedFieldsToCard()` copies character data into each card's own fields and sets `characterId: null` before the character entry is removed.
- **Backup/import/export** — `characterId` round-trips through export and import; legacy backups (no `characterId`) migrate cleanly via v5; blob collection does not double-count shared portraits.
- **Combat integration** — `addTrackerCardToCombatEncounter` uses `resolveCardDisplayData` for linked cards; HP changes in combat write back to the character entry.
- **Live-sync stabilization** — name, class/level, current HP, and status effects remain in sync across the Vitals panel, character sheet, and all linked tracker cards after back-to-back edits and navigation.

### Intentionally Deferred

- **Explicit unlink action** — a way for users to manually unlink a card from its character without deleting either; useful but not MVP.
- **Location card linking (Step 2b)** — location cards have a fundamentally different data shape (no HP, class, or status); deferred per Decision 1 in this doc.
- **Portrait-sync follow-up** — no known open issues post-Step 2; revisit if portrait blobs diverge after unlink or deletion edge cases surface.
- **Playwright/smoke test expansion** — new linking flows are covered by Vitest unit tests but not yet in the Playwright smoke suite.
- **`npcCards`/`partyCards` dedup refactor** — the two renderers share substantial structure; a future cleanup pass could extract a shared base without changing behavior.
- **`hpCur` → `hpCurrent` rename** — standalone cleanup task per Decision 5; no behavior change, separate migration and test cycle.

---

## Risk notes

1. **Card renderers are large files** (~500-800 lines each) with imperative DOM construction. The changes in Tasks 3-4 touch the rendering hot path. Keep diffs minimal — the `resolveCardDisplayData` abstraction should let you swap field sources without restructuring the DOM builders.

2. **Write-through needs careful testing.** The card input handlers currently call `updateNpc(id, patch)` which patches the card object directly. For linked cards, writes to linked fields need to go to the character entry instead. The `writeCardLinkedField` helper centralizes this, but every input handler needs to be updated.

3. **The incremental DOM patcher (`cardIncrementalPatchShared.js`) needs awareness.** The existing patch system compares card field values to detect changes. For linked cards, the "current value" comes from the character, not the card. The patcher may need to resolve display data before diffing.

4. **Portrait sharing.** Multiple linked cards can share one character's portrait. This means blob cleanup on card deletion must NOT delete a blob that other cards or the character still reference. The existing `deleteTrackerCardWithBlobCleanup` needs a guard: if the card is linked, don't touch the blob (it belongs to the character).

---

## Dependency graph

```
Task 1 (state shape)
  ↓
Task 2 (linking helpers)
  ↓
Task 3 (NPC rendering) ← can parallelize with Task 4
Task 4 (Party rendering) ← can parallelize with Task 3
  ↓
Task 5 ("Add to" actions) ← depends on Tasks 1-2 minimum
  ↓
Task 6 (deletion flow) ← depends on Task 2
  ↓
Task 7 (backup) ← depends on Task 1
  ↓
Task 8 (combat) ← depends on Tasks 2-3
  ↓
Task 9 (polish) ← last
```

Tasks 1 and 2 are the foundation. Everything else builds on them.
