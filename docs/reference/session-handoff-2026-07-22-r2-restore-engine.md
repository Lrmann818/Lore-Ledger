# Session Handoff — 2026-07-22 (Restore Character R2: the non-UI restore engine)

_Point-in-time snapshot. The binding rules and work order live in
[`AGENTS.md`](../../AGENTS.md); the normative feature design (with new R2
as-built notes in §3.2–§3.4 and §8) lives in
[`restore-character-spec.md`](./restore-character-spec.md). Follows the post-R1
review session
([`session-handoff-2026-07-19-r1-review.md`](./session-handoff-2026-07-19-r1-review.md))._

## What this session did

**Implemented Restore Character phase R2 — the non-UI restore engine — under
explicit owner authorization. PASS.** `js/domain/characterSnapshots.js` now
resolves a saved pre-Level-Up snapshot, prepares a separate playable copy
through the canonical migration pipeline, and commits it with staged external
writes and rollback. **R2 ships no UI: no menu item, dialog, snapshot list,
restore button, or deletion control exists, and nothing in production calls the
engine yet.** R3 owns all of that and remains gated.

Starting state verified: `builder-wizard` @ `15fe0de`, clean tree,
`npm run verify` green (1251/1251), dev smoke 61/61 (baseline from the R1
review handoff), nothing pushed.

## R2 API and ownership boundaries

All in `js/domain/characterSnapshots.js` (the R1 module, extended):

- `getCharacterSnapshotById(snapshots, snapshotId)` — pure resolver.
- `prepareRestoredCharacter({ snapshot, existingCharacters, migrateState, createCharacterId?, createRowId?, now? })`
  — pure preparation; no storage access, no state mutation, stored snapshot
  untouched (verified byte-equal). Throws on anything that cannot safely become
  a playable character. `migrateState` is **injected** (state.js imports this
  module, so a static import would cycle); id/row/clock factories default to
  the canonical generators.
- `resolveRestoredCharacterName(nameBase, existingNames)` — pure §3.4 naming.
- `commitRestoredCharacter(staged, deps)` — async staged commit; deps mirror
  `commitImport` (`state`, `SaveManager`, `mutateState`, blob/text stores,
  optional `activate`). Returns `{ characterId, name }`.
- `restoreCharacterFromSnapshot({ snapshotId, migrateState, …commitDeps })` —
  resolve → prepare → commit orchestrator; **this is the seam the R3 UI should
  call** (with `activate: true` for the §7 activation behavior).

## Behavior contracts (as implemented and test-pinned)

- **Validation:** rejects a missing/absent snapshot record, blank id, kind
  other than `pre-level-up`, missing `sourceCharacterId`, missing/malformed/
  uncloneable payload, a payload that cannot migrate to a plain entry, and a
  record with no usable pre-Level-Up level. Nothing partial is ever created.
- **Migrate-through:** the payload deep-clone runs through the real
  `migrateState` wrapped as `{ schemaVersion?, characters: { activeId: null,
  entries: [clone] } }`. Old payloads (v1/v12 shapes) get the full pipeline
  (build v1→v2, rest, death saves, featureUses, overrides — pinned); the stored
  `schemaVersion` is forwarded only so future-version payloads keep
  `migrateState`'s pass-through stance (for all current/past versions the
  invariant re-run tail makes it a no-op — the field stays informational).
- **Identity:** new `char_…` id from the canonical generator, collision-checked
  against existing entries **and** the source character id, bounded retries.
  Provenance on the open entry shape: `restoredFromSnapshotId`,
  `restoredFromCharacterId`, `restoredAt` (ISO, injectable clock).
- **Nested ids:** only spell-row ids regenerate (they key external IndexedDB
  note texts; new ids are collision-checked against every live row id in the
  campaign). Attacks, resources, inventory rows, feature cards, spell-level
  structures, `featureUses` keys, `builderSeed` markers, calc blocks, and
  content references are preserved verbatim.
