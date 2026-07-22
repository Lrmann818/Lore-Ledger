# Restore Character & Pre-Level-Up Snapshots — Implementation Spec

_Status: **normative specification, ratified by owner decision 2026-07-18.
Phase R1 (schema v13 + transactional pre-Level-Up snapshot capture) was
owner-authorized and shipped 2026-07-18. Phase R2 (the non-UI restore engine)
was owner-authorized and shipped 2026-07-22** — see the implementation notes in
§2.3, §3.2, §3.3, §4.2, and §8. Owner decisions D1–D4 are ruled (audit doc §3).
**R3–R6 remain gated on explicit owner authorization** per §9 and the binding
[Working Order](../../AGENTS.md#current-working-order); no restore, deletion, or
retirement UI exists yet — R1 creates and preserves snapshot history, and R2
provides the domain engine the R3 UI will call._

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
3. Snapshots are retained per successful advancement — all of them — until the user
   deletes one individually (or a future, separately designed retention feature).
   Deleting a playable character does not delete its snapshots; deleting a snapshot
   does not delete characters restored from it.
4. Either playable version may later be deleted through the normal deletion flow.
5. Restore is **not** destructive to current characters; its confirmation must say a
   separate copy will be created and nothing existing will change. Snapshot deletion
   **is** destructive and confirms accordingly.

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
  row id in the campaign so a staged note copy can never overwrite a live note.
  Both allocators retry a bounded number of times, then fail the preparation.
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
`js/domain/characterSnapshots.js` implements this protocol with two deliberate
strengthenings over the outline above (the header's "staging before state
mutation" principle applied uniformly):

- **Note copies are staged in step 1½, before the state mutation**, not after
  it. The regenerated keys are unreachable until the entry is appended, so
  staging them early is safe — and it upgrades the guarantee from "committed
  restore with warned-and-missing notes" to "a note-copy failure aborts the
  restore with no restored character at all" (staged records are deleted on
  abort). A **missing** source note still fails soft (the row simply has no
  note); only read/write **failures** abort. Portrait semantics are unchanged:
  missing source blob → `null` and proceed; a blob read/write failure aborts
  before anything else is staged.
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
- **Snapshot deletion:** per-row control in the Restore dialog only. Confirmation
  (destructive, via `uiConfirm`) identifies the snapshot fully — name, level, date —
  and states: "Playable characters are not affected." Works keyboard-only and at
  380px (the existing dialog system already satisfies both). Deleting a snapshot
  whose source character is gone behaves identically.
- **Source-character deletion:** snapshots **remain by default** (owner requirement:
  independently useful). The existing delete confirmation gains one informational
  line when snapshots exist: "Saved Level Up snapshots are kept — you can still
  restore this character from Restore Character." Recommended v1 policy is **no**
  "also delete snapshots" checkbox (cleanup lives in the Restore dialog; one decision
  per dialog) — final call is owner decision D4 in the audit doc.
- Deleting a restored character never touches the snapshot it came from.

## 6. Export / import (Phase E, part 2)

- **Full campaign backup:** snapshots ride inside `characters` automatically
  (§2.1). Required additions, so snapshots are *fully* included rather than
  structurally included:
  - `collectReferencedBlobIds` walks `characters.snapshots[].payload.imgBlobId` so
    snapshot portraits export and survive the import cleanup pass
    (`backup.js:460-494, 1263-1296`).
  - `collectReferencedTextIds` walks snapshot payload spell rows so their note keys
    export and survive cleanup (`backup.js:500-535`) — while the source character
    lives these are the same keys; after source deletion the snapshot keeps them
    alive.
  - `remapIncomingSpellNoteTextIds` / `collectSpellIds` include snapshot payload rows
    so campaign-remapped note keys keep working (`backup.js:541-615`).
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

## 7. UI & accessibility (Phase F)

All of this uses Lore Ledger's existing overlay/dialog system (`uiConfirm`/`uiAlert`
stack above feature overlays, the `customContentManager`/`levelUpWizard` overlay
pattern) — no new modal framework (hard ban), no reference-app visual copying.

- **Menu entry:** `Restore Character` (`data-char-action="restore-character"`,
  `#charActionRestoreBtn`) in the character action menu directly after Level Up.
  Always enabled — with zero snapshots it opens the empty state, which teaches the
  feature better than a silent disabled item.
- **Dialog:** `#restoreCharacterOverlay` / `#restoreCharacterPanel`,
  `role="dialog" aria-modal="true"` labeled by the title "Restore Character".
  Focus-trapped (Tab/Shift-Tab wrap), Escape closes (respecting open dropdowns, the
  wizard idiom), overlay-click closes, focus returns to the invoking menu button on
  close. Panel scrolls internally; max-width narrower than the builder wizard;
  single-column at ~380px with no horizontal scroll.
