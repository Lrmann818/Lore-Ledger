# Character Calculation Contract

_Canonical. Ratified by owner authorization on 2026-07-14. This document defines how
every calculated value on the character sheet must behave, for both builder-created
and manually entered (freeform) characters._

## The product contract

> Builder-created characters and manually entered characters use the same
> character-sheet rules engine. Numbers entered through the Builder and numbers
> entered manually must interact with the rest of the character sheet in the same way.

The difference between the two character types is **what they remember**, not **how
they calculate**:

- Builder characters retain structured creation choices (`build`) and receive the
  rules-aware Level Up workflow.
- Manually entered characters (`build: null`) do not receive the automatic Level Up
  workflow, because they lack structured build provenance.
- Manual entry is **not** a mode of disconnected text fields or stale copied totals.
  Manual controls exist so users can enter their own inputs and represent homebrew
  adjustments — not to disable calculation.

This refines, and does not repeal, the existing "freeform and builder modes must
remain distinct" rule: the modes stay distinct in _provenance and guarded editing_,
while sharing one calculation engine (`js/domain/rules/deriveCharacter.js` and the
domain calculators it feeds).

## The four value categories

Every number a panel shows belongs to exactly one of these categories.

### 1. Inputs

Facts the user (or the Builder) supplies and calculations consume: ability scores,
level(s), proficiency selections, weapon/armor/shield data, spellcasting ability,
damage dice, resource formulas, race/class/feat/feature selections, and structured
manual entries (a freeform character's ability scores, manual proficiency bonus,
skill proficiency toggles, and structured attack fields are all inputs).

Inputs are persisted. Editing an input is always allowed through its owning surface
(guarded wizard flows for structural build choices; the normal sheet for play-state
inputs).

### 2. Derived values

Values calculated from current inputs: ability modifiers, attack bonus, damage
modifier, save totals, skill totals, spell save DC, spell attack bonus, initiative,
AC, HP maximum, resource maximums, passive scores.

**Derived values update automatically when their dependencies change.** They are
computed at render time from canonical state — never stored as the source of truth
— unless an explicitly documented policy (below) says otherwise. Nobody should have
to press a button to make a derived value catch up with its inputs.

### 3. Adjustments

Explicit homebrew or situational modifiers stored **separately** from the calculated
base so recalculation never erases them: `overrides.abilities/saves/skills/initiative`,
skill `misc`, freeform `saveOptions`, and structured attack
`attackAdjustment` / `damageAdjustment`.

Display rule: `displayed = derived(inputs) + adjustments`.

### 4. Fixed overrides

An intentional, visible user choice to stop deriving one value and use a fixed value
instead. Fixed overrides must be explicit — **the app must not silently infer that a
manually typed total is a fixed override.** A fixed value stays fixed until the user
intentionally returns it to calculated mode.

> **Derived by default, adjusted through explicit modifiers, fixed only through an
> intentional override.**

## Current conformance (audited 2026-07-14)

Full audit: [`docs/audits/character-calculation-audit-2026-07.md`](../audits/character-calculation-audit-2026-07.md).

Conforming today: ability scores/modifiers, saving throws, skills/expertise
(live-derived for both modes with explicit adjustments), builder speed / proficiency
/ initiative / hit dice (live-derived, read-only), class resources (derived pools
with preserved manual offsets), **and — as of the 2026-07-17 F2 session — spell
save DC / spell attack, Armor Class, and maximum HP** through the Structured
Vitals model below. See
[`docs/audits/character-calculation-audit-2026-07.md`](../audits/character-calculation-audit-2026-07.md)
→ "Phase A/B" for the audit and the implementation record.

Documented policies that predate this contract and remain acceptable until a
future authorized batch:

- **Freeform `initiative`, `speed`, `hitDieAmt/Size`** are manual inputs on freeform
  sheets (no build data exists to derive speed/hit dice from; initiative could derive
  from DEX and is listed in the audit as a follow-up).

**Attacks conform as of the 2026-07-15 session** — see "Structured Attacks" in
[`content-registry-plan.md`](./content-registry-plan.md).

## Attack calculation ownership (normative)

