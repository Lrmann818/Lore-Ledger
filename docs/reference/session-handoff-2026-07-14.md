# Session Handoff — 2026-07-14 (Custom-Content Authoring, Matrix #15)

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

## Next session start

```bash
git status            # expect clean on builder-wizard
npm run verify        # expect green
```

Then pick a P2 item from the matrix §3 with the owner.
