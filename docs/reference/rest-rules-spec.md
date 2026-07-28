# Rest Rules — Short Rest and Long Rest

_Status: **canonical expectations**. Written 2026-07-09._

This document is the reference for what Short Rest and Long Rest are expected to do in
Lore Ledger, under SRD 5.1. It is the authority when rest behavior is implemented or
changed.

Read with [`AGENTS.md`](../../AGENTS.md) (wins on conflict) and
[`builder-scope-greenlist.md`](./builder-scope-greenlist.md).

> **Implementation status.** `js/domain/characterRest.js` now applies modeled resource
> recovery, spell slots, HP, Hit Dice, and death saves. Builder prepared casters use the
> Long Rest flow; freeform prepared flags remain manual/DM-managed. This document still
> defines the behavior and boundaries for any future rest change.
>
> **Prepared Correctness C1 (2026-07-27).** §4's prepared-spell rules are implemented as
> written. Before C1 three of them were not: the selection heading rendered `0 / capacity`
> regardless of the real selection, every count was hidden until the player chose "Yes",
> and granted/always-prepared spells were offered as ordinary picks that consumed
> preparation capacity. `js/domain/rules/preparedSpells.js` now owns the whole prepared
> model — see §4.1.
>
> **Prepared Sheet Synchronization C1.1 (2026-07-28).** The sheet's spell-row `prepared`
> flag now follows `rest.preparedByClass` in both directions for actively recommitted
> classes, and the Long Rest commit seeds **spells only** — see §4.3.

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
- A character normally cannot benefit from **more than one long rest in a 24-hour
  period**, but that limit is table/DM-enforced in Lore Ledger. The app does **not**
  persist a rest timestamp or block a Long Rest from a wall-clock check.

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

### 4.1 The prepared-spell plan (Prepared Correctness C1, 2026-07-27)

`js/domain/rules/preparedSpells.js` is the **single owner** of every prepared-spell rule.
`getPreparedSpellPlan(character, registry)` is pure and registry-injected;
`getBuilderPreparedSpellOptions()` is its registry-bound accessor and
`validateBuilderPreparedSpellSelections()` its commit guard. No UI module may reproduce a
capacity, class-list, spellbook, grant-exclusion, or multiclass spell-level formula.

Per prepared caster the plan reports `classId`, `className`, `preparationMode`,
`formulaCapacity`, `ordinaryCandidateIds`, `grantedIds`, `selectedIds`,
`effectiveCapacity`, `limitedBy`, and `maxSpellLevel`.

**Two capacities, never collapsed:**

- `formulaCapacity` — the rules entitlement (class level, or half class level for a half
  caster, plus the spellcasting ability modifier, minimum 1). It stays `null` when the
  ability modifier is unknown. **`null` means unknown and is never coerced to `0`.**
- `effectiveCapacity` — `min(formulaCapacity, ordinaryCandidateIds.length)`, i.e. how many
  ordinary spells the character can actually hold prepared today, or `null` when the
  formula is unknown.
- `limitedBy` — `"formula"` (the normal case), `"candidates"` (fewer eligible spells exist
  than the formula allows — an under-filled wizard spellbook, or a class with no spell
  list), or `"unknown"`. The Long Rest dialog uses it to explain an unreachable target in
  plain language instead of silently displaying one.

**Candidate rules:**

- Granted / always-prepared spells are excluded from `ordinaryCandidateIds` and from
  `selectedIds`, are reported separately as `grantedIds`, and never consume capacity.
- Wizards (and any custom `spellbook` class) draw candidates from their spellbook;
  Cleric, Druid, and Paladin draw from their class spell list. Custom spells participate
  through the same `classIds` membership as builtin ones.
- **Multiclass:** each caster's `maxSpellLevel` comes from *its own* class slot table at
  *its own* class level, as if it were single-classed. Combined multiclass slots let a
  character cast a lower-level spell with a higher slot; they never unlock higher-level
  candidates for a class whose own table has not reached that level.
- Unresolvable spell ids, a missing slot table, a malformed build, and a deleted custom
  class all fail soft: they yield fewer candidates or no plan entry, never a false prompt
  and never a destructive cleanup.

### 4.2 Prepared commit semantics

Prepared updates **merge** into the normalized `rest.preparedByClass` map. The Long Rest
dialog submits only the classes whose ordinary selection actually changed (order is not
meaningful, so unchecking and rechecking the same spell is not a change).

- Choosing "No" submits nothing; the stored map is preserved verbatim.
- Choosing "Yes" without editing submits nothing and does not rewrite prepared state.
- Untouched classes — including a class whose content is temporarily unresolvable, and
  classes holding legacy or redundant ids — are carried through verbatim.
- A class actively recommitted stores only valid ordinary prepared ids; clearing a class
  drops its key rather than storing an empty array.
- There is **no load-time cleanup, no migration, and no silent mutation.**

Granted spells reach the sheet through `derived.grantedSpells` in
`getBuilderFinishSheetSeedPatch()`, not through `rest.preparedByClass`, so a granted spell
stays always-prepared on the sheet regardless of what the prepared list contains.

### 4.3 Prepared Sheet Synchronization (C1.1, 2026-07-28)

`rest.preparedByClass` is authoritative; the sheet spell row's `prepared` boolean is a
**projection** of it. Before C1.1 that projection was write-only: seeding was additive, so a
deselected ordinary spell simply stopped appearing in the seed set and its row kept
`prepared: true` on both the Character and Combat Spells surfaces, and on disk. (The defect
predates C1 — C1 only made deselection a routine, correctly-guided action. Wizards were
accidentally exempt, because every spellbook entry is re-seeded at `prepared: false`.)