- **Empty state:** "No snapshots yet. Lore Ledger automatically saves a snapshot of a
  character right before every Level Up. Level a character up and its pre-Level-Up
  state will appear here." + Close.
- **Grouping (decision): grouped by source character**, not one flat chronological
  list. The reference app's flat list repeats "Yaan'wae, Sorcerer 3" ambiguously;
  grouping scales with many characters and costs one group-by plus headers.
  Group header: frozen `sourceName` (+ "(character deleted)" when the source id no
  longer resolves). Groups ordered by their newest snapshot, newest first; rows
  within a group by `createdAt` descending.
- **Row content:** primary line `Level <fromLevel> — <classSummary>`; secondary line
  `<localized date & time> · Before Level Up to <toLevel>`. Long names and multiclass
  summaries wrap (no ellipsis-only truncation at 380px); the full text is the
  accessible name.
- **Controls per row:** a Restore button (the row's primary action) and a separate
  delete icon button, both real `<button type="button">` elements with explicit
  `aria-label`s: "Restore <name>, level <N>, <date>" / "Delete snapshot: <name>,
  level <N>, <date>". Standard Tab order; no custom arrow-key grid required.
- **Restore confirmation** (`uiConfirm`, non-destructive tone, okText "Restore"):
  "Restore \"<name>\" as it was at Level <N>?" body: "A separate new character will
  be added to this campaign. No existing character will be changed. The snapshot
  stays available for future restores."
- **Snapshot delete confirmation** (`uiConfirm`, okText "Delete"): "Delete this
  snapshot of \"<name>\" (Level <N>, <date>)? This cannot be undone." body:
  "Playable characters are not affected."
- **Success:** dialog closes; the restored copy is appended to the normal character
  list, becomes the **active/selected character** (the import precedent), and
  `#statusText` shows `Restored "<new name>"`.
- **Errors:** `uiAlert` with the failure reason; state rolled back per §3.3; the
  dialog stays open so the user can retry.
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
  `tests/smoke/levelUp.smoke.js`. **R1 limitation:** snapshot *records* fully
  round-trip; backup bundling of snapshot-only external assets (portrait blob,
  spell-note texts once the source character is gone) is deferred to R4.
  Single-character export remains unchanged and excludes snapshots.
- **R2 — Restore engine. ✅ Shipped 2026-07-22 (owner-authorized).**
  `js/domain/characterSnapshots.js` gained the non-UI engine:
  `getCharacterSnapshotById` (resolution), `prepareRestoredCharacter` (pure
  migrate-through preparation, new identity, spell-row regeneration + note-copy
  map, provenance, §3.4 naming — as-built notes in §3.2/§3.4),
  `resolveRestoredCharacterName`, `commitRestoredCharacter` (staged
  portrait/note writes before the mutation, rollback, double-commit guard,
  no default activation — as-built notes in §3.3), and
  `restoreCharacterFromSnapshot` (the orchestrator for R3). Tests landed:
  `tests/characterSnapshots.restore.test.js` (40 — validation failures,
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
  reload with independent note keys and no console errors. **R2 ships no UI:
  nothing calls the engine in production yet.**
- **R3 — Restore Character UI.** `index.html` overlay + menu item, new
  `js/pages/character/restoreCharacterDialog.js`, wiring in `characterPage.js`,
  additive `styles.css`. Tests: characterPage menu/action coverage (mirroring the
  Level Up cases), dialog list/grouping/empty-state, confirmations, deletion;
  new `tests/smoke/restoreCharacter.smoke.js` (create → level up → restore → both
  playable copies present and independent → delete snapshot), 380px + keyboard-trap
  checks; both smoke gates.
- **R4 — Backup asset completeness.** `backup.js` collectors + remap walk snapshot
  payloads. Tests: snapshot portrait/note export, import-cleanup keep-alive,
  campaign-remap of snapshot note keys.
- **R5 — Edit in Builder retirement.** Gated on owner decisions D1–D3 (audit doc §3).
  Remove E1–E6/M1–M3 per the audit, rework T1–T6 (new ability-change lever per D2),
  update creation-Summary copy, revise the governing docs listed in audit §1.6.
- **R6 — Docs close-out.** Update `docs/state-schema.md` (v13 + snapshot record),
  `docs/operations/storage-and-backups.md`, `docs/features/multi-character-design.md`
  as shipped-behavior docs once each phase lands.

R1→R4 are sequential; R5 is independent of R2–R4 but must not precede R1 (the owner
contract requires the replacement path to exist before the old repair path is
removed — and D1–D3 resolved).

## 9. Authorization

This specification is ratified product direction, not implementation authorization.
The [Working Order](../../AGENTS.md#current-working-order) records the decision and
the phase gate; each R-phase requires explicit owner authorization before code
changes. Completing one phase authorizes nothing further.
