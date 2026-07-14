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
with preserved manual offsets).

Documented legacy policies that predate this contract and remain acceptable until a
future authorized batch:

- **`ac`, `spellDC`, `spellAttack`, `hpMax`** are seeded snapshots governed by the
  Level Up spec's _accumulate_ (`hpMax`) and _recompute-if-untouched_ policies. A
  manual edit today acts as an implicit fixed override. This is a known contract
  deviation; converting these to derived-plus-adjustment needs its own owner-scoped
  batch because existing sheets store bare totals.
- **Freeform `initiative`, `speed`, `hitDieAmt/Size`** are manual inputs on freeform
  sheets (no build data exists to derive speed/hit dice from; initiative could derive
  from DEX and is listed in the audit as a follow-up).

**Attacks are brought into conformance by the 2026-07-14 session** — see
"Structured Attacks" in [`content-registry-plan.md`](./content-registry-plan.md).

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

## Rules for future work

1. New sheet values must be classified into the four categories at design time, and
   the classification recorded in the value's reference doc.
2. Never persist a derived total as the only source of truth for a value that has
   structured inputs.
3. Never erase an adjustment during recalculation; never invent a fixed override
   from a typed total.
4. Both character modes go through the same calculator; mode-specific behavior is
   limited to _which inputs exist_, not _how math works_.