`getLongRestPreparedSheetPatch(character, preparedClassIds, registry?)` in
`js/domain/builderSheetSeeding.js` closes it, called from the Long Rest mutation in
`characterPage.js` with the classes the dialog actually submitted. It reads only
`getPreparedSpellPlan()`, so no second source of prepared rules exists.

Projection contract:

- Eligible rows are the **ordinary candidates of the actively recommitted classes** only. A
  manual `Prepared` override on a class the player did not touch survives untouched.
- A row is prepared when **any** prepared caster currently prepares that spell, so a spell
  shared by two classes stays prepared while either still holds it.
- Granted rows (`builderGranted`) and manual rows (no `builderSpellId`) are never eligible.
- Only the `prepared` boolean is written. Row ids, names, notes, known/spellbook status,
  expended state, and markers are byte-identical. **No row is created or deleted by the
  sync** (the additive pass still adds a row for a newly prepared spell).
- A class with no resolvable plan entry — deleted custom content, no longer a prepared
  caster — contributes nothing and fails soft.
- **No load-time repair, no migration, no new persisted field.** Rows left stale by a
  pre-C1.1 build self-correct the next time that class is actively recommitted; they never
  self-correct on render, and nothing rewrites saved spell arrays in bulk.

**Long Rest seeding is spells-only.** The rest commit previously ran the entire
`getBuilderFinishSheetSeedPatch()`, so a prepared change could silently restore features,
languages, proficiencies, attacks, inventory pockets, resources, or vitals the player had
edited or deleted. It now returns `{ spells }` and nothing else. Creation Finish, Edit in
Builder, Complete Choices, and Level Up keep full seeding unchanged.

---

## 5. P0 implementation coverage

- Short Rest spends available Hit Dice per class/die pool, rolls with Constitution, and
  applies only modeled short-rest recovery plus Pact Magic.
- Long Rest restores tracked HP, modeled slots/resources, eligible Hit Dice, and death
  saves; it requires at least 1 tracked current HP.
- Builder Cleric, Druid, Paladin, and Wizard prepared selections are made through the
  Long Rest flow. Known-spell casters and freeform characters do not use that selector.
- **Prepared Correctness C1 (2026-07-27)** completed §4's prepared rules: accurate
  current-versus-effective counts visible before the Yes/No choice, read-only granted
  spells that consume no capacity, per-class multiclass candidate levels, and a merging
  commit. See §4.1–§4.2.
- **Prepared Sheet Synchronization C1.1 (2026-07-28)** made the sheet agree with that
  commit — a deselected ordinary row now clears — and narrowed the Long Rest seed to
  spells only. See §4.3. **Not in C1 or C1.1** and still open: creation-time prepared caps,
  any underfill confirmation at creation or Long Rest, a Summary prepared row, the Level Up
  capacity-formula divergence (`getLevelUpPlan()` computes capacity from build abilities
  only, so it disagrees with the Long Rest value when `overrides.abilities` is set),
  `builderGranted` presentation in the Spells panel, an `aria-live` announcement for the
  live prepared count, and the dead `getPreparedSpellCapacity()` accessor.

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
- Long Rest does not persist or enforce a 24-hour timestamp; that rule stays with the table/DM.

Prepared-plan coverage (C1) lives in `tests/preparedSpells.test.js` and
`tests/restFlow.test.js`, with the merge contract in `tests/characterRest.test.js` and the
granted-access guarantee in `tests/builderSheetSeeding.test.js`:

- Cleric / Druid / Paladin / Wizard formula capacity, and the minimum-1 clamp.
- Unknown capacity stays `null`; the picker is not offered as a usable control.
- A wizard spellbook smaller than the formula bounds `effectiveCapacity`.
- Granted spells are excluded from candidates, from counts, and from capacity.
- Granted spell access survives a redundant stored id disappearing on recommit.
- Each multiclass caster uses its own class table; combined slots never widen candidates.
- Custom prepared classes with zero candidates, custom granted spells, deleted custom
  classes, and malformed/unresolvable ids all fail soft.
- "No" and a no-edit "Yes" both preserve the stored map verbatim; changing one class
  preserves every untouched class.

Sheet-projection coverage (C1.1) lives in `tests/preparedSheetSync.test.js`, with the page
wiring in `tests/characterPage.test.js` and the real-surface pass in
`tests/smoke/characterRest.smoke.js`:

- Deselect, deselect-all, and reselect move the row's flag in both directions.
- Granted rows, manual rows, and freeform characters are never written.
- A shared multiclass spell stays prepared until every prepared caster drops it.
- Recommitting one class never rewrites rows owned only by an untouched class.
- Row ids and every non-`prepared` field survive; no row is created or deleted by the sync.
- Default seeding callers are byte-identical (no sync ids means no projection).
- A Long Rest does not restore deleted features, proficiencies, attacks, inventory, or
  resources, and does not rewrite AC or calculation metadata.
- The Character and Combat Spells surfaces agree after apply and after reload.
- The Long Rest dialog is keyboard-operable and free of horizontal overflow at 380px.

Acceptance: no rest action silently fails, none affects the wrong character, unsupported
recovery modes are left unchanged rather than guessed, and `npm run verify` plus
`npm run test:smoke` pass.
