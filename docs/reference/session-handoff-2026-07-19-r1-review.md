# Session Handoff — 2026-07-19 (post-R1 correctness review)

_Point-in-time snapshot. The binding rules and work order live in
[`AGENTS.md`](../../AGENTS.md); the normative feature design lives in
[`restore-character-spec.md`](./restore-character-spec.md). Follows the R1
implementation session
([`session-handoff-2026-07-18-r1-snapshots.md`](./session-handoff-2026-07-18-r1-snapshots.md))._

## What this session did

**Narrow post-R1 correctness review before Restore Character phase R2. Verdict:
PASS — no production defect found; no runtime code changed.** The review answered
seven correctness questions against the shipped R1 code, added a forced
persistence-failure lifecycle test over the real save pipeline, and aligned two
spec details. R2 was **not** implemented (still gated on owner authorization).

Starting state verified: `builder-wizard` @ `1eb5c8f`, clean tree,
`npm run verify` green.

## Review findings (all seven questions)

1. **Deep copy — yes.** `buildPreLevelUpSnapshot` JSON-round-trips its input into
   a fresh `payload` (a second, independent clone of the apply path's
   `beforeSnapshot`), so the snapshot shares no nested references with the
   playable character. Pinned by the existing deep-copy-independence test.
2. **Input mutation — safe by ownership.** `buildPreLevelUpSnapshot` never mutates
   its input (the recursion strip runs on its own clone).
   `normalizeCharacterSnapshots` strips `payload.snapshots` in place and reuses
   payload objects — correct for its only callers (migration over
   migration-owned documents, per the repo's in-place `migrateState` convention);
   no call site passes the live active character.
3. **Vault-write failure leaves live state as the spec says — committed pair
   retained, nothing partial.** Persistence is debounced and runs after the
   in-memory commit; the vault write is one atomic `localStorage.setItem`. On
   failure: nothing persists, `vaultRuntime.current` keeps the pre-Level-Up vault
   (`persistRuntimeStateToVault` clones; `saveAllLocal` reassigns the cache only
   on success), live state keeps snapshot + advancement together with
   `dirty=true` (spec §4.3 — not rolled back; the export banner exists to save
   that in-memory truth).
4. **A failed persistence attempt can never be committed later.** The failed
   vault object is discarded; every save re-extracts from live state. A later
   save commits only the live truth — the consistent pair, atomically. A failed
   *apply* leaves nothing live at all, so later unrelated saves persist no trace
   (now test-pinned end-to-end).
5. **"Together or neither" — accurate at both layers.** All Level Up validation
   and construction precede every write inside one `mutateCharacter` mutation
   (the write section is throw-free plain assignments); persisted state is one
   atomic key. No sequence of apply/persist failures can split the pair in live,
   cached, persisted, or reloaded state.
6. **R1 backup support — records only, as documented.** Snapshots ride inside
   `characters` through sanitize/vault/backup; `collectReferencedBlobIds` /
   `collectReferencedTextIds` walk only `characters.entries`, so snapshot-only
   portrait blobs / spell-note texts are not bundled until R4 — consistently
   documented in the spec, `state-schema.md`, `storage-and-backups.md`, and the
   R1 handoff.
7. **Key triple — implemented consistently; spec §4.3 aligned this session.**
   `appendPreLevelUpSnapshot` matches on `(kind, sourceCharacterId, fromLevel)`;
   every doc used the full triple except spec §4.3 (omitted `kind` twice) —
   fixed, and the temporary pre-R5 Edit-in-Builder replacement window is now in
   the spec too.

## Changes

- **`tests/characterPage.test.js`** — two tests in "level up flow" behind a new
  `setupLevelUpWithRealPersistence` harness (real `createSaveManager` →
  `saveAllLocal` → campaign vault → stubbed localStorage with switchable write
  failure): (a) forced vault-write failure — persists neither snapshot nor
  advancement (byte-identical stored vault), cache unpoisoned, live pair intact,
  ERROR + export banner + status fired, reload yields consistent pre-Level-Up
  state, recovery save commits the pair atomically; (b) forced mid-commit apply
  failure (unclonable entry) — no live snapshot, no live advancement, existing
  "Level Up could not be applied" status, and a later unrelated save persists no
  trace of the failed Level Up.
- **`docs/reference/restore-character-spec.md`** — §4.3 duplicate-prevention key
  now includes `kind` and records the pre-R5 limitation; §4.3 save-failure and
  §8 R1 test list record the new lifecycle coverage.
- No runtime source changed.

## Verification (final tree)

- `npm run typecheck` — clean.
- `npm run test:run` — **1251/1251** (73 files; was 1249 — 2 new).
- `npm run test:smoke` (dev gate) — 61/61.
- `npm run verify` — green.
- `npm run build && npx playwright test --config playwright.preview.config.js`
  (production gate) — 61/61.

## Next session start

```bash
git status            # expect clean on builder-wizard (local commits, not pushed)
npm run verify        # expect green (1251 unit tests)
npm run test:smoke    # expect 61/61
```

**R2 remains gated on explicit owner authorization.** This review found no
blocker: R2 (restore engine — `prepareRestoredCharacter` migrate-through
pipeline, id regeneration + note-key map, naming, `commitRestore` staging +
rollback, per spec §3 and §8) is safe to authorize on the reviewed foundation.