- One canonical calculator (`js/domain/attackCalculation.js`) computes attack bonus,
  damage, range, and type from structured attack inputs plus `deriveCharacter()`
  output. Builder Finish seeding, manual structured attacks, the attack editor
  preview, the character-page Attacks panel, and the combat embedded Weapons panel
  all call it. There is no second formula anywhere.
- A structured attack (one carrying a `calc` block) **derives its display values
  live**. Changing Strength, proficiency bonus, a linked weapon record, or any other
  dependency changes the displayed values automatically — no Recalculate action.
- Explicit `attackAdjustment` / `damageAdjustment` values survive every
  recalculation. `name`, `notes`, `id`, and row order are always user-owned.
- `calc.mode: "fixed"` is the intentional fixed override for attacks: the stored
  strings are the display, and nothing recalculates until the user switches modes.
- Attacks without a `calc` block are **legacy snapshots**: they keep their stored
  strings, never update automatically, and convert only through the explicit,
  preview-first editor flow (link a weapon, enter structured inputs, or confirm
  fixed mode). Display names are never used to infer a source weapon.
- Proficiency is a stored, user-visible input on each structured attack
  (`calc.proficient`), defaulted from the character's derived proficiencies when a
  weapon is chosen, never assumed merely because an attack is weapon-backed.

## Structured Vitals ownership (normative — F2; implemented 2026-07-17)

Armor Class, maximum HP, spell save DC, and spell attack bonus follow the same
three-state model as attacks. Each keeps its existing flat snapshot field
(`character.ac` / `hpMax` / `spellDC` / `spellAttack`) **and** may carry an
**optional** structured calc block on the open character-entry shape — the exact
`AttackEntry.calc` / `builderSeed` precedent, so **no schema migration** is
required (`sanitizeForSave` leaves entries as-is).

Implementation map: `js/domain/spellcastingCalculation.js`,
`js/domain/armorClassCalculation.js`, `js/domain/hpMaxCalculation.js` (one
display resolver per field over the existing engine formulas), the Vitals-panel
tiles + calculation editors in `js/pages/character/panels/vitalsPanel.js`
(shared by the combat embedded Vitals panel), calc-aware Finish/Level Up
policies in `js/domain/builderSheetSeeding.js`, and calc-aware side surfaces in
`js/domain/cardLinking.js` / `js/domain/combatEncounterActions.js` /
`js/domain/characterRest.js`.

```js
character.acCalc     = { mode: "derived" | "fixed", adjustment: number }
character.hpMaxCalc  = { mode: "derived" | "fixed", adjustment: number }
character.spellcastingCalc = {           // spell DC + attack (they share a source)
  mode: "derived" | "fixed",
  bySource: { [sourceKey: string]: { dcAdjustment: number, attackAdjustment: number } },
  freeform?: Array<{ ability: string, dcAdjustment: number, attackAdjustment: number }>,
  fixed?: { dc: number | null, attack: number | null }
}
```

Behavior, identical in spirit to attacks:

- **No calc block → legacy snapshot.** The stored flat value is shown verbatim
  and never auto-updates. This is the safety default: every existing sheet keeps
  its exact bytes and behavior, and adoption is always an explicit user action.
  Display names / bare totals are never reinterpreted.
- **`mode: "derived"` → derived + adjustment.** `displayed = derive(inputs) +
  adjustment`, updating live when dependencies change (ability scores,
  proficiency, worn armor/shield, Con, level). The flat field is kept as a
  cached mirror so registry-less surfaces (combat cards, tracker party/NPC
  cards) stay correct. Derivation is builder-only for AC and HP (a freeform
  sheet has no structured armor or level history); spell DC/attack derive in
  **both** modes once a spellcasting ability is known.
- **`mode: "fixed"` → intentional fixed override.** The stored flat value is
  shown and never auto-updates; adjustment does not apply. This is the explicit
  replacement for today's implicit "a typed number sticks."

Field-specific rules:

