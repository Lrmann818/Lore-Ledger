# SRD 5.1 Builder Completion Matrix

_Status: **planning artifact — audited against code 2026-07-17** (post Level Up Phases 1–3, B1–B3, attribution gate, class granted spells, ASI cap guidance, matrix #15 authoring, the unified calculation contract with live-deriving attacks + reusable choice-based granted spells, and the F2 Structured Vitals conversion: live-deriving spell DC/attack, AC, and max HP)._

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
| 1 | Creation wizard (identity, origin choices, classes/levels, class choices, abilities ×4 methods, spells, equipment, summary) | ✅ | `js/pages/character/builderWizard.js`, `builderWizardSteps.js#getIncompleteChoiceSummaries` | Full greenlist; the Summary lists every incomplete count-bearing choice (skills, subclass, fighting style, expertise, ASI/feat incl. partial ASIs, cantrip/known/spellbook counts) as non-blocking guidance (2026-07-13) | Custom records appear in pickers via registry merge | None material | — | — | — | — |
| 2 | Levels 1–20 progression per class | ✅ | `js/domain/rules/progression.js`, `rules/classResources.js`, `classes.json`, `subclasses.json` | All 12 classes/subclasses, data-driven `featuresByLevel`/`asiLevels`; class-resource pools derived from `classSpecificByLevel` + rules vocabulary (shipped 2026-07-12) | Same engine consumes custom records incl. explicit `resources[]` | None material | — | — | — | — |
| 3 | Level Up flow (one-level append) | ✅ Phases 1–3 | `levelUpWizard.js`, `progression.js#getLevelUpPlan`, `builderSheetSeeding.js#getLevelUpSheetSeedPatch`, `rules/classResources.js` | Shipped 2026-07-12 (incl. resource growth: summary shows `Rage 2 → 3`, spent uses preserved) | Data-driven; works for custom classes with v2-shaped records | Down-leveling permanently out of scope | — | — | — | — |
| 4 | Multiclassing (prereqs, proficiencies, skill choices, combined slots, pact separation) | ✅ | `progression.js`, `builderWizardSteps.js`, `levelUpWizard.js` | Full SRD rules; prereqs warn, never block | Custom `multiclassing` block consumed | None material | — | — | — | — |
| 5 | ASI / feat scheduling | ✅ | `progression.js#getAsiSlots`, `collectAsiChoices`, `builderWizardSteps.js#renderAsiSlot` | Data-driven `asiLevels`; ASI editor warns above the SRD 20 cap (2026-07-13, guidance-only per the multiclass-prereq precedent) | Custom feats + structured `effects` vocabulary consumed | None material | — | — | — | — |
| 6 | Spellcasting models (known / prepared / spellbook / pact / granted / ritual) | ✅ | `progression.js`, `characterRest.js`, `levelUpWizard.js` | All four models + subclass granted spells; ritual flag displayed | Custom classes: models keyed off `preparationMode`/`progression` fields | Class-level `grantedSpells` consumed since 2026-07-13 (`getGrantedSpells` walks class records; custom classes can grant spells); spellbook growth constants (6/+2) not per-class configurable; prepared-capacity formula fixed at `level(+half) + mod` | P2 | — | 6 | Custom overrides for spellbook growth / prepared formulas documented or supported |
| 7 | Prepared-spell play-state (Long Rest flow) | ✅ | `characterRest.js`, `restFlow.js`, `rest.preparedByClass` | Cleric/Druid/Paladin/Wizard | Works for custom prepared casters | None — Level Up correctly reports capacity only | — | — | — | — |
| 8 | Rest and recovery (Short/Long, Hit Dice, slots, pact, death saves, tagged resources) | ✅ | `characterRest.js`, `restFlow.js` | P0 complete + Level Up integration tested | Recovery vocabulary available to custom cards/resources | Partial-regain features (e.g. "regain 1d6 uses") unmodeled | P2 | — | 9 | Tagged partial recovery modes designed before implementation |
| 9 | Derived calculations (AC, HP, saves, skills, initiative, passive perception, DC/attack, prof) | ✅ | `deriveCharacter.js`, `computeArmorClass`, `computeMaxHp`, `js/domain/attackCalculation.js`, `js/domain/spellcastingCalculation.js`, `js/domain/armorClassCalculation.js`, `js/domain/hpMaxCalculation.js`, `vitalsPanel.js` | Armor/unarmored/shield formulas (+ **Defense fighting style while armored, 2026-07-17**); retro-Con HP (+ structured **Dwarven Toughness** `hpPerLevelBonus`); **attacks live-derived (2026-07-15)** through one canonical calculator; **spell DC/attack, AC, and max HP live-derived (F2, 2026-07-16/17)** — optional per-field calc blocks (`spellcastingCalc` profiles per source ability, `acCalc`, `hpMaxCalc`), explicit adjustments, intentional fixed overrides, legacy snapshots preserved verbatim with editor-based adoption, calc-aware Finish/Level Up/rest/tracker/combat surfaces, temporary combat AC layered over the calculated base | Custom weapons/armor/classes derive through the same registry path | **F2 closed.** Freeform AC/max HP stay manual inputs by contract (no structured armor / level history); freeform initiative (F1) still snapshot | — | — | — | Attacks + all four vitals derive live (contract-conformant); one calculator each; no manual recalc ✅ |
| 10 | Equipment effects | 🟡 | `builderSheetSeeding.js`, `equipment.*.json` | AC from armor/shield; weapons → attacks; packs → pockets | Custom armor/weapons consumed | No currency deduction, no encumbrance, magic items deferred by greenlist | P2 | greenlist change for magic items | 11 | Documented as out of scope, or greenlist deliberately expanded |
| 11 | Editable post-creation sheet surfaces | ✅ | `js/pages/character/panels/*` | All play-state fields editable; **B1 shipped 2026-07-13:** Builder Identity/Abilities panels are read-only routing surfaces (Edit in Builder); structural edits go through guarded wizard flows only. **2026-07-18: Edit in Builder retirement + Restore Character replacement ratified but not implemented** — see §3 and `docs/reference/restore-character-spec.md` | n/a | Builder Summary remains a display-only review scaffold (harmless; retire only with a deliberate product decision) | — | — | — | — |
| 12 | Spell detail seeding (descriptions, ranges, components) | ✅ | `spellsPanel.js#renderSpellSrdDetails` | **B2 shipped 2026-07-13:** builder-managed rows show the full live-derived SRD detail block (school/level, ritual/concentration, casting time, range, components+material, duration, description, higher-level text) above user notes | Custom spells resolve through the same kind-aware lookup | Details are display-only (deliberate: notes stay purely user-owned; no materialized copies) | — | — | — | — |
| 13 | Feature detail seeding depth | ✅ | `abilitiesFeaturesPanel.js#collectReferenceFeatures`, `deriveCharacter.js#raceTraits` | **B3 shipped 2026-07-13:** display-only rules-reference cards for every class/subclass feature, chosen feat, and race trait with full SRD descriptions | Custom features/traits resolve through the same registry | Feature-specific use counters with DCs (subclass 1-use features) remain future feature-action work | P2 | — | 7 | Fiend/Open Hand style 1-use subclass features get tracked feature-action cards |
| 14 | Custom content persistence & registry merge | ✅ | `js/domain/customContent.js`, `rules/registry.js`, `content.custom` (schema v11), `js/storage/campaignVault.js` | n/a | Same shapes as SRD records, `source: "custom"`, cannot shadow builtin | **Fixed 2026-07-13:** the campaign vault used to drop `state.content` at save/project/hydrate, so custom content silently vanished on reload (only full backups kept it); now pinned by vault round-trip tests + a reload smoke | — | — | — | — |
| 15 | Custom content authoring UX | ✅ | `js/ui/customContentManager.js`, `js/domain/customContentAuthoring.js` | n/a | **Shipped 2026-07-13 (batches 1–5):** Manage Custom Content dialog lists/removes every record (removal confirms with the names of referencing characters) and creates/edits **custom spells**, **custom feats** (prerequisites + the closed `effects` vocabulary), **custom races** (size/speed/ASIs/languages/lore + inline trait sub-records), and **custom classes** (hit die, saves/armor/weapon/tool profs, skill choices, ASI levels, inline **feature sub-records**, full/half/pact spellcasting with the standard SRD slot tables, `resources[]` pools, `grantedSpells`) through full forms — all-or-nothing multi-record saves, orphaned trait/feature cleanup on edit, inline plain-language validation, ids locked on edit, same domain rules as JSON import | **Acceptance criterion met** — a user can author a working custom class without hand-writing JSON. Not form-authorable (JSON import only, preserved verbatim through edits): subclasses/subraces, build-time `choices[]`, multiclassing blocks, starting equipment, threshold-recovery resources, custom slot tables | — | #14 | — | A user can author a working custom class without hand-writing JSON ✅ |
| 16 | Custom class expressiveness (the hard claim) | 🟡 | whole rules engine | n/a | **Consumable today, data-driven, no per-class hardcoding:** hit die/HP, proficiencies, skill choices, multiclass prereqs+gains, subclass level+list, ASI levels, `featuresByLevel`, subfeature choices, full/half/pact/non-caster progressions, cantrip/known caps, slot tables, **resource pools with recovery metadata (shipped 2026-07-12)** | **Not expressible:** prepared-formula variants, spellbook growth counts, expertise outside the hardcoded 4 feature-id set (class-level granted spells shipped 2026-07-13) | P2 | #6 | 6 | Custom prepared-formula/spellbook-growth overrides designed before implementation |
| 17 | Custom content deletion safety & dependencies | ✅ | `customContent.js`, `characterPortability.js#collectReferencedCustomContent` | n/a | Removing referenced content degrades soft (derivation warnings, no crash); **export bundles referenced custom records (2026-07-13)** and import adopts missing ones while never overwriting the destination's existing records | None material (destination-wins conflict semantics documented) | — | — | — | — |
| 18 | Migration & backward compatibility | ✅ | `js/state.js` (v12), `tests/state.migrate*.test.js`, `saveCompatibility.test.js` | Single lineage v0→v12 | Custom bucket migrates with campaign | None pending — Level Up Phase 1 required no schema change (verified) | — | — | — | — |
| 19 | Accessibility & mobile | 🟡 | wizard focus traps, aria labels, phone-width smokes | Level Up + builder wizard verified at 380px | n/a | Abilities & Features menu keyboard pass still queued (roadmap); no automated a11y audit | P2 | — | 9 | Keyboard-only run of both wizards + panels documented |
| 20 | Licensing & attribution | ✅ | `LEGAL.md`, `js/ui/dataPanel.js` (About dialog), `tests/attribution.test.js` | CC-BY-4.0 statement in repo **and** in-app (Data & Settings → About → Legal / Licenses), pinned by a release-gate test (2026-07-13 audit correction: the in-app surface already existed) | Custom content untouched by attribution | None | — | — | — | — |

## 2. What the audit explicitly rejects

- **"Custom content persistence" ≠ "full custom-class support."** Persistence (#14) is
  done; expressiveness (#16) is not. A custom class is complete only when the rules
  engine and both wizards consume its structured progression — today that is true for
  progression/spellcasting/choices but **false for resources, class-granted spells, and
  expertise metadata**, and there is no authoring UX (#15).
- **"Architecture exists" ≠ "feature complete."** `classSpecificByLevel` ships in the
  data but nothing reads it; the matrix keeps #2 open until code consumes it.

## 3. Current authorized sequence (2026-07-12, second session)

**Level Up Phase 2 — derived class resources: shipped 2026-07-12.**
`js/domain/rules/classResources.js` derives shared pools (data-driven counts +
closed SRD rules vocabulary), `deriveCharacter()` exposes `derivedResources`,
Finish seeds `character.resources[]` duplicate-aware via the
`class-resource:<poolId>` `builderSeed` marker, Level Up grows pools by delta
with spent uses preserved, and custom classes author pools via the `resources[]`
schema (content-registry-plan.md → Class Resources). No schema migration was
needed.

**B1, B2, B3, and the attribution gate all shipped 2026-07-13**, plus
class-level granted spells (#6/#16) and the ASI 20-cap guidance (#5).

**#15 custom content authoring UX: complete (batches 1–5, finished
2026-07-14).** The authoring domain (`js/domain/customContentAuthoring.js`)
and the Manage Custom Content dialog (`js/ui/customContentManager.js`) cover
spells, feats, races (inline trait sub-records), and classes (inline feature
sub-records, full/half/pact spellcasting on the standard SRD slot tables,
`resources[]` pools, `grantedSpells`). The same session fixed the
campaign-vault persistence bug that was silently dropping `state.content` on
reload (#14 note). **The last P1 is closed.**

**Matrix #9's on-demand "Recalculate from Build" (shipped 2026-07-14) was
superseded 2026-07-15** by the unified calculation contract
(`docs/reference/character-calculation-contract.md`). Owner authorization
ruled that routine manual recalculation is not the intended model and the
Recalc dialog's Apply failed in production preview. Attacks now derive **live**
through one canonical calculator (`js/domain/attackCalculation.js`) for builder
and freeform characters: structured `calc` block (weapon/ability/spell/fixed),
automatic updates on ability/proficiency change, explicit adjustments,
intentional fixed mode, marker-based provenance and re-seed dedup, and safe
legacy conversion in the per-row editor (the broken Recalc dialog and
`attackRecalculation.js` were removed). The same session added the reusable
choice-based granted-spell mechanism and the **High Elf wizard-cantrip choice**
(#6-adjacent — filtered spell choice, Finish gating, INT provenance,
non-caster seeding).

**Audit F2 — spell DC/attack, AC, max HP snapshot→derived: shipped
2026-07-16/17** (owner-authorized 2026-07-15). Optional per-field calc blocks
on the open entry shape (no migration): derived by default for new builder
characters, explicit adjustments, intentional fixed overrides, legacy
snapshots preserved verbatim with an adoption-safety stamp rule and
editor-based conversion; per-source spellcasting profiles (never one universal
DC); Defense fighting style and structured Dwarven Toughness added to the
engine; calc-aware Level Up/rest/tracker/combat surfaces with temporary combat
AC. See `docs/audits/character-calculation-audit-2026-07.md` → Phase B and the
contract doc. Remaining open items, in rough order: subclass 1-use
feature-action counters (#13 follow-up), partial-regain recovery modes (#8,
design first), prepared-formula/spellbook-growth overrides (#16, design
first), equipment depth (#10, product decisions), Half-Elf ability/skill
choices and Tiefling cantrip grant (choice audit, deferred), freeform
initiative F1, and the keyboard-only a11y pass (#19). (The 2026-07-17
follow-up for production-preview compatibility of the 7 dev-only smoke
harnesses was completed 2026-07-18; both smoke gates are 61/61 — see
`docs/reference/session-handoff-2026-07-18.md`.) Handoff:
`docs/reference/session-handoff-2026-07-17.md`.

**Restore Character / Edit-in-Builder retirement — specification ratified 2026-07-18
(owner-directed), implementation not authorized.** The owner ratified the product
model: the Builder is for initial creation; the general Edit in Builder action will
retire; a complete pre-Level-Up snapshot is saved transactionally with every
successful Level Up commit; **Restore Character** restores any snapshot as a separate
playable copy (new stable ID, source and current characters untouched, snapshots
retained until individually deleted, included in backups). Normative design:
`docs/reference/restore-character-spec.md` (data model `characters.snapshots` +
schema v13, identity/naming rules, single-vault-write transaction, backup collector
additions, grouped-by-character dialog UI, phases R1–R6). Dependency audit + the four
open owner decisions (D1–D4) gating the retirement phase:
`docs/audits/edit-in-builder-retirement-audit-2026-07.md`. Matrix impact when
implemented: #11's B1 routing surfaces are re-decided (D1) and this matrix gains a
Restore Character capability row.

## 4. Verification basis

F2 structured vitals audited 2026-07-17: **1219 unit tests (72 files)**,
dev-mode smoke gate **61/61** (incl. the three-part `structuredVitals.smoke.js`),
and the new production-preview gate (`playwright.preview.config.js`, real
`dist/` build) green for every F2-related suite (54/61 overall; the 7 failures
were pre-existing dev-only harnesses that import source modules — follow-up
filed); manual production-preview acceptance at desktop and 380px recorded in
the Phase B section of the calculation audit. **Update 2026-07-18:** the 7
dev-only harnesses were reworked onto preview-safe seams (real campaign-shell
lifecycle + direct IndexedDB reads) and the production-preview gate is now
**61/61**; the rework also fixed a character-page teardown leak
(`destroyActiveCharacterPageUI()`). Prior basis (attacks/High-Elf,
2026-07-15): 1135 unit tests (66 files), 58 smokes. Statements about unconsumed
data (`classSpecificByLevel`) were grep-verified against `js/domain/rules/*`.
