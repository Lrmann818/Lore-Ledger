# Session Handoff — 2026-07-17 (F2 Structured Vitals: spell DC/attack, AC, max HP)

_Point-in-time snapshot. The binding rules and work order live in
[`AGENTS.md`](../../AGENTS.md); the normative calculation rules live in
[`character-calculation-contract.md`](./character-calculation-contract.md) →
"Structured Vitals ownership"; the implementation record lives in
[`character-calculation-audit-2026-07.md`](../audits/character-calculation-audit-2026-07.md)
→ "Phase B"._

## What this session did

Owner-authorized F2 run (working-order step 17), starting from `2ef6b1f`
(the batch-1 docs commit) with the batch-2 spellcasting work staged by the
prior session. Completed and shipped batches 2–5: **spell save DC / spell
attack, Armor Class, and maximum HP now follow the calculation contract** —
derived by default for builder characters, adjusted through explicit
modifiers, fixed only through an intentional override, with legacy snapshots
preserved verbatim and adopted only through the editor. Builder and freeform
characters share the same calculators. Also expanded the AGENTS.md
"Reference App Screenshots" section into the fuller normative guidance
requested by the owner.

## Commits (oldest first, all local — not pushed)

| Commit | What |
| --- | --- |
| `626fb97` | **Batch 2** — `js/domain/spellcastingCalculation.js` (per-ability profiles with provenance; never a universal scalar), `spellcastingCalc` block, vitals spell tiles + per-source editor with freeform ability declaration, adoption-safe Finish stamp, calc-aware Level Up. 28 unit tests. |
| `4d0a816` | **Batch 3** — `js/domain/armorClassCalculation.js` + `acCalc`; **Defense fighting style** added to `computeArmorClass` (+1 only while wearing armor); one displayed value across tracker linked cards and combat (calc-managed writes decline; card inputs read-only); **temporary combat AC** layered participant-locally over the calculated base; shared scalar calculation editor; shared `vitalCalc*` tile pattern; adoption-safety stamp rule (also tightened batch 2). 26 unit tests. |
| `6c553fa` | **Batch 4** — `js/domain/hpMaxCalculation.js` + `hpMaxCalc`; **Dwarven Toughness made structural** (`hpPerLevelBonus` emitted by `racesAdapter.js`, races.json regenerated one-line diff, consumed by `deriveCharacter`); current-HP clamp on lowered max, never auto-heal; calc-aware Level Up (derived re-derives + moves `hpCur` by the delta; fixed preserved); linked-card hpMax managed treatment; HP tile inline derived max beside the editable current-HP input; numWrap-aware hide fix. 27 unit tests. |
| `442cd90` | **Batch 5a** — `tests/smoke/structuredVitals.smoke.js` (3 tests); fixes it surfaced: rest heals to `getDisplayedHpMax`; ✎ buttons instance-stamped and rebuilt after panel re-init; both dialogs move focus out **before** hiding (browser focus-fixup clobbered the restore). |
| (docs commit) | **Batch 5b** — contract/audit/matrix/roadmap/level-up-spec/registry-plan/testing docs updated; AGENTS.md step 17 closed + screenshot-reference guidance; `playwright.preview.config.js` (production-preview smoke gate); this handoff. |

## Architecture in one paragraph

Each field keeps its flat snapshot and may carry an optional calc block on the
open entry shape (no migration): `spellcastingCalc` (mode + per-source
adjustments + freeform profiles + fixed DC/attack), `acCalc` and `hpMaxCalc`
(mode + adjustment; the flat field is the fixed value). One display resolver
per field (`getSpellcastingDisplayModel`, `getArmorClassDisplayModel` /
`getDisplayedArmorClass`, `getHpMaxDisplayModel` / `getDisplayedHpMax`) sits
over the existing engine formulas (`deriveCharacter`, `computeArmorClass`,
`computeMaxHp`) and is consumed by the vitals tiles (character + combat
embedded), Finish/Level Up seeding, rest, tracker linked cards, and combat
seeding — one displayed value everywhere. Legacy = no block, verbatim,
adopted only via the editor; Finish stamps a derived block only when it cannot
change the displayed number.

## Verification (final tree)

- `npm run typecheck` — clean; `npm run test:run` — **1219/1219** (72 files);
  `npm run verify` — green.
- `npm run test:smoke` (dev-mode gate) — **61/61**.
- **Production preview** (`playwright.preview.config.js` over the real
  `dist/`): all F2-related suites green (structuredVitals, characterRest,
  attackEditor, attackKeyboard, builderWizard, levelUp, highElfCantrip,
  customContent…) — 54/61 overall; the 7 failures are pre-existing dev-only
  harnesses that `import()` source modules (backup, panel-lifecycle ×4, one
  combatShell case, trackerPanelLifecycle). Follow-up filed.
- **Manual production-preview acceptance** (real browser over
  `npm run preview`): Finish stamps all three blocks (DC 13 / attack +5 /
  AC 12 "10 + Dex" / HP 10 "Calculated from levels"); AC editor Save applies
  +1 (tile 13, "10 + Dex + 1 adj"); HP fixed 25 leaves `hpCur` 10; Escape
  with typed 99 mutates nothing; reload preserves all modes; 380px renders
  with zero horizontal overflow. Keyboard trap/Escape/focus-return at 380px
  pinned by the preview-mode smoke (real key events, same build).

## Known limitations / deferred

- Freeform AC and max HP stay manual inputs (no structured armor / level
  history) — by contract, not an omission. Freeform initiative (F1) still
  snapshot.
- No alternate-formula selection UI for rare unarmored AC ties (best-of is
  deterministic; equipment is the primary input; adjustment/fixed cover
  intentional deviations). No shield/armor quick-toggle on the sheet
  (equipment remains a guarded build choice).
- The 7 dev-only smoke harnesses fail under the preview config by
  construction (follow-up chip filed 2026-07-17).
- Deferred backlog unchanged: Half-Elf ability/skill choices, Tiefling
  cantrip grant, race-trait fixed proficiencies (F3), Dwarf tools, P2 matrix
  items.

## Next session start

```bash
git status            # expect clean on builder-wizard (local commits, not pushed)
npm run verify        # expect green
npm run test:smoke    # expect 61/61
```

Recommended next (needs owner scope): **Half-Elf Skill Versatility** (smallest
deferred choice item), or freeform initiative (F1) using the shipped
scalar-calc pattern, or the smoke-harness preview-compatibility follow-up.