- **Spellcasting is modeled as profiles, not one universal scalar.** The derive
  layer already produces one profile per spellcasting source
  (`spellcasting.classes[]` each with its own `ability`/`saveDc`/`attackBonus`,
  plus `grantedSpells[].spellcastingAbility` for race grants such as the High Elf
  INT cantrip). The sheet shows a derived DC/attack pair per distinct source
  ability, each labeled with its provenance. Never display one misleading
  universal DC when sources use different abilities. Freeform casters declare
  their own profile(s) by picking an ability; DC = `8 + proficiency +
  mod(ability)`, attack = `proficiency + mod(ability)`.
- **AC formula selection** stays deterministic via `computeArmorClass`, which
  picks the best eligible formula (worn armor always wins while equipped; else
  the best unarmored-defense formula vs `10 + Dex`) and returns a human-readable
  `formula` string surfaced in the editor preview and the tile provenance line.
  Mutually exclusive formulas are never combined; **bonuses** (shield where the
  formula allows it, the Defense fighting style **only while wearing armor**,
  structured feat `acBonus`) stack onto the selected formula. Equipment state is
  the primary input — equipping armor selects the armor formula even when an
  unarmored formula would be higher; a user who wants a different valid total
  uses the explicit adjustment or fixed override.
- **Calc-managed AC/HP on side surfaces.** Linked tracker cards and combat
  participant seeding resolve the displayed value through
  `getDisplayedArmorClass` / `getDisplayedHpMax`, so every surface agrees with
  the sheet. Linked-field writes to a calc-managed `ac`/`hpMax` are declined
  (`writeCardLinkedField` returns `written: false`; the card input renders
  read-only) — a derived value is never silently overwritten and a fixed value
  is never silently changed from a side surface. **Temporary combat AC**: for a
  calc-managed character, a combat-card AC edit stays participant-local (it
  layers over the calculated base and wins while set; clearing the input
  returns to the calculated value). Legacy characters keep the historical
  canonical write-through behavior byte-for-byte.
- **Max HP interacts with current HP.** When a derived/fixed max drops below
  `hpCur`, `hpCur` is clamped to the new max (consistent with the combat clamp
  `Math.min(hpMax, hpCurrent + healing)`). Increasing the max never auto-heals
  except through the shipped Level Up delta. Temp HP is untouched. Freeform max
  HP has no level history to derive from and stays a manual input. Short/Long
  Rest resolve the healing cap through `getDisplayedHpMax`, so rests heal to
  the displayed max. Structured per-level race bonuses (Hill Dwarf
  `hpPerLevelBonus`) and feat effects are part of the derivation.
- **Freeform sheets.** Spell DC/attack derive for freeform characters once they
  declare casting abilities through the editor (profiles, same math). Freeform
  AC and max HP have no derivable base, so their tiles keep the plain manual
  input with **no** calc affordance — an explicit "fixed" state would behave
  identically to the manual input and only add ceremony.

Legacy adoption (the safe path for existing sheets):

1. Existing flat totals are retained and marked as legacy (no calc block).
2. The user opens the field editor and chooses a mode/ability with a live
   preview of the calculated result.
3. They pick calculated, calculated + adjustment, or fixed. Cancel/Escape never
   mutates. The stored number's meaning is never inferred automatically.

**Adoption-safety stamp rule (Finish seeding).** Builder Finish/Edit re-seeds
stamp a `derived` calc block only when doing so cannot change what the user
sees: the stored flat value must be empty or already equal to the current
derived value. A diverged legacy value (a manual edit under the old snapshot
model) stays a legacy snapshot until the user adopts a calculation through the
editor. An existing block is never overwritten by a re-seed; in derived mode
the re-seed refreshes the flat mirror (adjustment included).

The Level Up patch (`getLevelUpSheetSeedPatch`) keeps accumulate/recompute
policies for legacy (no-calc-block) fields; a field in `derived` mode simply
re-derives its mirror (for HP, current HP moves by the max delta so a wound gap
survives), and a `fixed` field is left alone and reported as preserved.

## Rules for future work

1. New sheet values must be classified into the four categories at design time, and
   the classification recorded in the value's reference doc.
2. Never persist a derived total as the only source of truth for a value that has
   structured inputs.
3. Never erase an adjustment during recalculation; never invent a fixed override
   from a typed total.
4. Both character modes go through the same calculator; mode-specific behavior is
   limited to _which inputs exist_, not _how math works_.
