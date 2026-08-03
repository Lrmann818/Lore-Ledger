# Restore Character & Pre-Level-Up Snapshots — Implementation Spec

_Status: **normative specification, ratified by owner decision 2026-07-18.
Phase R1 (schema v13 + transactional pre-Level-Up snapshot capture) was
owner-authorized and shipped 2026-07-18. Phase R2 (the non-UI restore engine)
was owner-authorized and shipped 2026-07-22. Phase R3 (the user-facing Restore
Character UI — restore-only) was owner-authorized and shipped 2026-07-22. Phase
R4 (backup asset completeness) was owner-authorized and shipped 2026-07-24** —
see the implementation notes in §2.3, §3.2, §3.3, §4.2, §5, §6, §7, and §8. Owner
decisions D1–D4 are ruled (audit doc §3). **Snapshot deletion is deferred to a
separately authorized future phase — it is NOT part of R3 and is NOT assigned to
R4/R5/R6.** **R5–R6 remain gated on explicit owner authorization** per §9 and
the binding [Working Order](../../AGENTS.md#current-working-order): R1 creates and
preserves snapshot history, R2 provides the domain engine, R3 exposes restore
(never delete) through an accessible, mobile-safe, persistence-confirming dialog,
and R4 makes full backups carry the external assets a retained snapshot owns._

Read with [`AGENTS.md`](../../AGENTS.md),
[`level-up-flow-spec.md`](./level-up-flow-spec.md),
[`character-calculation-contract.md`](./character-calculation-contract.md), and the
dependency audit at
[`docs/audits/edit-in-builder-retirement-audit-2026-07.md`](../audits/edit-in-builder-retirement-audit-2026-07.md).
Reference-app screenshots informed only the *existence* of a restore menu entry, a
dated snapshot list with per-row deletion, and restored copies appearing in the normal
character list — per the AGENTS.md screenshot rules, all visual design, wording, and
interaction below is Lore Ledger's own.

## 1. Product contract

1. Immediately before a **valid Level Up commits**, Lore Ledger saves one complete
   snapshot of the character's pre-Level-Up state. Opening or canceling Level Up never
   creates a snapshot. Snapshot + Level Up commit persist as one transaction.
2. **Restore Character** (exact user-facing label) lists saved snapshots and restores
   a selected one as a **separate playable character** with a new stable ID. It never
   overwrites or mutates the current character or the source character. The snapshot
   survives and may be restored repeatedly.
3. Snapshots are retained per successful advancement — all of them. No shipped path
   deletes a snapshot: user-initiated per-snapshot deletion (and any automatic
   retention/pruning) is deferred to a separately authorized future phase (§5).
   Deleting a playable character does not delete its snapshots; a future snapshot
   deletion would not delete characters restored from it.
4. Either playable version may later be deleted through the normal character deletion
   flow.
5. Restore is **not** destructive to current characters; its confirmation says a
   separate copy will be created and nothing existing will change. (Snapshot deletion,
   when a future phase adds it, would be destructive and confirm accordingly — but it
   is not part of R3, §5.)

## 2. Data model (Phase B)

### 2.1 Where snapshots live — `state.characters.snapshots`

```js
characters: {
  activeId: string | null,
  entries: CharacterEntry[],
  snapshots: CharacterSnapshot[]     // NEW — campaign-scoped, schema v13
}
```

Why this location (alternatives audited):

- **Campaign-scoped sibling of `entries` (chosen).** Survives source-character
  deletion by construction; travels through every persistence surface the characters
  collection already travels through — verified at HEAD `47a0439`:
  `sanitizeForSave` shallow-copies the container preserving extra keys
  (`js/state.js:941-948`), `extractCampaignDoc` clones `sanitized.characters`
  wholesale (`campaignVault.js:202`), `projectActiveCampaignState` feeds the doc back
  through `migrateState`, which normalizes `data.characters` **in place**
  (`migrateToV4`, extra keys preserved), `replaceRuntimeState` /
  `replaceStateBuckets` assign the whole object, and full backups export
  `sanitizeForSave(state)` verbatim. Each of those paths still gets an explicit
  round-trip test (the `state.content` vault-drop bug, matrix #14, is the lesson:
  "happens to survive" must become "pinned by tests").
- **Character-embedded history — rejected.** Dies with character deletion (violates
  the owner contract), bloats every entry write, and invites recursive nesting.
- **Separate top-level bucket / separate storage — rejected.** Requires touching
  `CampaignDoc`, vault extract/project/replace, and backup include-lists in lockstep —
  the exact multi-surface shape that dropped `state.content`. IndexedDB storage would
  additionally break the single-write Level Up transaction (§4).

### 2.2 Normative snapshot record

```js
/**
 * @typedef {{
 *   id: string,                    // "csnap_<ts36>_<rand36>", unique in the campaign
 *   kind: "pre-level-up",          // capture-reason vocabulary; closed set, additive-only
 *   sourceCharacterId: string,     // provenance; NOT required to still exist
 *   sourceName: string,            // display fields frozen at capture time:
 *   classSummary: string,          //   e.g. "Ranger 4" / "Sorcerer 11, Ranger 5"
 *   fromLevel: number,             // total level captured
 *   toLevel: number,               // the Level Up transition it preceded
 *   toClassId: string,             // class chosen for the new level
 *   createdAt: string,             // ISO timestamp; injectable clock for tests
 *   schemaVersion: number,         // state schema at capture (informational; see §3.2)
 *   payload: CharacterEntry        // full canonical character record, verbatim deep copy
 * }} CharacterSnapshot
 */
```

- `payload` is the plain deep copy the Level Up apply path already builds
  (`beforeSnapshot`, `characterPage.js:415`) — the **canonical playable character
  record only**. Verified non-members: combat encounter state (participants reference
  tracker cards, not characters — `js/domain/combat.js` source refs), tracker cards
  (link by `characterId`; card data is card-owned), workspace/UI layout, campaign
  content. Character-owned play-state (`rest`, `deathSaves`, conditions, resources,
  calc blocks, `builderSeed` markers) is part of the record and **is** captured.
- **No recursion by construction:** snapshots live outside entries, so a payload can
  never contain snapshots. Normalization additionally strips any `snapshots`-shaped
  key found on a payload (defense against hand-edited imports).
- `classSummary` is derived at capture from `getClassLevelTotals()` + registry names,
  ordered by first-taken class — the same derivation the sheet's class/level label
  uses, frozen as text so the list renders without a registry lookup and survives
  custom-class deletion.

### 2.3 Schema v13 migration — **implemented (R1, 2026-07-18)**

- `SCHEMA_MIGRATION_HISTORY` v13: "Added the campaign-scoped pre-Level-Up character
  snapshot collection (characters.snapshots) for the Restore Character feature."
- `migrateToV13()` (registered in `SCHEMA_MIGRATIONS` and the invariant re-run
  tail) delegates to `normalizeCharacterSnapshots()` in
  `js/domain/characterSnapshots.js` — the single normalization source of truth:
  guarantees an array; drops non-object records and records missing `id`, `kind`,
  `sourceCharacterId`, or a plain-object `payload`; de-duplicates ids (first wins);
  normalizes scalars defensively; strips recursive `payload.snapshots` data;
  preserves unknown extra fields on valid records; never invents snapshots for
  existing characters (no retroactive capture for historical Level Ups).
- `makeDefaultCharacterEntry` is untouched — snapshots are not an entry field.
- Pinned by `tests/characterSnapshots.test.js` (migration, sanitization, vault
  save→reload→re-persist, backup-envelope round trip, old-doc/old-backup
  compatibility) plus a real-`importBackup` retention test in
  `tests/storage.backup.test.js`.

## 3. Identity and restoration (Phase C)

### 3.1 ID map — what changes, what must not

| ID | Scope (verified) | On restore |
| --- | --- | --- |
| `character.id` | Global — tracker `card.characterId`, `characters.activeId`, portability | **New id** via the `makeDefaultCharacterEntry` generator (`char_…`) |
| Spell **row** ids (`spells.levels[].spells[].id`) | Character-local **but** they key external IndexedDB note texts: `spell_notes_<campaignId>__<rowId>` (`texts-idb.js:27-32`) | **Regenerate**, and copy each existing note text to the new key (§3.3). Keeping them would share mutable note storage between source and copy — a same-campaign hazard the cross-campaign import never faced. |
| `imgBlobId` | External IndexedDB blob, shared-mutable | **Duplicate the blob** at restore (`getBlob` → `putBlob` → new id). Missing blob → `null`, restore proceeds (fail-soft). |
| Spell-level ids, `attacks[].id`, `resources[].id`, `inventoryItems[].id`, `manualFeatureCards[].id`, `featureUses` keys, `builderSeed` markers, calc blocks, `build.*` content ids | Character-local; identify user-owned rows and seed provenance | **Keep verbatim.** Regenerating would break re-seed dedup (`builderSeed`), resource growth matching, and feature-use linkage — do not regenerate blindly. |
| `rest.preparedByClass` / `build.spellcasting` ids | SRD/custom **content** ids, not row ids | Keep verbatim. |

Custom-content references resolve against the same campaign registry — no bundling
needed for same-campaign restore. A custom record deleted since capture degrades soft
with derivation warnings (matrix #17 behavior), never blocks restore.

### 3.2 Restore pipeline (pure preparation, then committed)

1. Deep-clone the snapshot `payload`.
2. **Migrate-through:** run the clone through `migrateState({ characters: { activeId:
   null, entries: [clone] } })` and take the resulting entry. This applies every
   current and future per-entry migration to old payloads with zero ongoing
   maintenance — the stored `schemaVersion` stays informational. (Future-version
   payloads from a newer-app backup pass through untouched, matching `migrateState`'s
   existing forward-compatibility stance.)
3. Assign the new `character.id`; regenerate spell row ids recording an
   old→new map; set `imgBlobId` to the staged duplicate (or null).
4. Stamp provenance on the open entry shape (persists with no schema change, the
   `builderSeed` precedent): `restoredFromSnapshotId`, `restoredFromCharacterId`,
   `restoredAt` (ISO).
5. Apply collision-safe naming (§3.4).
6. Commit (§3.3).

**As-built (R2, 2026-07-22):** `prepareRestoredCharacter()` in
`js/domain/characterSnapshots.js` implements steps 1–5 as one pure function
(`migrateState` is injected to keep the domain module free of a `state.js`
import cycle; id/row-id/clock factories are injectable for tests and default to
the canonical generators). Implementation notes:

- Validation rejects — without creating anything — a missing/absent snapshot
  record, a blank snapshot id, any `kind` other than `pre-level-up`, a missing
  `sourceCharacterId`, a missing/non-object/uncloneable `payload`, a payload
  that cannot migrate into a plain character entry, and a record with no usable
  pre-Level-Up level (no finite `fromLevel ≥ 1` and no derivable build levels).
- The stored `schemaVersion` is forwarded on the migration wrapper solely so
  future-version payloads keep `migrateState`'s pass-through stance; for every
  current or past version the invariant re-run tail makes the outcome identical
  with or without it (the field stays informational).
- The new character id is collision-checked against all existing entry ids
  **and** the source character id (tracker cards may still reference a deleted
  source); regenerated spell-row ids are collision-checked against every live
  row id in the campaign **and every row id referenced by a retained snapshot
  payload** (2026-07-22 correction: a deleted source's snapshot may be the
  only remaining owner of a note key), so a staged note copy does not
  overwrite — nor its rollback delete — a note the restore does not own. The
  only residual exposure is a raw id-generator collision (two independently
  generated `spell_…` ids happening to match), the same low-probability class
  the app already tolerates for every generated id; deterministic application
  flows cannot introduce a staged id into another owner's storage.
  `restoreCharacterFromSnapshot` supplies the complete retained-snapshot
  collection to preparation as this reservation context. Both allocators
  retry a bounded number of times, then fail the preparation.
- All other character-local ids (§3.1 table) are preserved verbatim by simply
  not touching them — the payload clone is the restored character.
- Unknown extra fields on the snapshot record stay on the record; they are
  never copied onto the restored character.

### 3.3 Commit protocol (mirrors `commitImport`, `characterPortability.js:507-616`)

Async staging **before** state mutation, rollback on failure:

1. Stage the portrait duplicate (`putBlob`); on later failure, delete the staged blob.
2. Snapshot `state.characters` (plain clone) for rollback.
3. `mutateState`: push the prepared entry, set `characters.activeId` to it. On throw:
   restore the characters snapshot, delete staged blob, surface the error, abort.
4. `SaveManager.markDirty()`.
5. Copy spell-note texts: for each old→new row id with a non-empty
   `spell_notes_<campaignId>__<oldId>` record, `putText` under the new key —
   **fail-soft with a console warning** (identical to `commitImport`'s note
   handling); the restore is already committed and notes are prose, not rules-state.
6. `notifyActiveCharacterChanged`, rerender, success status.

Spell-note texts are copied at their **current** value, not their capture-time value —
same-campaign notes are shared side-storage that keeps evolving, and capturing them
would force async IndexedDB reads inside the Level Up commit (§4 forbids that).
Documented behavior, not an accident: the snapshot freezes the canonical record;
external prose rides along at restore time.

**As-built (R2, 2026-07-22):** `commitRestoredCharacter(staged, deps)` in
`js/domain/characterSnapshots.js` implements this protocol with these
deliberate strengthenings over the outline above (the header's "staging before
state mutation" principle applied uniformly):

- **Two rollback clones: an early capability gate, then a fresh pre-mutation
  clone** (2026-07-22 corrections). The commit first clones and validates
  `state.characters` **before** the portrait or any note is staged — not in
  outline step 2's position after portrait staging. If the collection cannot
  be cloned into a valid plain collection (cyclic or malformed), the restore
  aborts immediately with nothing staged and nothing mutated, so
  `state.characters` is never replaced with `null` or another invalid value.
  That early clone is only a **capability gate** and the baseline for the
  row-id recheck below; **rollback itself uses a second clone taken fresh
  immediately before the mutation, with no `await` between the fresh clone and
  the synchronous `mutateState()`.** This closes a freshness window: a
  legitimate `state.characters` mutation that lands during the awaited
  portrait/note staging is preserved on rollback rather than erased by the
  stale commit-entry clone. If the fresh clone is unavailable (the collection
  turned cyclic/malformed during staging), the commit deletes the staged
  records and aborts before mutating — existing state stays untouched.
- **Staged spell-row ids are re-checked immediately before staging**
  (2026-07-22 correction). The staged new row ids are compared against the
  current live entries **and retained snapshot payloads**; if state changed
  between preparation and commit and a collision now exists, the commit
  aborts before any external write or state mutation. A fresh preparation
  retries safely.
- **Note copies are staged in step 1½, before the state mutation**, not after
  it. The regenerated keys are unreachable until the entry is appended, so
  staging them early is safe — and it upgrades the guarantee from "committed
  restore with warned-and-missing notes" to "a note-copy failure aborts the
  restore with no restored character at all" (staged records are deleted on
  abort). A **missing** source note still fails soft (the row simply has no
  note); only read/write **failures** abort. This note-error contract — a
  missing note record fails soft, an actual note read/write **storage error**
  aborts the entire restore — is **owner-ratified (2026-07-22)**, not merely
  as-built. Portrait semantics are unchanged: missing source blob → `null` and
  proceed; a blob read/write failure aborts before anything else is staged.
- **The domain commit does not activate the restored character.** `activate`
  defaults to false so a domain-only restore never silently changes
  `characters.activeId`; the R3 UI passes `activate: true` to get the §7
  activation behavior. Rollback restores the whole characters collection either
  way.

Further commit details: a staged result carries a `committed` latch and the
mutation re-checks the entry id, so one staged restore can never append twice;
the restored name is re-resolved against the live entries inside the mutation
(collision safety holds even if entries changed between prepare and commit);
`SaveManager.markDirty()` queues the persist, and a later vault-write failure
follows the SaveManager ERROR contract — the vault write is one atomic
`localStorage.setItem`, so no partial restore can persist, and staged IndexedDB
records are then referenced only by the unpersisted in-memory entry (after a
reload they are unreachable orphans, the same exposure class as
`commitImport`'s staged blob). `restoreCharacterFromSnapshot()` is the
resolve → prepare → commit orchestrator the R3 UI is expected to call.

### 3.4 Naming

Audited conventions: character import keeps names verbatim; only default names
("New Character") exist as generated names; no numeric-suffix convention exists yet.
Adopting the owner's conceptual default with the repo's em-dash style:

- Default: `<sourceName> — Restored Level <fromLevel>` (e.g. `Gail — Restored Level 4`).
- Collision (case-insensitive, trimmed, against all current entry names): append
  ` (2)`, ` (3)`, … first free suffix. Deterministic, pure, unit-tested.
- The name is an ordinary editable field afterward.

**As-built (R2, 2026-07-22):** `resolveRestoredCharacterName()` implements the
collision rule. Documented fallbacks: a blank `sourceName` falls back to the
migrated payload's own `name`, and a blank there falls back to
**"Unnamed Character"** (the character selector's blank-name display label), so
the worst case is `Unnamed Character — Restored Level <N>`. `<N>` is the
snapshot's `fromLevel`; a normalized record that lost it derives `<N>` from the
migrated payload's build levels, and a record with neither fails preparation.
Names are never truncated (long names keep the full text plus suffix, matching
the app's no-max-length convention), and a source name that already contains a
restored suffix simply gains another (`Gail — Restored Level 2 — Restored
Level 2`) — the suffix is data, not parsed structure.

## 4. Level Up transaction (Phase D)

### 4.1 Guarantee available today (verified)

The whole campaign state persists as **one synchronous
`localStorage.setItem`** of the vault (`persistence.js:179` via `saveAllLocal`,
debounced behind `SaveManager.markDirty`). Anything mutated inside one
`mutateCharacter` callback persists in that single write — snapshot and leveled
character commit **atomically** with no new machinery, provided the snapshot append
happens inside the existing apply mutation. IndexedDB is *not* part of the Level Up
transaction (capture touches no blobs/texts), which is why capture stays synchronous.

### 4.2 Required commit order — **implemented as specified (R1, 2026-07-18)**

As-built: the capture lives inside the existing `onApply` mutation in
`js/pages/character/characterPage.js` — `buildPreLevelUpSnapshot()` constructs the
record (deep-cloned payload, injectable clock, registry-resolved class summary)
after validation and patch computation, `appendPreLevelUpSnapshot()` performs the
replace-append, and only then are the build and sheet patch assigned. The original
transaction order below is the contract it implements.

1. Wizard-side validation (`levelUpWizard.js:1109-1143`): `applying` re-entrancy
   flag + disabled Apply button (double-click protection), draft delta = exactly one
   level, required subclass present.
2. Page-side active-character guard (existing), then `mutateCharacter((character,
   state) => { … })`:
   a. Re-check `character.id === characterId` (existing).
   b. Build `beforeSnapshot` plain deep copy (existing; on clone failure → abort,
      nothing written).
   c. Validate the level delta (existing) — **all validation precedes capture**, so
      no-op, invalid, or level-cap attempts never create a snapshot.
   d. Compute the sheet patch (existing) and **construct the complete
      `CharacterSnapshot` record** (id, `kind: "pre-level-up"`, provenance fields,
      `classSummary`, `createdAt` from an injectable clock, `payload:
      beforeSnapshot`). Any throw up to here leaves state untouched.
   e. Ensure `state.characters.snapshots` exists; **replace-append** the record
      (§4.3); assign `character.build` and the patch. Steps (e) are plain-data
      assignments of precomputed values — the residual mid-callback-throw window is
      negligible and pinned by a "failed apply appends no snapshot" test.
3. One `markDirty` (existing), debounced flush → single vault write → snapshot and
   character persist together or not at all.
4. Rerender + success status only after the mutation returns true (existing).

### 4.3 Failure and edge semantics

- **Duplicate prevention.** `(kind, sourceCharacterId, fromLevel)` is unique per
  character by construction — Level Up only appends and down-leveling is ratified out
  of scope, so a character can never be at the same total level twice. The append still
  **replaces** any existing record with the same `(kind, sourceCharacterId, fromLevel)`
  as a belt-and-suspenders invariant; restored copies level independently under their
  own new ids and are unaffected. Temporary pre-R5 limitation (as implemented, R1):
  while Edit in Builder can still remove levels, re-crossing the same total level
  replaces that level's earlier snapshot; that window closes when Edit in Builder
  retires (phase R5).
- **Double submit.** Wizard `applying` flag + button disable + close-on-apply
  (existing); the level-delta validation makes a stale second apply fail before
  capture.
- **Save failure.** SaveManager enters ERROR with the export banner (existing).
  In-memory state holds snapshot + level-up consistently; localStorage still holds
  the pre-Level-Up state. Recovery is the existing contract: retry saves on next
  markDirty, or export a backup. No partial persist is possible. Pinned end-to-end
  by the forced vault-write-failure lifecycle test in `tests/characterPage.test.js`
  (2026-07-19 post-R1 review): nothing persists, the runtime vault cache keeps the
  pre-Level-Up vault (a failed attempt can never be committed later), live state
  keeps the pair together, reload yields the consistent pre-Level-Up state, and the
  retry commits snapshot + advancement atomically.
- **App interruption** between commit and flush: both changes are lost **together**;
  reload returns the consistent pre-Level-Up state.
- **Active-character change mid-flow:** existing double guard cancels without
  mutation → no snapshot.
- **Cancel / Escape / overlay click:** wizard close only → no snapshot.
- **Timestamps:** `new Date().toISOString()` behind an injectable `now` seam
  (the vault-helper precedent) so tests are deterministic.

## 5. Retention, deletion (Phase E, part 1)

- **Retention:** one snapshot per successful advancement; all retained; restore never
  consumes a snapshot. No automatic pruning — a future retention feature is a
  separate, explicitly designed change (the record's `kind` vocabulary and stable ids
  are the hooks it would need).
- **Snapshot deletion — DEFERRED (not part of R3).** Owner ruling 2026-07-22:
  **R3 is restore-only.** The Restore dialog ships **no** delete button, delete
  confirmation, retention control, automatic cleanup, or "also delete snapshots"
  option. User-initiated per-snapshot deletion is deferred to a **separately
  authorized future phase** and is **NOT** assigned to R4, R5, or R6. When that
  phase is authorized, its design intent (retained here for provenance only) is a
  per-row control in the Restore dialog with a destructive `uiConfirm` that
  identifies the snapshot fully — name, level, date — and states "Playable
  characters are not affected," keyboard-operable and 380px-safe, behaving
  identically when the source character is gone. Until then, snapshots are only
  created (R1), preserved, and restored (R3); nothing in the app deletes one.
- **Source-character deletion:** snapshots **remain by default** (owner requirement:
  independently useful). The existing delete confirmation gains one informational
  line when snapshots exist: "Saved Level Up snapshots are kept — you can still
  restore this character from Restore Character." Recommended v1 policy is **no**
  "also delete snapshots" checkbox (cleanup lives in the Restore dialog; one decision
  per dialog) — final call is owner decision D4 in the audit doc.
- Deleting a restored character never touches the snapshot it came from.

## 6. Export / import (Phase E, part 2)

- **Full campaign backup:** snapshots ride inside `characters` automatically
  (§2.1). The additions below make snapshots *fully* included rather than only
  structurally included — **implemented as R4, 2026-07-24**:
  - `collectReferencedBlobIds` walks `characters.snapshots[].payload.imgBlobId` so
    snapshot portraits export and survive the import cleanup pass.
  - `collectReferencedTextIds` walks snapshot payload spell rows so their note keys
    export and survive cleanup — while the source character lives these are the
    same keys; after source deletion the snapshot keeps them alive.
  - `remapIncomingSpellNoteTextIds` / `collectSpellIds` include snapshot payload rows
    so campaign-remapped note keys keep working.

  **As-built (R4, 2026-07-24):** all three walks share two private helpers in
  `js/storage/backup.js` — `getSnapshotPayloads()` (skips a non-array
  `snapshots` collection, non-object records, and records without a plain-object
  `payload`, so malformed optional data fails soft) and `getSpellRowIds()` (the
  one structured spell-row walk, now used by the live-entry, legacy-singleton,
  and snapshot-payload paths alike). Deduplication stays the collectors' `Set`.
  One addition beyond the outline above: `remapBlobIds` also rewrites
  `characters.snapshots[].payload.imgBlobId`, because import only preserves an
  incoming blob id opportunistically — without it a snapshot portrait collected
  by R4 could be staged under a new id and then referenced by a stale one
  (`docs/operations/storage-and-backups.md` §12 rule 9: rewrite *every*
  reference). No schema, state-shape, UI, or restore-behavior change.
- **Collisions:** none by construction — backup import **replaces** campaign state
  wholesale (`replaceStateBuckets`), it never merges. Snapshot ids, source ids, and
  payload row ids arrive as a consistent set. v13 normalization de-duplicates ids
  defensively on load.
- **Missing source characters** after import: valid state; the dialog shows the
  frozen `sourceName` with a "(character deleted)" annotation; restore works.
- **Backups with no snapshots** (all current backups): migrate to
  `snapshots: []` via v13 — full backward compatibility, nothing discarded either
  direction.
- **Custom-content dependencies:** unchanged — snapshots restore into the campaign
  whose registry travels in the same backup; soft degradation covers deletions.
- **Restored-character naming after import:** §3.4 runs at restore time against the
  post-import name set; no import-time renaming.
- **Single-character export (`.ll-character.json`):** format v1 deliberately excludes
  snapshots (it exports one playable character; adding history means a format-version
  bump and per-character snapshot filtering). Documented here as the reason required
  by the owner prompt; revisit only with an explicit format v2 decision.

## 7. UI & accessibility (Phase F) — **shipped as R3 (restore-only), 2026-07-22**

All of this uses Lore Ledger's existing overlay/dialog system (`uiConfirm`/`uiAlert`
stack above feature overlays, the `customContentManager`/`levelUpWizard` overlay
pattern) — no new modal framework (hard ban), no reference-app visual copying.
**R3 is restore-only: no delete control ships (§5).** The controller is
`js/pages/character/restoreCharacterDialog.js` (`initRestoreCharacterDialog`), wired
in `characterPage.js`; `groupSnapshotsForDisplay` is its pure grouping/ordering
helper. All restoration logic stays in the R2 engine — the dialog owns only
presentation, confirmation, the persistence lock, and finalization.

- **Menu entry:** `Restore Character` (`data-char-action="restore-character"`,
  `#charActionRestoreBtn`) in the character action menu directly after Level Up.
  Always enabled — with zero snapshots it opens the empty state, which teaches the
  feature better than a silent disabled item.
- **Dialog:** `#restoreCharacterOverlay` / `#restoreCharacterPanel`,
  `role="dialog" aria-modal="true"` labeled by the title "Restore Character".
  Focus-trapped (Tab/Shift-Tab wrap), defers to a stacked `#uiDialogOverlay`
  confirm/alert while one is open, overlay-click and Escape close **only before a
  restore has committed**, focus returns to the invoking menu button on an ordinary
  cancel. Panel scrolls internally; max-width narrower than the builder wizard;
  single-column at ~380px with no horizontal scroll.
- **Empty state:** "No snapshots yet. Lore Ledger automatically saves a snapshot of a
  character right before every Level Up. Level a character up and its pre-Level-Up
  state will appear here." (static markup in `index.html`).
- **Grouping (decision): grouped by source character**, not one flat chronological
  list. The reference app's flat list repeats "Yaan'wae, Sorcerer 3" ambiguously;
  grouping scales with many characters and costs one group-by plus headers.
  Group header: frozen `sourceName` (+ "(character deleted)" when the source id no
  longer resolves). Groups ordered by their newest snapshot, newest first; rows
  within a group by `createdAt` descending.
- **Row content:** primary line `Level <fromLevel> — <classSummary>`; secondary line
  a localized date & time plus `Before Level Up to <toLevel>`. Long names and
  multiclass summaries wrap (no ellipsis-only truncation at 380px); the full text is
  the accessible name.
- **Control per row:** a single real `Restore` `<button type="button">` with an
  explicit `aria-label` identifying the snapshot: "Restore <name>, level <N>,
  <date>". Standard Tab order; no custom arrow-key grid required. (No delete
  control — R3 is restore-only, §5.)
- **Restore confirmation** (`uiConfirm`, non-destructive tone, okText "Restore"):
  title "Restore \"<name>\" as it was at Level <N>?" body: "A separate playable
  character will be created. Existing characters will not be changed. The snapshot
  will remain available for future restores." Canceling has no side effects.
- **Submission guards:** the snapshot is re-resolved by id at submission time (never
  a stale row object); an active-campaign change since open aborts submission with a
  clear alert; an active-character change never redirects the restore (it is
  snapshot-addressed). One click equals one restore attempt — all Restore buttons
  disable while confirming/restoring/saving, so repeated clicks cannot start a second
  engine call.
- **Persistence-confirmation contract (owner-authorized 2026-07-22).** A resolved
  `restoreCharacterFromSnapshot()` means the restored character was committed **in
  memory** and a save was requested; it does not prove durable persistence. After the
  engine resolves, R3 calls `SaveManager.flush()` to confirm the save. A `false`
  result means "not confirmed" — a real storage error **or** a save already in
  progress; R3 never claims data loss. While unconfirmed, the dialog stays **locked
  open** in a pending-save state: it shows a clear message and a `Retry Save` action,
  blocks closing (close button, Cancel, Escape, overlay click) and any further
  restore, keeps the single committed pending restore intact, and **never re-invokes
  the engine** — `Retry Save` retries only `SaveManager.flush()`. Only once the save
  is confirmed does R3 finalize, exactly once and idempotently: close the dialog,
  call the active-character notification seam **once** with the captured previous id
  and the restored id, rerender into the now-active restored character, then — after
  the rerender, so it stays visible — set `#statusText` to `Restored "<new name>"`.
  Finalization suppresses focus restore (the invoking menu button is replaced by the
  rerender; do not focus a removed node).
- **Errors before commit:** validation/migration/note-storage/portrait-storage/
  mutation failures surface through `uiAlert` with the failure reason (no raw stack
  traces), leave existing characters and snapshots unchanged (engine guarantee, §3.3),
  keep the dialog open, and re-enable a fresh attempt. The ratified note-error
  contract (§3.3) holds: a **missing** spell note fails soft; an actual note read/write
  **storage error** aborts the restore with no restored character created.
- **Desktop:** same dialog, wider rows; no separate layout system.

## 8. Implementation phases and required tests

Each phase is a separate authorized batch: `npm run verify` + `npm run test:smoke`
green before commit; phases touching UI or smoke harnesses also run the
production-preview gate (`npm run build && npx playwright test --config
playwright.preview.config.js`) — both smoke gates are blocking per
`docs/operations/browser-smoke-status.md`.

- **R1 — Schema v13 + capture. ✅ Shipped 2026-07-18 (owner-authorized).**
  `js/state.js` (default, history, `migrateToV13`), the new
  `js/domain/characterSnapshots.js` (record builder, normalization, replace-append),
  capture inside the Level Up apply mutation (`characterPage.js`), injectable clock.
  Tests landed: `tests/characterSnapshots.test.js` (26 — builder/normalize/append,
  v12→v13 + malformed + recursion migration, sanitize, vault
  save→reload→re-persist, backup-envelope + old-backup round trips,
  source-deletion survival), capture coverage in `tests/characterPage.test.js`
  ("level up flow": capture-on-apply record shape + payload equality, deep-copy
  independence, no-capture on open/cancel/Escape/invalid/wrong-character,
  double-submit single capture, delete-keeps-snapshots, and — added by the
  2026-07-19 post-R1 review — the forced persistence-failure lifecycle over the
  real SaveManager + `saveAllLocal` pipeline: a failed vault write persists
  neither snapshot nor advancement and can never split the pair, and a failed
  apply leaves nothing live for a later unrelated save to commit), a real-`importBackup`
  retention test in `tests/storage.backup.test.js`, and end-to-end snapshot
  assertions (cancel-none / apply-one / reload-persists) in
  `tests/smoke/levelUp.smoke.js`. **R1 limitation (closed by R4, 2026-07-24):**
  snapshot *records* fully round-tripped, but backup bundling of snapshot-only
  external assets (portrait blob, spell-note texts once the source character is
  gone) was deferred to R4. Single-character export remains unchanged and
  excludes snapshots.
- **R2 — Restore engine. ✅ Shipped 2026-07-22 (owner-authorized).**
  `js/domain/characterSnapshots.js` gained the non-UI engine:
  `getCharacterSnapshotById` (resolution), `prepareRestoredCharacter` (pure
  migrate-through preparation, new identity, spell-row regeneration + note-copy
  map, provenance, §3.4 naming — as-built notes in §3.2/§3.4),
  `resolveRestoredCharacterName`, `commitRestoredCharacter` (staged
  portrait/note writes before the mutation, rollback, double-commit guard,
  no default activation — as-built notes in §3.3), and
  `restoreCharacterFromSnapshot` (the orchestrator for R3). Tests landed:
  `tests/characterSnapshots.restore.test.js` (40, then 49, now 51 — validation failures,
  v1/v12-payload migrate-through with byte-equal stored snapshots,
  future-version pass-through, id/name collision handling incl. blank/long/
  already-suffixed names, nested-id preservation vs. spell-row regeneration,
  note copies at current values with independent editability, portrait
  duplication + fail-soft, rollback on note/portrait/mutation failure with
  clean retry, double-commit guards, activation opt-in, sanitize + vault
  reload round trips, unpersisted-restore orphan unreachability). Verified
  2026-07-22: typecheck clean, 1291/1291 unit, both smoke gates 61/61, and a
  temporary preview-seam harness (deleted after the run) drove the real engine
  against the production build — restored copies accepted end-to-end across
  reload with independent note keys and no console errors.
  **2026-07-22 same-day narrow correction (owner-authorized):** spell-row id
  reservation extended to every retained snapshot payload (a deleted source's
  snapshot may be the only remaining owner of a note key) with the
  retained-snapshot context supplied by the orchestrator and a pre-staging
  commit re-check that aborts on prepare-to-commit collisions before any
  external write; an early capability clone of the characters collection is
  validated before any portrait/note write, aborting with nothing staged and
  nothing mutated when it cannot be — `state.characters` is never replaced
  with an invalid value (9 tests added, suite 49). A **follow-up correction
  the same day (owner-authorized)** closed a rollback-freshness window:
  rollback no longer uses that early commit-entry clone but a **second clone
  taken fresh immediately before the mutation** (no `await` in between), so a
  legitimate `state.characters` mutation landing during the awaited staging is
  preserved rather than erased on a restore-mutation failure; if the fresh
  clone is unavailable, the commit cleans up staged records and aborts before
  mutating (2 tests added, suite now 51). See the §3.2/§3.3 as-built notes.
  **R2 ships no UI: nothing calls the engine in production yet.**
- **R3 — Restore Character UI (restore-only). ✅ Shipped 2026-07-22 (owner-authorized).**
  `index.html` (menu item directly after Level Up + the `#restoreCharacterOverlay`
  dialog + static empty-state copy), new `js/pages/character/restoreCharacterDialog.js`
  (`initRestoreCharacterDialog` + the pure `groupSnapshotsForDisplay`), wiring in
  `characterPage.js` (menu action, bound engine `restore`, `flushSave`, and the
  finalize seam), the canonical `migrateState` threaded through `trackerPage.js` and
  `app.js` (plus `deleteText`), and additive `styles.css`. The dialog implements the
  phase model `idle → confirming → restoring → saving → pending-save → completed`,
  the persistence-confirmation / `Retry Save` lock (§7), submission-time
  campaign/snapshot re-checks, and one-time idempotent finalization. **Restore-only —
  no snapshot deletion UI (§5).** Tests landed: `tests/restoreCharacterDialog.test.js`
  (25 — grouping/ordering, empty-state copy + `index.html` markup pin, list rendering,
  deleted-source labeling, long-label wrapping without altering stored data,
  confirmation copy, cancel-no-mutation, engine receives `{ snapshotId, activate:true }`,
  active-character-change does not redirect, active-campaign-change prevents submission,
  vanished-snapshot refresh, one-engine-call for repeated clicks, pre-commit error keeps
  the dialog open, confirmed-save finalize, unconfirmed-save pending + `Retry Save`
  retries only flush + exactly one restored character, close/Escape/overlay/further-restore
  blocked after commit, no snapshot consumed, cancel focus restoration, Tab trap, and
  post-destroy inertness) and `tests/restoreCharacterWiring.test.js` (2 — the real
  character page supplies the full engine dep set incl. `migrateState`/`state`/
  `mutateState`/blob+text seams + `activate:true`, notifies once and shows
  `Restored "<name>"` on a confirmed save, and does neither on an unconfirmed save).
  The menu-order pin in `tests/characterPage.test.js` gained the `restore-character`
  entry. New `tests/smoke/restoreCharacter.smoke.js` (create Fighter 1 → level to
  Fighter 2 → restore the retained Level 1 snapshot → source stays Fighter 2, restored
  is Level 1 with a distinct id, snapshot retained, survives reload, second restore
  yields a `(2)` copy; keyboard/focus + Escape-before-submission; 380px no-overflow).
  Verified 2026-07-22: typecheck clean, 1329/1329 unit, `npm run build` clean, both
  smoke gates 64/64 (dev + production-preview). **No snapshot deletion, backup-collector,
  or Edit-in-Builder-retirement work shipped — those remain R4/R5 (unauthorized) and,
  for deletion, a separately authorized future phase (§5).**
- **R4 — Backup asset completeness. ✅ Shipped 2026-07-24 (owner-authorized).**
  `js/storage/backup.js` only: `collectReferencedBlobIds`,
  `collectReferencedTextIds`, `collectSpellIds` (and therefore
  `remapIncomingSpellNoteTextIds`), and `remapBlobIds` walk retained snapshot
  payloads through the shared `getSnapshotPayloads()` / `getSpellRowIds()`
  helpers — as-built notes in §6. Tests landed in
  `tests/storage.backup.test.js` (30 → 39): snapshot-payload portrait collection
  with a deleted source plus natural dedup, malformed/non-array snapshot
  fail-soft, snapshot-payload note-key derivation (campaign-scoped and legacy
  unscoped, with the legacy singleton fallback still intact), a full export
  bundling a portrait **and** a note owned only by a retained snapshot,
  import cleanup keeping snapshot-only blobs/texts alive while still deleting a
  genuinely unreferenced one, snapshot-only note keys remapping from the
  exported campaign id to the destination campaign id, and snapshot payload
  portrait remapping when the original blob id cannot be preserved. Verified
  2026-07-24: typecheck clean, 1340/1340 unit (1331 before), `npm run build`
  clean, `npm run test:smoke` 64/64. The production-preview gate was **not**
  required and was not run — R4 touches no UI, `index.html`, `styles.css`, or
  smoke-harness file. **No schema, state-shape, UI, or Restore Character
  behavior change; `.ll-character.json` still excludes snapshots; no snapshot
  deletion.**
- **R5 — Edit in Builder retirement.** Gated on owner decisions D1–D3 (audit doc §3).
  Remove E1–E6/M1–M3 per the audit, rework T1–T6 (new ability-change lever per D2),
  update creation-Summary copy, revise the governing docs listed in audit §1.6.
  Running in owner-authorized sub-batches:
  - **R5-A — base ability scores on the sheet. ✅ Shipped 2026-07-24.** D2 delivered
    through the existing Abilities & Skills `⋯` menu (no new flow); a same-day
    follow-up scoped the Character-page panel to `#page-character` so the Combat
    workspace's embedded copy cannot capture the menu on rerender.
  - **R5-B1 — structured required choices + banner + Complete Choices. ✅ Shipped
    2026-07-25 (owner-authorized).** D3's replacement for Edit in Builder's
    skipped-choice repair role. New pure `js/domain/rules/choiceCompletion.js` is the
    single traversal of `(build, registry)`, classifying each build-time choice as
    **required** (fixed legal count) or permitted **under-cap** (class cantrips, known
    spells, wizard spellbook); `getIncompleteChoiceSummaries()` became a thin formatter
    over it, so no second traversal exists. **Owner ruling: fixed-count language choices
    are required** — previously reported nowhere, they are the only intentional new
    Summary rows (all pre-existing non-language rows and ordering byte-identical, pinned
    by a frozen-baseline suite). The creation Summary splits required work from permitted
    under-cap counts. `#charIncompleteChoices` sits directly above `#charColumns`, outside
    every panel, derived from build data with no persisted UI flag, and opens
    `js/pages/character/completeChoicesFlow.js` / `#completeChoicesOverlay` — a focused
    dialog rendering **only** unresolved required choices through the shared wizard
    primitives, recomputing live (a resolved choice leaves; one it unlocks appears).
    Apply commits the draft build plus the additive `getBuilderFinishSheetSeedPatch` in
    one `mutateCharacter` (one dirty mark; a no-op Apply mutates nothing), with
    campaign/character isolation guards. Under-cap categories never raise the banner or
    appear in the dialog; prepared spells stay Long-Rest owned; a reached-but-unchosen
    subclass stays non-blocking at creation by ruling. Tests: `tests/choiceCompletion.test.js`
    (22), `tests/completeChoicesFlow.test.js` (31), extended `tests/incompleteChoices.test.js`
    (23) and `tests/characterPage.test.js`, `tests/smoke/completeChoices.smoke.js` (4).
    Verified: typecheck clean, 1421/1421 unit, build clean, both smoke gates 70/70.
    **No new persisted field and no schema change.** Applying Complete Choices does
    persist the completed selections in the existing `build` fields plus additively
    seeded sheet content — a code rollback is safe because no new schema exists, but
    those already-completed choices are valid user data and are not removed.
  - **R5-B2 — creation and Level Up under-cap opportunity + persisted acknowledgement.
    ✅ Shipped 2026-08-02 (owner-authorized).** Six production files. `choiceCompletion.js`
    remains the single traversal and count owner, gaining the thin
    `getUnderCapChoiceDescriptors()` accessor plus the acknowledgement model
    (`normalizeUnderCapAckLevels` / `hasUnderCapAckLevel` / `appendUnderCapAckLevel` /
    `getResultingCharacterLevel`), so both wizards cap against exactly the `allowed` the
    Summary counts against. **Creation** fixes the generic handler that enforced no cap at
    all on cantrip, known-spell, and spellbook lists: unchosen rows are disabled (and
    visibly muted) at the allowance while chosen ones stay removable, the change handler
    defends the cap against synthetic events, and the spellbook finally shows its maximum.
    **Level Up** evaluates the *resulting* build at the *resulting total character level*,
    so a shortfall from an earlier level is fillable — pickers cap at the resulting
    allowance with earlier picks locked as context, a class with no progression delta still
    gets a section when it carries a shortfall, and the Spells step becomes available for a
    shortfall alone. Finishing short stays legal but takes **one** explicit inline
    acknowledgement (`Finish Anyway` / `Apply Anyway`, focus moved to a `role="alert"`,
    keyboard-operable **Review spell choices** return, invalidated by any relevant change);
    creation evaluates the C2-B prepared confirmation together with it so one extra click
    covers both. **State owner: the optional `underCapAckLevels?: number[]` on the character
    entry** — a decision *about* a build, not a build choice — aggregated by resulting total
    level, append-only, deduplicated, ascending, written only inside the successful creation
    mutation or the single Level Up mutation that also appends the pre-Level-Up snapshot
    (one dirty mark, one rerender, snapshot transaction intact). **No schema version bump
    and no migration**; the field rides through sanitize, the campaign vault, full backup,
    `.ll-character.json` portability, and snapshot payloads because those carry entries
    whole. Malformed / duplicate / non-integer / negative / out-of-range data fails soft,
    nothing is inferred from a shortfall, prepared underfill is never mixed in, and Edit in
    Builder is excluded from the acknowledgement (but not from the cap fix). Tests:
    `tests/underCapChoices.test.js` (14), `tests/underCapCreation.test.js` (8),
    `tests/underCapLevelUp.test.js` (10), `tests/smoke/underCapChoices.smoke.js` (2), plus
    preservation cases in `tests/state.sanitize.test.js`, `tests/storage.backup.test.js`,
    `tests/characterPortability.test.js`, `tests/characterSnapshots.restore.test.js` and 10
    real-flow cases in `tests/characterPage.test.js`. **The stranded max-level shortfall it
    left open is now half-closed: the spellbook half shipped 2026-08-03 (below); the
    cantrip / known-spell half is still unbuilt and remains a hard gate before R5-C.**
  - **Max-level spellbook correction — "Add Spellbook Choices". ✅ Shipped 2026-08-03
    (owner-authorized).** The owner ruling of 2026-07-25 — that a permanently stranded
    level-20 spellbook shortfall is unacceptable, and that its correction must be
    **non-banner** and associated with the existing Spells surface — delivered. Six
    production files. The seam: at `MAX_CHARACTER_LEVEL` the Level Up menu item is
    disabled, `levelUpWizard.open()` refuses, and `getLevelUpPlan()` returns `null`, while
    Complete Choices renders only *required* choices by construction — so R5-B2's Level Up
    opportunity can never fire again and Edit in Builder was the last writer.
    The Character page's Spells panel header now carries a `⋯` **overflow menu** (the
    Abilities & Skills pattern through the shared `Popovers` system, with a fallback toggle
    when it is absent) holding **Add spell level** — the same element and single handler as
    before, relocated with no behavior change — and **Add Spellbook Choices**, which opens
    the focused `#spellbookChoicesOverlay` dialog owned by
    `js/pages/character/spellbookChoicesFlow.js`. Eligibility is three live conditions
    (builder character, total level at `MAX_CHARACTER_LEVEL`, ≥1 unsatisfied
    `UNDER_CAP_KIND.SPELLBOOK` descriptor), driven by registry-backed descriptors rather
    than a hard-coded `"wizard"`, with one section per eligible class. **The candidate
    ceiling is each class's own `maxSpellLevel` from `getPreparedSpellPlan()`, never the
    combined multiclass slot array** — a Wizard 1 / Cleric 19 has 9th-level combined slots
    and may still add only 1st-level wizard spells; prepared selections themselves are
    neither read as an authority nor written. Allowances and counts come from the same
    `choiceCompletion.js` descriptor the creation Summary counts against; options come from
    the existing `resolveSpellChoiceOptions()`. Apply re-checks character and campaign
    identity, level eligibility, and a freshly recomputed allowance/ceiling/candidate set,
    then **appends only** to `build.spellcasting[classId].knownIds` and assigns the new
    **spells-only** `getSpellbookAdditionSheetPatch()` (a sibling of
    `getLongRestPreparedSheetPatch()`, for the same C1.1 reason) in one mutation, one dirty
    mark, one rerender. **Absence and malformation are different answers.** A genuinely
    missing `spellcasting` root, or a missing class bucket inside it, is a legal state that
    eligibility already counts as `0 chosen`, so it is created inside the same transaction.
    A bucket that is *present but not a plain object*, or a present bucket whose `knownIds`
    is neither absent nor an array, refuses the whole Apply before any write rather than
    being created over: every class survives byte-for-byte, with no dirty mark, no rerender,
    no panel invalidation, and no success status. **No acknowledgement is involved:
    `underCapAckLevels` is neither read, written, cleared, nor used as a gate** — this flow
    reaches no new level.
    `rest.preparedByClass`, `preparedIds`, stored Long Rest state, `characters.snapshots`,
    the required-choice banner, Complete Choices, and unrelated build keys are
    byte-identical; **no schema change, migration, or new persisted field.** Derived
    prepared capacity is deliberately excluded from that list: `effectiveCapacity` is
    bounded by the candidate set and a wizard prepares from its spellbook, so a new
    spellbook entry legitimately raises it (§4.1) — a derivation, not a write.
    The Combat embedded Spells panel is unmodified: direct `+ Level`, no correction action,
    and it still shows the new canonical rows through the one shared `initSpellsPanel()`.
    Tests: `tests/spellbookChoices.test.js` (39), `tests/spellsPanelOverflowMenu.test.js`
    (23), `tests/spellbookChoicesWiring.test.js` (3), `tests/smoke/spellbookChoices.smoke.js`
    (2), and 11 new cases in `tests/builderSheetSeeding.test.js` (29 → 40).
  - **Max-level cantrip / known-spell correction — MANDATORY GATE, not authorized.** The
    same level-20 seam is still open for `UNDER_CAP_KIND.CANTRIPS` and
    `UNDER_CAP_KIND.KNOWN_SPELLS`; the spellbook batch deliberately did not generalize to
    them. This must be separately designed, placement-confirmed, authorized, and **shipped
    before R5-C removes Edit in Builder**.
  - **R5-C — the retirement itself (E1–E6/M1–M3, T1–T6). Not authorized, and blocked
    behind the max-level cantrip / known-spell correction above.**
- **R6 — Docs close-out.** Update `docs/state-schema.md` (v13 + snapshot record),
  `docs/operations/storage-and-backups.md`, `docs/features/multi-character-design.md`
  as shipped-behavior docs once each phase lands.

R1→R4 are sequential; R5 is independent of R2–R4 but must not precede R1 (the owner
contract requires the replacement path to exist before the old repair path is
removed — and D1–D3 resolved).

**The binding tail sequence** (owner ruling, restated 2026-08-03) is:

1. Max-level **spellbook** correction — ✅ shipped 2026-08-03.
2. Max-level **cantrip / known-spell** correction — separately designed and authorized.
3. **R5-C** — Edit-in-Builder retirement.
4. **R6** — shipped-behavior doc close-out.

Step 3 must not begin until step 2 has shipped: retiring Edit in Builder while a
max-level cantrip or known-spell shortfall is still unreachable would strand it
permanently, which is exactly what the 2026-07-25 ruling forbids.

## 9. Authorization

This specification is ratified product direction, not implementation authorization.
The [Working Order](../../AGENTS.md#current-working-order) records the decision and
the phase gate; each R-phase requires explicit owner authorization before code
changes. Completing one phase authorizes nothing further.
