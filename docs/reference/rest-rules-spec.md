# Rest Rules — Short Rest and Long Rest

_Status: **canonical expectations**. Written 2026-07-09._

This document is the reference for what Short Rest and Long Rest are expected to do in
Lore Ledger, under SRD 5.1. It is the authority when rest behavior is implemented or
changed.

Read with [`AGENTS.md`](../../AGENTS.md) (wins on conflict) and
[`builder-scope-greenlist.md`](./builder-scope-greenlist.md).

> **Implementation status.** Rest is **partially implemented**. `recoverCharacterForRest()`
> in `js/domain/characterRest.js` currently recovers explicitly tagged `resources[]`
> counters, manual feature-card `limitedUse` counters, derived feature uses, and spell
> slot usage. It does **not** currently touch HP, Hit Dice, or death saves. The gaps in
> §5 are known and are P0 core-rules work — do not treat the current code as the spec.

---

## 1. Rest applies to the active character only

Rest actions operate on the active character resolved through `getActiveCharacter(state)`.
Rest must behave correctly for **both** builder characters (`build !== null`) and freeform
characters (`build: null`), and must be safe across character switching.

Rest must never erase user-owned content: notes, inventory, spell notes, known spells,
spellbook entries, build choices, or manual overrides.

---

## 2. Short Rest

A short rest is at least 1 hour of light activity.

Expected effects:

- The character may spend **one or more available Hit Dice** to regain HP.
- Spending a Hit Die rolls that die and adds the character's **Constitution modifier** to
  the healing from that die.
- The character **cannot spend more Hit Dice than are currently available**.
- Healing is capped at the character's maximum HP.
- Spending Hit Dice **reduces** the available Hit Dice pool.
- When multiclassed, available Hit Dice are shown **per class / per die size**, and the
  user chooses which dice to spend.
- Short Rest resets resources and features explicitly tagged as recovering on a short rest.
- Warlock **Pact Magic** slots recover on a short rest.

Short Rest explicitly does **not**:

- restore HP automatically without spending Hit Dice
- restore ordinary (non-pact) spell slots
- restore long-rest-only resources

**Edge case to decide explicitly, not silently:** a negative Constitution modifier can make
a die's healing zero or negative. Clamp per-die healing at a minimum of `0`. The SRD does
not spell this out; this is Lore Ledger's product decision.

---

## 3. Long Rest

A long rest is at least 8 hours.

Expected effects:

- The character regains **all lost HP**.
- The character regains **spent Hit Dice up to half the character's total Hit Dice**
  (minimum of one die). This is _half the total_, not "reset to full", and not
  "half of character level" as some older notes claimed.
- Spell slot usage resets.
- Pact Magic slots reset (they also reset on a short rest).
- Resources and features tagged as recovering on a long rest reset.
- Resources tagged as recovering on _any_ rest reset, where that distinction is modeled.
- Death save state resets, if death saves are tracked.

Long Rest constraints:

- The character must have **at least 1 HP** at the start of the long rest to gain its
  benefits.
- A character cannot benefit from **more than one long rest in a 24-hour period**.

---

## 4. Prepared spells and rest

Prepared casters are **not** the same as known-spell casters, and the two must not be
collapsed.

> **Prepared spell selections normally change when finishing a Long Rest — not freely at
> any time.** Known spells normally change at Level Up — not at rest.

| Class | Spell model | Where the choice changes |
| --- | --- | --- |
| Cleric | Prepared | Long Rest prepared-spell flow |
| Druid | Prepared | Long Rest prepared-spell flow |
| Paladin | Prepared half-caster | Long Rest prepared-spell flow |
| Wizard | Spellbook + prepared | Prepared: Long Rest. Spellbook additions: Level Up / copying spells |
| Bard | Known | Level Up |
| Ranger | Known (in SRD 5.1) | Level Up |
| Sorcerer | Known | Level Up |
| Warlock | Known + Pact Magic | Level Up. Pact slots recover on short/long rest |

### Long Rest prepared-spell flow

When the user takes a Long Rest on a character with prepared spellcasting (Cleric, Druid,
Paladin, Wizard), prompt: _"Would you like to change your prepared spells?"_

