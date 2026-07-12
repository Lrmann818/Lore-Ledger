# SRD 5.1 Builder Completion Matrix

_Status: **planning artifact — audited against code 2026-07-12** (post Level Up Phase 1)._

This is the canonical capability matrix for the question: *what remains before Lore
Ledger can accurately claim a fully functioning SRD 5.1 character builder with robust
custom content?* It supersedes the completion sections of earlier audits for that
question; the binding work order remains
[`AGENTS.md` → Current Working Order](../../AGENTS.md#current-working-order). Nothing in
this document authorizes implementation.

Severity: **P0** breaks correctness or trust · **P1** blocks the "complete builder"
claim · **P2** polish/depth. Status: ✅ shipped · 🟡 partial · ⬜ not built.

---

## 1. Capability matrix

| # | Capability | Status | Relevant files | Builtin SRD 5.1 | Custom content | Gap | Severity | Depends on | Order | Acceptance criteria |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Creation wizard (identity, origin choices, classes/levels, class choices, abilities ×4 methods, spells, equipment, summary) | ✅ | `js/pages/character/builderWizard.js`, `builderWizardSteps.js` | Full greenlist | Custom records appear in pickers via registry merge | Non-required choices (skills, fighting style, spell counts) can be skipped silently at Finish | P2 | — | 7 | Finish warns when count-bearing choices are incomplete |
| 2 | Levels 1–20 progression per class | ✅ | `js/domain/rules/progression.js`, `classes.json`, `subclasses.json` | All 12 classes/subclasses, data-driven `featuresByLevel`/`asiLevels` | Same engine consumes custom records | Class-resource counters not derived (`classSpecificByLevel` unread — Level Up spec Gap C) | P1 | — | **1 (next)** | `deriveCharacter` emits `derivedResources`; creation and Level Up seed/update `resources[]` duplicate-aware |
| 3 | Level Up flow (one-level append) | ✅ Phase 1 | `levelUpWizard.js`, `progression.js#getLevelUpPlan`, `builderSheetSeeding.js#getLevelUpSheetSeedPatch` | Shipped 2026-07-12 | Data-driven; works for custom classes with v2-shaped records | Phase 2/3 resource deltas; down-leveling permanently out of scope | P1 (Phase 2) | #2 | 1 | Summary shows `Rage 2 → 3`; counters grow without resetting `cur` |
| 4 | Multiclassing (prereqs, proficiencies, skill choices, combined slots, pact separation) | ✅ | `progression.js`, `builderWizardSteps.js`, `levelUpWizard.js` | Full SRD rules; prereqs warn, never block | Custom `multiclassing` block consumed | None material | — | — | — | — |
| 5 | ASI / feat scheduling | ✅ | `progression.js#getAsiSlots`, `collectAsiChoices` | Data-driven `asiLevels`; Grappler only builtin feat | Custom feats + structured `effects` vocabulary consumed | No 20-cap enforcement on ability totals after ASI | P2 | — | 8 | ASI editor blocks totals above 20 (SRD cap) |
| 6 | Spellcasting models (known / prepared / spellbook / pact / granted / ritual) | ✅ | `progression.js`, `characterRest.js`, `levelUpWizard.js` | All four models + subclass granted spells; ritual flag displayed | Custom classes: models keyed off `preparationMode`/`progression` fields | Class-level `grantedSpells` (registry-plan shape) are **not consumed** — only subclass grants are; spellbook growth constants (6/+2) not per-class configurable; prepared-capacity formula fixed at `level(+half) + mod` | P2 | — | 6 | `getGrantedSpells` also walks class records; custom overrides documented |
| 7 | Prepared-spell play-state (Long Rest flow) | ✅ | `characterRest.js`, `restFlow.js`, `rest.preparedByClass` | Cleric/Druid/Paladin/Wizard | Works for custom prepared casters | None — Level Up correctly reports capacity only | — | — | — | — |
| 8 | Rest and recovery (Short/Long, Hit Dice, slots, pact, death saves, tagged resources) | ✅ | `characterRest.js`, `restFlow.js` | P0 complete + Level Up integration tested | Recovery vocabulary available to custom cards/resources | Partial-regain features (e.g. "regain 1d6 uses") unmodeled | P2 | — | 9 | Tagged partial recovery modes designed before implementation |
| 9 | Derived calculations (AC, HP, saves, skills, initiative, passive perception, DC/attack, prof) | ✅ | `deriveCharacter.js`, `computeArmorClass`, `computeMaxHp` | Armor/unarmored/shield formulas; retro-Con HP | Custom armor/feat effects consumed | Seeded **attack rows are static** (user-owned): proficiency growth does not update them, by ownership design; divergence is silent | P2 | — | 10 | Attacks panel offers an explicit "recalculate from build" affordance (never automatic) |
| 10 | Equipment effects | 🟡 | `builderSheetSeeding.js`, `equipment.*.json` | AC from armor/shield; weapons → attacks; packs → pockets | Custom armor/weapons consumed | No currency deduction, no encumbrance, magic items deferred by greenlist | P2 | greenlist change for magic items | 11 | Documented as out of scope, or greenlist deliberately expanded |
| 11 | Editable post-creation sheet surfaces | 🟡 | `js/pages/character/panels/*` | All play-state fields editable | n/a | **B1 queued:** builder-only panels (Identity/Abilities/Summary) still act as structural edit surfaces; guarded edit routing not finished | P1 | explicit authorization | 3 | Structural edits route through wizard flows; builder panels retired or demoted per B1 |
| 12 | Spell detail seeding (descriptions, ranges, components) | ⬜ | `builderSheetSeeding.js`, IndexedDB `texts` | Name-only rows seeded today | Custom spells same | **B2 queued** | P1 | explicit authorization | 4 | Seeded spells carry SRD detail text without overwriting user notes |
| 13 | Feature detail seeding depth | 🟡 | `builderSheetSeeding.js` | One-line desc per feature line | Custom features same | **B3 queued:** structured feature cards beyond Dragonborn slice | P1 | explicit authorization | 5 | Rules-backed feature cards for class features with uses/DCs |
| 14 | Custom content persistence & registry merge | ✅ | `js/domain/customContent.js`, `rules/registry.js`, `content.custom` (schema v11) | n/a | Same shapes as SRD records, `source: "custom"`, cannot shadow builtin | — | — | — | — | — |
| 15 | Custom content authoring UX | ⬜ | Data panel import/export/list/remove only | n/a | JSON-file authoring only; no in-app editor, no validation feedback loop beyond import errors | No guided authoring for races/classes/spells | P1 | #14 | 2 | A user can author a working custom class without hand-writing JSON |
| 16 | Custom class expressiveness (the hard claim) | 🟡 | whole rules engine | n/a | **Consumable today, data-driven, no per-class hardcoding:** hit die/HP, proficiencies, skill choices, multiclass prereqs+gains, subclass level+list, ASI levels, `featuresByLevel`, subfeature choices, full/half/pact/non-caster progressions, cantrip/known caps, slot tables | **Not expressible:** resources/recovery metadata (needs #2), prepared-formula variants, class-level granted spells, spellbook growth counts, expertise outside the hardcoded 4 feature-id set | P1 | #2, #6 | 2 | A custom class with resources + granted spells derives and levels correctly end-to-end with a regression test |
| 17 | Custom content deletion safety & dependencies | 🟡 | `customContent.js`, `deriveCharacter` warnings | n/a | Removing referenced content degrades soft (derivation warnings, no crash) | Character export does **not** bundle referenced custom records; import into another campaign loses them | P2 | #14 | 8 | `.ll-character.json` optionally embeds referenced custom records |
| 18 | Migration & backward compatibility | ✅ | `js/state.js` (v12), `tests/state.migrate*.test.js`, `saveCompatibility.test.js` | Single lineage v0→v12 | Custom bucket migrates with campaign | None pending — Level Up Phase 1 required no schema change (verified) | — | — | — | — |
| 19 | Accessibility & mobile | 🟡 | wizard focus traps, aria labels, phone-width smokes | Level Up + builder wizard verified at 380px | n/a | Abilities & Features menu keyboard pass still queued (roadmap); no automated a11y audit | P2 | — | 9 | Keyboard-only run of both wizards + panels documented |
| 20 | Licensing & attribution | 🟡 | `LEGAL.md`, `docs/reference/attribution-requirements.md` | CC-BY-4.0 statement in repo | Custom content untouched by attribution | In-app credits surface required before public release (attribution Phase 4) | P1 (release gate) | — | 6 | CC-BY-4.0 attribution visible in-app |

## 2. What the audit explicitly rejects

- **"Custom content persistence" ≠ "full custom-class support."** Persistence (#14) is
  done; expressiveness (#16) is not. A custom class is complete only when the rules
  engine and both wizards consume its structured progression — today that is true for
  progression/spellcasting/choices but **false for resources, class-granted spells, and
  expertise metadata**, and there is no authoring UX (#15).
- **"Architecture exists" ≠ "feature complete."** `classSpecificByLevel` ships in the
  data but nothing reads it; the matrix keeps #2 open until code consumes it.

## 3. Current authorized sequence (2026-07-12, second session)

**Level Up Phase 2 — derived class resources** is authorized and in progress: consume
`classSpecificByLevel` in `deriveCharacter()` as an additive `derivedResources` field and
seed/update `character.resources[]` duplicate-aware via a `builderSeed` marker
(`inventoryItems[].builderSeed` precedent; no migration needed). It closes the biggest
rules gap (#2), covers Level Up Phase 3's resource deltas (#3), and moves custom-class
expressiveness (#16). After Phase 2, the next coherent batches proceed per this matrix's
priorities; **B1, B2, and B3 are authorized in sequence** (one at a time, fully verified
between batches).

## 4. Verification basis

Audited against code at Level Up Phase 1 completion: 60 new Level Up unit tests +
10 flow tests + 2 integration rest tests + 2 Playwright smokes green; full suite 957
unit tests; `npm run verify` green. Statements about unconsumed data
(`classSpecificByLevel`, class-level `grantedSpells`) were grep-verified against
`js/domain/rules/*`.
