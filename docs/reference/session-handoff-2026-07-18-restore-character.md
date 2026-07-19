# Session Handoff — 2026-07-18 (Restore Character specification batch)

_Point-in-time snapshot. The binding rules and work order live in
[`AGENTS.md`](../../AGENTS.md); the normative feature design lives in
[`restore-character-spec.md`](./restore-character-spec.md). This was the second
session of 2026-07-18 — the earlier smoke-harness handoff is
[`session-handoff-2026-07-18.md`](./session-handoff-2026-07-18.md)._

## What this session did

**Specification and audit only — zero runtime, test, or schema changes.** The owner
ratified a product decision and this session turned it into binding architecture:

1. The Builder is for **initial creation**; general user-facing **Edit in Builder
   will be retired** (not yet removed).
2. Immediately before every successful Level Up commit, Lore Ledger saves a
   **complete pre-Level-Up snapshot** of the character, transactionally with the
   commit.
3. A **Restore Character** flow lists snapshots and restores any of them as a
   **separate playable copy** — new stable ID, never overwriting or mutating the
   current or source character, repeatable, snapshots retained until individually
   deleted and included in backups.

## Deliverables

- **`docs/audits/edit-in-builder-retirement-audit-2026-07.md`** (new) — every Edit
  in Builder dependency classified (UI entry points E1–E6, mode flags M1–M3, seeding
  S1–S6, tests T1–T6, docs, assumptions A1–A5), the repair/adoption behavior it
  performs today, the Phase G editable-field boundary (real gaps: G3 base ability
  scores, G5/G6 incomplete-choice completion), and owner decisions **D1–D4**.
- **`docs/reference/restore-character-spec.md`** (new, normative) — data model
  (`state.characters.snapshots`, schema v13, snapshot record shape, no recursion),
  identity plan (new `char_` id; regenerate spell-row ids + copy note texts because
  note keys are `spell_notes_<campaignId>__<rowId>`; duplicate the portrait blob;
  keep all other nested ids incl. `builderSeed` markers), migrate-through restore
  pipeline, `commitImport`-style commit with rollback, collision-safe naming
  (`<Name> — Restored Level <N>`, then ` (2)`…), the single-vault-write Level Up
  transaction (§4), retention/deletion policy, backup collector additions (§6),
  the grouped-by-character dialog UX + accessibility spec (§7), and implementation
  phases **R1–R6** with required tests (§8).
- **Governing docs updated:** `AGENTS.md` (Editing Model ratified-direction note,
  Level Up Rules pointer, doc-map row, canonical list, working order steps 18–21),
  `docs/reference/level-up-flow-spec.md` (§6.4 Long-Rest note, §10.1 remedy update,
  §11 D3 pointer), `docs/audits/builder-completion-matrix.md` (#11 note + §3
  record), `docs/plans/new-features-roadmap.md` (Step 3 entries), `docs/README.md`
  (index entries), this handoff.

## Key verified facts the design stands on (HEAD `47a0439`)

- The Level Up apply path already builds a full plain deep copy of the pre-Level-Up
  character inside `mutateCharacter` (`characterPage.js:415`) — the capture point.
- The whole campaign persists as **one synchronous `localStorage.setItem`** of the
  vault (`persistence.js:179`), so snapshot + level-up appended in the same mutation
  commit atomically with no new machinery.
- `sanitizeForSave` shallow-copies the characters container, `extractCampaignDoc`
  clones it wholesale, and `migrateToV4` normalizes it **in place** — a
  `characters.snapshots` sibling survives every persistence surface, but each path
  still gets pinned by tests (the `state.content` vault-drop lesson, matrix #14).
- Spell-note texts are campaign+row-id keyed IndexedDB side storage; a same-campaign
  copy keeping row ids would **share mutable notes** with the source — hence the
  regenerate-and-copy rule.
- Backup collectors (`collectReferencedBlobIds` / `collectReferencedTextIds`) do not
  walk snapshot payloads yet — R4 closes that so snapshot portraits/notes survive
  backup round trips.
- The Finish seed patch is shared by creation, Edit in Builder, **and Long Rest**
  (`characterPage.js:576`) — the seeding engine outlives the retirement.
- Two smoke suites (`attackEditor`, `structuredVitals`) use Edit in Builder as their
  only lever to change base ability scores — retirement needs a replacement lever
  (owner decision D2).

## Open owner decisions (gate phase R5 only)

- **D1** — Builder Identity/Abilities panel disposition (recommend: retire the B1
  panels).
- **D2** — base-ability-score correction path (recommend: a narrow guarded editor).
- **D3** — incomplete-choice completion path (recommend: a narrow "complete pending
  choices" flow sharing the D2 surface).
- **D4** — "also delete snapshots" offer on character deletion (recommend: no;
  keep-by-default + informational line).

## Verification (docs-only batch, full gate run anyway)

- `npm run typecheck` — clean.
- `npm run test:run` — 1219/1219 (72 files).
- `npm run test:smoke` — 61/61.
- `npm run verify` — green.
- Production-preview suite not run (no runtime or test code changed; both smoke
  gates last confirmed 61/61 in the same-day smoke-harness session).

## Implementation authorization

**Not authorized.** The working order (AGENTS.md steps 18–19) records the ratified
decision and defines phases R1–R6; each phase requires explicit owner authorization
before any code changes. Runtime behavior is unchanged in this batch.

## Next session start

```bash
git status            # expect clean on builder-wizard (local commits, not pushed)
npm run verify        # expect green
npm run test:smoke    # expect 61/61
```

Recommended next: owner reviews `restore-character-spec.md` + audit decisions D1–D4,
then authorizes **R1 (schema v13 + pre-Level-Up snapshot capture)** as the first
implementation batch.
