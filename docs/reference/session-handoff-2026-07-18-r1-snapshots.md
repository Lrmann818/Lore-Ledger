# Session Handoff — 2026-07-18 (Restore Character R1: pre-Level-Up snapshots)

_Point-in-time snapshot. The binding rules and work order live in
[`AGENTS.md`](../../AGENTS.md); the normative feature design lives in
[`restore-character-spec.md`](./restore-character-spec.md). Third session of
2026-07-18 — earlier: smoke-harness rework
([`session-handoff-2026-07-18.md`](./session-handoff-2026-07-18.md)) and the
Restore Character specification batch
([`session-handoff-2026-07-18-restore-character.md`](./session-handoff-2026-07-18-restore-character.md))._

## What this session did

**Implemented Restore Character phase R1 (owner-authorized) and recorded the D1–D4
owner rulings.** Lore Ledger now saves one complete pre-Level-Up snapshot of a
character, transactionally with every successful Level Up commit. **No user-facing
Restore UI exists** — no menu item, no dialog, no restore, no snapshot deletion;
R1 creates and preserves history only. Edit in Builder is untouched.

## What shipped

- **Schema v13** — `state.characters.snapshots: CharacterSnapshot[]`
  (campaign-scoped sibling of `entries`). `migrateToV13()` + the invariant re-run
  tail delegate to the single normalization source of truth. Older saves/backups
  migrate to an empty collection; **no snapshots are invented retroactively**.
- **`js/domain/characterSnapshots.js` (new)** — `buildPreLevelUpSnapshot()`
  (deep-cloned payload, recursion strip, registry-resolved `classSummary` such as
  "Sorcerer 2, Ranger 1" with raw-id fallback, injectable clock, schemaVersion
  passed by the caller to avoid a state.js import cycle),
  `normalizeCharacterSnapshots()` (array guarantee; drops records missing
  `id`/`kind`/`sourceCharacterId` or a plain-object `payload`; id dedup first-wins;
  scalar normalization; strips `payload.snapshots`; preserves unknown fields),
  `appendPreLevelUpSnapshot()` (replace-append), `PRE_LEVEL_UP_SNAPSHOT_KIND`,
  `newCharacterSnapshotId()` (`csnap_<ts36>_<rand36>`).
- **Capture** — inside the existing Level Up `onApply` `mutateCharacter` mutation
  in `js/pages/character/characterPage.js`: identity guard → plain deep
  before-copy → level-delta validation → sheet patch → **snapshot record
  construction** → append + build/patch assignment. All validation and
  construction precede every write; open, cancel, Escape, invalid drafts, stale
  active-character switches, and failed applies capture nothing. One `markDirty`;
  the single `localStorage` vault write persists snapshot + advanced character
  together or not at all.
- **Idempotency rule** — replace-append on `(kind, sourceCharacterId, fromLevel)`.
  The key is unique per character under supported progression (Level Up appends
  exactly one level; down-leveling is ratified out of scope), so replacement only
  guards retried/duplicated submissions. **Documented limitation:** while Edit in
  Builder still allows removing levels, re-crossing the same level replaces that
  level's earlier snapshot; the window closes at R5.

## Owner rulings recorded (audit doc §3)

- **D1** — both B1 Builder-edit panels retire in R5; ordinary sheet editors are
  never removed for sharing code with Edit in Builder.
- **D2** — base ability scores stay on the **existing Abilities & Skills editor**;
  no new "Correct Ability Scores" flow. R1 audit finding: freeform score/saveProf
  editing conforms today; builder ability *adjustments*, save proficiencies, and
  misc save bonuses are sheet-editable and recalculate through `deriveCharacter()`;
  the builder **base-score inputs are currently disabled** ("Controlled by Builder
  Abilities", `abilitiesPanel.js:444, 719-727`) — R5 must enable them to write
  `build.abilities.base` and rework the T5/T6 smoke levers. No other defect found;
  nothing blocked R1.
- **D3** — incomplete required choices get a future contextual banner + narrow
  `Complete Choices` flow (only objectively unresolved required choices; never
  reopens completed ones; persists across reload; a11y-conformant). Not R1.
- **D4** — deleting a playable character keeps its snapshots; future delete copy
  says restore versions remain; no "also delete snapshots" option in v1.

## Verification (final tree)

- `npm run typecheck` — clean.
- `npm run test:run` — **1249/1249** (73 files; was 1219/72 — 30 new).
- `npm run test:smoke` (dev gate) — first run 60/61 with one failure in
  `partyLocationPanels.smoke.js` (portrait/crop/save-status timing; no snapshot
  coupling); isolated re-run passed 2/2 and the full re-run passed **61/61** —
  recorded as flake, not regression.
- `npm run build && npx playwright test --config playwright.preview.config.js`
  (production gate) — **61/61**, including the new snapshot assertions.
- `npm run verify` — green.
- Manual production-preview inspection (`npm run preview`, real browser):
  create campaign → builder Fighter 1 → open + cancel Level Up ⇒
  `characters.snapshots` empty in live state and the persisted vault; apply Level
  Up ⇒ exactly one `csnap_*` record (Fighter 1 payload, `fromLevel` 1 →
  `toLevel` 2) in live state **and** in `localStorage["localCampaignTracker_v1"]`;
  reload ⇒ snapshot retained, character still Fighter 2; action menu unchanged
  (no Restore item); no console errors.

## Known R1 limitations

- Snapshot **records** fully round-trip (sanitize / vault / full backup / reload);
  bundling snapshot-payload **external assets** into backups (portrait blob,
  spell-note texts once the source character is deleted) is phase **R4** — the
  `collectReferencedBlobIds` / `collectReferencedTextIds` collectors do not walk
  payloads yet (documented in `storage-and-backups.md` and the spec).
- Single-character `.ll-character.json` export is unchanged and excludes snapshots
  (documented format-v1 decision).
- Snapshot growth is unbounded by design (owner retention policy); each record is
  roughly one character entry in size.

## Files changed

Runtime: `js/state.js` (v13), `js/domain/characterSnapshots.js` (new),
`js/pages/character/characterPage.js` (capture). Tests:
`tests/characterSnapshots.test.js` (new, 26), `tests/characterPage.test.js`
(capture suite), `tests/storage.backup.test.js` (real-import retention),
`tests/smoke/levelUp.smoke.js` (snapshot assertions), plus version-pin/shape
updates in `tests/state.migrate.test.js`, `tests/state.characters.test.js`,
`tests/state.migrate.fixtures.test.js`, `tests/customContent.test.js`. Docs:
`AGENTS.md` (steps 19–22, Editing Model note), `docs/state-schema.md`,
`docs/operations/storage-and-backups.md`, `docs/reference/restore-character-spec.md`,
`docs/reference/level-up-flow-spec.md`, `docs/audits/edit-in-builder-retirement-audit-2026-07.md`,
`docs/audits/builder-completion-matrix.md`, `docs/plans/new-features-roadmap.md`,
`docs/README.md`, this handoff.

## Next session start

```bash
git status            # expect clean on builder-wizard (local commits, not pushed)
npm run verify        # expect green (1249 unit tests)
npm run test:smoke    # expect 61/61
```

**R2 is not authorized.** Recommended next: owner reviews the R1 result, then
authorizes **R2 (restore engine)** — `prepareRestoredCharacter` (migrate-through
pipeline, new ids + spell-row regeneration with note-key map, naming) and
`commitRestore` (staging + rollback), pure/unit-tested, still no UI — per
`restore-character-spec.md` §3 and §8.
