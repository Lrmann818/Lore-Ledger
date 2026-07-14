# Session Handoff — 2026-07-14 (Matrix #15 Authoring + Matrix #9 Attack Recalculation)

> A second owner-authorized run on 2026-07-14 added the matrix #15
> integration checkpoint and matrix #9 — see **Part 2** at the end of this
> document. Part 1 records the authoring session as written.

_Point-in-time snapshot. The binding rules and work order live in
[`AGENTS.md`](../../AGENTS.md); the live capability audit is
[`docs/audits/builder-completion-matrix.md`](../audits/builder-completion-matrix.md)._

## What this session did

Owner-authorized session (2026-07-13 → 2026-07-14) implementing **matrix #15 —
custom content authoring UX**, the last P1 blocking the "complete builder"
claim. Started from `03c253d` (clean, verified). All five planned batches
shipped; the acceptance criterion — *a user can author a working custom class
without hand-writing JSON* — is met and pinned by end-to-end tests.

## Commits (oldest first)

| Commit | What |
| --- | --- |
| `177827a` | Batch 1 — authoring domain foundation: spell draft normalization, slug-id generation with collision suffixing, identity-locked `updateCustomContentRecord`, `findCharactersReferencingContent` |
| `9276c7c` | **Fix:** campaign vault persists `state.content` (was silently dropped at save/project/hydrate — imported custom content vanished on every reload; only full backups kept it). Older vault docs hydrate to an empty bucket; no schema migration |
| `369ce22` | Batch 2 — Manage Custom Content dialog (static shell above the Data panel) with list/remove (reference disclosure via character names) and the full custom-spell form; reload/builder-picker smoke |
| `1e276a3` | Docs for batches 1–2 |
| `646df00` | Batch 3 — custom feat form: prerequisites + the closed `effects` vocabulary as repeatable rows; kind-dispatched form architecture with a shared persist path |
| `8b30002` | Batch 4 — custom race form with inline **trait sub-records** (multi-record all-or-nothing saves, orphaned-trait cleanup, verbatim preservation of unresolvable references) |
| `f079be1` | Batch 5 — custom class form: hit die/saves/profs/skills/ASI levels, inline **feature sub-records**, full/half/pact spellcasting on the standard SRD slot tables, `resources[]` pools, `grantedSpells`; pass-through preservation of non-form fields |

Plus the final docs/handoff commit(s) after `f079be1`.

## Architecture in one paragraph

Pure draft → canonical-record normalization lives in
`js/domain/customContentAuthoring.js`; every `normalize*Draft` delegates its
final check to `validateCustomContentRecord`, so the editor and the JSON
import path share one rule system and can never disagree. The dialog
(`js/ui/customContentManager.js`, static shell in `index.html` stacked above
the Data panel and below `uiConfirm`) renders drafts and reports
field-anchored plain-language errors without rebuilding the form. Ids are
generated once from the display name and locked on edit, so character
references never break. Sub-records (race traits, class features) are
companion records saved all-or-nothing with the parent; anything a form
cannot represent (subclasses/subraces, `choices[]`, multiclassing, starting
equipment, threshold-recovery pools, hand-written slot tables) passes through
edits verbatim and remains JSON-import territory.

## Verification (final tree)

- `npm run typecheck` — clean (exit 0)
- `npm run test:run` — **1083/1083** (65 files; +63 this session)
- `npm run verify` — green (typecheck + tests + production build)
- `npm run test:smoke` — **54/54** (incl. the new `customContent.smoke.js`:
  author a spell through the form → validation → reload persistence → builder
  wizard spell picker)
- 380px production-preview checks: list view, spell/feat/race/class forms
  (with repeatable rows open) — no horizontal overflow; save works at phone
  width. (`partyLocationPanels`/`npcPortrait` smokes have a known
  portrait-timing flake; they passed on every run this session.)

## Remaining gaps (all P2, need new owner scope)

Matrix §3 order: attack recalculate-from-build affordance (#9), subclass
1-use feature-action counters (#13 follow-up), partial-regain recovery modes
(#8, design first), prepared-formula/spellbook-growth overrides (#16, design
first), equipment depth (#10, product decisions), keyboard-only a11y pass
(#19 — note the authoring dialog shipped keyboard-trapped with labeled
controls, but the app-wide pass is still queued). Authoring follow-ups worth
considering inside a future scope: subclass/subrace forms, build-time
`choices[]` authoring, and an advanced read-only JSON preview.

## Part 2 — Matrix #15 checkpoint + Matrix #9 (Attack Recalculate from Build)

Owner-authorized follow-up run, same day, starting from `5eecede` (verified
clean, `verify` green, 1083/1083).

### Commits

| Commit | What |
| --- | --- |
| `4bc4c86` | Matrix #15 **integration checkpoint** (green — no regressions): new browser smoke authors a full custom class through the form, builds a character with it, Finishes (marker-seeded Vitals pool, feature reference card, always-prepared grant), edits in place, reloads through the vault; AGENTS.md records the #9 authorization |
| `9825951` | Matrix #9 batch 1 — `js/domain/attackRecalculation.js`: canonical `deriveWeaponAttack()` (extracted from Finish seeding, which now imports it), stable `builderSeed: "weapon:<id>"` provenance on seeded attacks, pure `getAttackRecalculationProposal()` |
| `8c5bd05` | Batch 2 — per-row **Recalculate from Build** button (builder characters only) + preview dialog: field-by-field old→proposed values ("changes to"/"unchanged" in words, never color alone), per-field acceptance, name/notes never touched, explicit weapon picker for unlinked/broken rows, atomic apply, Escape/cancel never mutate |
| `ac020be` | Batch 3 — integration smoke: Finish-seeded marked attack → STR raised via Edit in Builder does **not** change the attack → explicit recalc preview + apply → no-change rerun → survives reload |

Plus the final docs commit after `ac020be`.

### Contract (also in content-registry-plan.md → "Attack Provenance & Recalculation")

Recalculable: `bonus`, `damage`, `range`, `type` (individually acceptable).
Always user-owned: `name`, `notes`, order, `id`. Source identity is the
`weapon:<id>` marker — never the display name. Legacy/manual rows link only
through the explicit picker. No automatic rewrites anywhere. No migration
(open `AttackEntry` shape + pass-through sanitize).

### Verification (final tree)

`npm run typecheck` clean · `npm run test:run` **1106/1106** (66 files;
+23 this run: 15 domain + 8 dialog) · `npm run verify` green ·
`npm run test:smoke` **56/56** (2 new) · 380px preview checks of the recalc
dialog green · full **keyboard-only pass**: Enter opens, Tab stays trapped,
Escape cancels with focus returned to the opener and no mutation,
Tab-to-Apply updates the attack.

### Known limitations

Attacks created before the marker existed (or by hand) require one explicit
link before recalculating — by design, since names are not reliable keys.
The calculator mirrors seeding's assumptions (proficiency always applies;
versatile dice are not offered as an alternative row).

### Next session start

```bash
git status            # expect clean on builder-wizard
npm run verify        # expect green
```

Recommended next P2 (needs owner scope): **#13 follow-up — subclass 1-use
feature-action counters**, or the **#19 keyboard-only a11y pass** (note the
two newest dialogs already ship keyboard-complete).