- **Naming:** `<sourceName> — Restored Level <fromLevel>`; collisions append
  ` (2)`, ` (3)`, … (case-insensitive, trimmed). Blank source name → payload
  name → **"Unnamed Character"** (the selector's blank-name label). Lost
  `fromLevel` → derived from the migrated build. No truncation; an existing
  restored suffix just gains another. The name is re-resolved inside the commit
  mutation against the live entries, so prepare→commit races cannot produce
  duplicate-suffix corruption.
- **Spell notes:** copies are planned in prepare (old→new row-id map) and
  staged in commit **before** the state mutation, at the notes' current values
  (spec §3.3). Missing notes skip (fail-soft); a read/write failure deletes the
  staged records and aborts — after a note-copy failure **no restored character
  exists** (a deliberate strengthening over the spec's original post-commit
  fail-soft copy; the spec §3.3 as-built note records it).
- **Portraits:** `getBlob(source)` → `putBlob(copy)` staged first. Missing
  source blob fails soft (restored `imgBlobId: null`, restore proceeds);
  read/write failures abort before anything else is written. Repeated restores
  get independent blob copies.
- **Commit/rollback:** one mutation appends exactly one entry; a `committed`
  latch plus an in-mutation entry-id guard make double-commit of one staged
  restore impossible; mutation failure rolls back the characters collection
  from a pre-mutation clone and deletes every staged IndexedDB record; retry
  with a fresh preparation succeeds cleanly. `activate` defaults to **false** —
  a domain-only restore never changes `characters.activeId`. Persistence
  failure after `markDirty` follows the SaveManager ERROR contract (one atomic
  vault write, never partial); staged IndexedDB records then become unreachable
  orphans on reload (the `commitImport` exposure class) — pinned by the
  unpersisted-restore reload test.
- **Source deletion / custom content:** restore works from snapshot data alone
  (source entry not required); custom-content ids in the payload are preserved
  as references, never cloned or repaired (missing content keeps degrading soft
  per matrix #17).

## Changes

- `js/domain/characterSnapshots.js` — the R2 engine (two commits: pure
  preparation, then staged commit + orchestrator).
- `tests/characterSnapshots.restore.test.js` — new, 40 tests (resolution,
  validation, migrate-through incl. byte-equal stored snapshots and
  future-version pass-through, identity/collision, naming, nested-id rules,
  note copies + independence, portrait copies + fail-soft, rollback/retry/
  double-commit, activation opt-in, sanitize + campaign-vault reload round
  trips, unpersisted-restore orphan unreachability).
- `tests/characterSnapshots.test.js` — stale header comment updated.
- Docs: spec header/§3.2/§3.3/§3.4/§8 as-built notes; `docs/state-schema.md`
  (R2 engine + provenance fields); `docs/operations/storage-and-backups.md`
  (restore commit protocol + guarantees); `AGENTS.md` (canonical list + working
  order step 20 shipped, R3–R6 renumbered as steps 21–23);
  `docs/audits/builder-completion-matrix.md` (R2 paragraph);
  `docs/plans/new-features-roadmap.md` (R2 shipped, R3–R6 remaining);
  `docs/README.md` (spec blurb + this handoff); this handoff.

## Verification (final tree)

- `npm run typecheck` — clean.
- `npm run test:run` — **1291/1291** (74 files; was 1251 — 40 new).
- `npm run verify` — green.
- `npm run test:smoke` (dev gate) — **61/61**.
- `npm run build && npx playwright test --config playwright.preview.config.js`
  (production gate) — **61/61**.

**Production-preview inspection (temporary harness, deleted after the run):**
a narrowly scoped Playwright spec + `vite-node` runner (needed because the
engine's SRD JSON import graph cannot load in plain Node) drove the real
production build: UI-created Fighter 1 with a spell note → UI Level Up
(R1 snapshot) → the **actual R2 engine** ran against the persisted campaign
document and current note texts → results persisted back through the supported
storage seams (`localStorage` vault + public IndexedDB APIs) → reload. Verified
in the shipped bundle: two restored copies committed and rendered (selector
lists 3), new `char_…` ids, `— Restored Level 1` / `(2)` naming, source
untouched at Fighter 2, snapshot retained, three independent note keys all
readable with edits isolated, and zero console/page errors. No production
global was added; both harness files were deleted before the docs commit.

## Known limitations

- **No user-facing restore exists.** The engine has no production caller; users
  cannot restore anything until R3 ships.
- Cross-store atomicity (localStorage + IndexedDB) is impossible; the staged
  rollback protocol above is the documented guarantee (same class as import).
- R1's R4 limitation stands: backup collectors still don't walk snapshot
  payloads, so snapshot-only portrait/note assets aren't bundled until R4.
- Spell notes copy at restore-time current values by ratified design (§3.3).
- Concurrent prepares that commit later resolve name suffixes at commit time,
  but two *uncommitted* staged results can momentarily share a display name —
  harmless (names are not keys) and self-corrects at commit.

## Next session start

```bash
git status            # expect clean on builder-wizard (local commits, not pushed)
npm run verify        # expect green (1291 unit tests)
npm run test:smoke    # expect 61/61
```

**R3–R6 each remain gated on explicit owner authorization** (AGENTS.md working
order steps 21–23). R3 (Restore Character UI: `index.html` overlay + menu item,
`js/pages/character/restoreCharacterDialog.js`, `characterPage.js` wiring,
additive CSS, spec §7 dialog/grouping/confirmations/activation via
`restoreCharacterFromSnapshot(..., activate: true)`, new
`tests/smoke/restoreCharacter.smoke.js`, both smoke gates) is the natural next
phase and the engine beneath it is now shipped and pinned. A reasonable next
prompt: authorize R3 explicitly, point it at spec §7/§8 and this handoff, and
require the same verification gates plus 380px + keyboard-trap checks.