- **No** — apply the Long Rest normally and preserve current prepared selections.
- **Yes** — open a prepared-spell selection step, then apply the prepared changes and the
  rest effects **together**.

Rules for the selection step:

- Show current prepared count and maximum prepared capacity.
- Allow deselect/select up to capacity.
- **Wizards** prepare from their **spellbook**, not the full wizard class list.
- **Clerics, Druids, Paladins** prepare from the class spell list, plus any
  always-prepared domain/oath/subclass spells.
- Always-prepared / granted spells display as granted and do **not** count against the
  prepared limit unless SRD data says otherwise.
- Handle each prepared caster class separately when multiclassed.
- Prepared changes must not erase spell notes, known spells, spellbook entries, or
  descriptions.

Known-spell casters (Bard, Ranger, Sorcerer, Warlock) do **not** get this flow.

If direct prepared-spell editing exists in the Spells panel, it should either route
through this same flow or clearly present itself as a manual/DM override.

---

## 5. Known gaps (P0 — not yet implemented)

These are documented expectations that current code does **not** meet. They are the
core-rules stabilization batch, and they come **before** Level Up work.

- HP is not restored on Long Rest.
- Hit Dice are not modeled for spending on Short Rest, nor recovered on Long Rest.
- Death saves are not reset on Long Rest.
- The Long Rest prepared-spell flow does not exist.
- The one-long-rest-per-24-hours and at-least-1-HP constraints are not enforced.

---

## 6. Spell slot field naming

The internal spell slot field is named `used`, but it stores **currently available**
slots, not spent ones (`used === total` means "full"). This is confirmed in
`js/domain/characterRest.js` and `js/pages/character/panels/spellsPanel.js`.

- **Do not rename this field** as part of rest or Level Up work.
- **Do** fix any user-facing label or example that reads "Used" while showing available
  slots.
- An internal rename is a separate, isolated cleanup change with its own migration
  considerations.

---

## 7. Resource recovery vocabulary

The `recovery` metadata on `resources[]`, on `manualFeatureCards[].limitedUse`, and on
derived `featureUses` is a **closed set**, defined in `js/domain/characterRest.js`:

```text
"shortRest" | "longRest" | "shortOrLongRest" | "manual" | "none"
```

Apply semantics (`recoveryMatchesRest()`):

- Short Rest resets `shortRest` and `shortOrLongRest`.
- Long Rest resets `longRest` and `shortOrLongRest`.
- `manual`, `none`, missing, and unrecognized values **never reset silently**. Leave them
  unchanged rather than guessing.

> There is no `anyRest` or `daily` recovery mode. Older planning prompts named them; they
> have never existed in the code. Do not introduce them as a side effect of rest work —
> adding a mode is a schema change and needs a migration.

---

## 8. Required tests when rest behavior is implemented

- Short Rest can spend Hit Dice and heal without exceeding max HP.
- Short Rest cannot spend unavailable Hit Dice.
- Short Rest does not fully heal by default.
- Short Rest restores Pact Magic slots and modeled short-rest resources.
- Long Rest restores current HP to max HP.
- Long Rest resets death saves, if tracked.
- Long Rest restores ordinary spell slots and Pact Magic slots.
- Long Rest restores modeled long-rest and short-or-long-rest resources.
- Long Rest recovers spent Hit Dice up to half total, never above max.
- Long Rest preserves notes, inventory, equipment, pockets, manual overrides, and
  prepared/known spells unless changed through the prepared-spell flow.
- The prepared-spell prompt appears for Cleric, Druid, Paladin, and Wizard.
- Choosing **No** preserves prepared spells; choosing **Yes** applies prepared changes and
  rest effects together.
- Prepared-spell changes preserve spell notes and descriptions.
- Rest actions are character-specific and stay correct across character switching.
- Rest is safe for both builder-created and freeform/manual characters.

Acceptance: no rest action silently fails, none affects the wrong character, unsupported
recovery modes are left unchanged rather than guessed, and `npm run verify` plus
`npm run test:smoke` pass.
