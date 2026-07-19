# Level Up Flow — Implementation Spec

_Status: **Phase 1 implemented and shipped 2026-07-12.** Revised 2026-07-09._

> **Sequencing guard.** Phase 1 (this document's in-scope contract) is implemented:
> `js/pages/character/levelUpWizard.js` + `getLevelUpPlan()` in
> `js/domain/rules/progression.js` + `getLevelUpSheetSeedPatch()` in
> `js/domain/builderSheetSeeding.js`, covered by `tests/progression.levelUp.test.js`,
> `tests/levelUpSheetSeeding.test.js`, the `level up flow` suite in
> `tests/characterPage.test.js`, and `tests/smoke/levelUp.smoke.js`. Phases 2/3,
> down-leveling, and audit-feature batches remain blocked — see §11 and the binding
> [Working Order](../../AGENTS.md#current-working-order).

Adds a **Level Up** action to the character action menu for builder-created
characters: a narrow, guided wizard that **appends exactly one level**, walks only the
choices that level actually unlocks, previews the result, and applies it.

Read with [`AGENTS.md`](../../AGENTS.md),
[`builder-scope-greenlist.md`](./builder-scope-greenlist.md),
[`content-registry-plan.md`](./content-registry-plan.md), and
[`rest-rules-spec.md`](./rest-rules-spec.md) (prepared-spell selection lives there, not
here). UX reference — **structure and editable surfaces only, never visual design** —
`docs/reference/fifth-edition-character-sheet/.../03-level-up-flow`.

---

## 1. What already exists

### 1.1 The build model is already level-indexed

`build.levels[i]` describes character level `i + 1` as `{ classId, hp }`.
Multiclassing is just the ordered sequence of `classId`s. Adding a character
level is literally `appendLevel(build, classId)`.

This is the single most important fact in this spec: **the data model needs no
change to represent a level-up.** Level-up is an append plus the choices that
append unlocks.

### 1.2 The progression primitives are pure and sufficient

Every rule the level-up flow needs already exists as a pure function over
`(build, registry)` — no state, no DOM:

| Need | Existing function |
| --- | --- |
| Add the level | `appendLevel(build, classId)` |
| Multiclass legality | `checkMulticlassPrerequisites(classId, abilityTotals, registry)` |
| Features gained | `getBuildFeatures(levels, subclassByClass, registry)` |
| ASI/feat slots | `getAsiSlots(levels, registry)` |
| Spell slots + pact | `getCombinedSpellSlots(levels, registry)` |
| Cantrip/known caps | `getSpellcastingClasses(levels, registry)` |
| Max HP | `computeMaxHp(levels, conMod, registry, { perLevelBonus })` |
| Hit dice pools | `getHitDicePools(levels, registry)` |
| Per-class totals | `getClassLevelTotals(levels)` |

The level-up flow computes a **before** and an **after** by calling these twice
— once on the current build, once on a cloned build with the new level appended.
Everything the summary must show is the diff of those two results.

### 1.3 Proficiency bonus and most derived stats are already live

For builder characters the sheet **derives on every render** rather than reading
stored fields:

- `basicsPanel.js` — class/level label, race, background
- `vitalsPanel.js` — speed, hit dice, **proficiency bonus**, initiative
- `abilitiesPanel.js` — ability totals, saves, skills
- `abilitiesFeaturesPanel.js` — derived feature-action cards

So the spec requirement _"update proficiency bonus when total character level
reaches the relevant thresholds"_ requires **zero work**. Same for speed, hit
dice, initiative, skills, saves, and the class/level label. They follow
`build.levels.length` automatically the moment the level is appended.

### 1.4 Seeding is already additive and idempotent

`getBuilderFinishSheetSeedPatch()` appends missing feature lines, languages,
proficiencies, attacks, spells, and inventory pockets. It dedupes by a
normalized line key (`featureLineDedupKey`) and by a stable `builderSeed` marker
on inventory pockets, so it survives user renames and re-runs.

Character entries pass through `sanitizeForSave()` **as-is** (no field
allowlist), which is why `inventoryItems[].builderSeed` persists with no schema
change. Any new marker field on an existing entry array behaves the same way.

### 1.5 Rest and prepared-spell behavior is shipped

P0 rest behavior is the baseline, not work for Level Up to rebuild:

- Short Rest and Long Rest already recover their modeled HP, Hit Dice, slots, resources,
  Pact Magic, and death-save state.
- `rest.preparedByClass` is authoritative play-state for builder-managed prepared casters.
- Cleric, Druid, Paladin, and Wizard prepared selections change through Long Rest.
- Wizard `build.spellcasting.wizard.knownIds` represents the spellbook; Level Up may append
  newly earned spellbook additions, but it must not choose the prepared subset.
- Bard, Ranger, Sorcerer, and Warlock use known-spell choices when a newly appended level
  actually grants additional known spells.
- Cantrips are chosen during Level Up only when the before/after progression delta grants
  additional cantrips.
- A later Short or Long Rest must continue operating on the slot totals established by a
  completed level-up without any special Level Up recovery path.

---

## 2. Phase 1 scope and current gaps

### Phase 1 — in scope

Phase 1 is one guarded, cancelable flow for a builder character at total level 1-19. It:

- appends **exactly one** class level, either continuing a current class or multiclassing
- asks only for subclass, feature/subfeature, expertise, ASI/feat, cantrip, known-spell, and
  wizard spellbook choices newly unlocked by that appended level
- collects the new level's Hit Point roll/average choice
- derives a before/after plan and shows a summary before any state mutation
- applies the draft atomically to the same active character that opened the flow
- updates stored HP and spell-slot totals with level-up-specific delta semantics
- appends newly gained sheet content duplicate-aware without overwriting user-owned edits
- preserves rest play-state, including prepared selections and spent Hit Dice
- supports keyboard/focus safety, cancellation, level-20 disabling, and mobile-width layout

### Explicitly out of Phase 1

- down-leveling or reverse progression
- adding more than one level in one flow
- Level Up for freeform/manual characters (`build: null`)
- changing race, subrace, background, starting ability method, or choices from earlier levels
- choosing or rewriting prepared-spell lists; that remains a Long Rest responsibility
- the Wizard spell-copying workflow outside level-earned spellbook additions
- deriving or synchronizing class resource counters from `classSpecificByLevel`
- broad feature-use/resource automation, class-specific bespoke UI, or new recovery modes
- expanding builtin content beyond the SRD 5.1 greenlist
- fixing the adjacent Edit-in-Builder down-level HP issue
- builder-only panel retirement, spell/feature audit batches, or any other audit-feature work
- a shared modal-framework refactor

### Current implementation gaps

These are the load-bearing findings. Everything else in this spec is assembly.

#### Gap A — Stored vitals never grow after creation

`hpMax`, `hpCur`, `ac`, `spellDC`, `spellAttack` are **stored, user-editable
play-state fields**, not live-derived. `getBuilderFinishSheetSeedPatch()` fills
them _only when empty_:

```js
if (derived.hp?.max != null && finiteNumberOrNull(source.hpMax) == null) {
  patch.hpMax = derived.hp.max;
}
```

On a level-up these fields are already populated, so the existing seed patch is
a no-op for all of them. Re-running Finish-time seeding after appending a level
will **not** change HP max. A level-up-specific patch is required.

#### Gap B — Spell slot totals never grow after creation

Same shape, in `getSeededSpells()`:

```js
if (finiteNumberOrNull(level.total) == null) { level.total = slot.count; ... }
```

A wizard going 2 → 3 keeps `total: 2` on the 1st-level slot row forever.

Note the naming trap: `level.used` tracks **currently available** slots, not
spent ones, as confirmed by `recoverSpellSlotsForRest()` and the Spells panel's
Reset control. Growing a slot row means raising `total` _and_ raising `used` by
the same delta, clamped to `[0, total]`.

#### Gap C — Class resource counters are not derived at all

`game-data/srd/classes.json` **already ships** `classSpecificByLevel`:

```json
"barbarian": { "classSpecificByLevel": { "3": { "rage_count": 3, "rage_damage_bonus": 2, ... } } }
```

Nothing reads it. `deriveCharacter()` produces exactly one `derivedFeatureAction`
(Dragonborn Breath Weapon). `character.resources[]` is a hand-managed counter
list owned by the vitals panel. So _"update class resource counters when the new
level changes them"_ has the data but no code.

This is a separate future task, not a Phase 1 prerequisite. See §7 for the split.

#### Gap D — Skill choices are stored under a hardcoded level key

`renderClassChoicesStep()` writes class and multiclass skill choices with
`levelKey: "1"` regardless of the level at which the class was taken. A
level-scoped renderer therefore **cannot filter by `levelKey`**; it must filter
by _what the appended level newly unlocked_ (computed from the before/after
diff), then let `writeChoice()` place the value wherever the existing convention
puts it.

`pruneStaleChoices()` is safe here: level-up only appends, so `collectActiveChoiceIds()`
only grows, so nothing is pruned.

---

## 3. Minimal reusable pieces

Reuse as-is, no changes:

- All of `progression.js` (add one new pure helper, §4.1).
- `deriveCharacter()` for before/after preview. **Never reshape its return
  value** — vitals, abilities, basics, and builder-summary panels read it live.
- `clonePlainBuild()` from `builderWizard.js` — required. The active character's
  `build` is a dev-mode mutation-guard Proxy, and `structuredClone()` throws
  `DataCloneError` on it. Promote this to a shared module (§5).
- `appendMissingFeatureLines()`, `appendMissingListLabels()`, `appendMissingLines()`,
  `featureLineDedupKey()`, `newSeedId()` in `builderSheetSeeding.js`.
- The overlay/focus-trap/`AbortController` pattern and `enhanceSelectDropdown()`
  usage from `builderWizard.js`. Copy the pattern; **do not** add a modal
  framework (hard ban).
- `requireMany()` DOM guards.
- The `onFinish` edit branch in `characterPage.js` as the apply template.

Do **not** reuse:

- `renderClassesStep()` / `renderClassChoicesStep()` / `renderSpellsStep()` —
  they render the _entire build's_ choices. Level-up needs a level-scoped view.
  Rather than adding filter parameters to four heavily test-pinned renderers,
  write narrow level-up-specific renderers that share the small primitives
  (`makeSelect`, `renderMultiPickChoice`, `readChoice`/`writeChoice`). Export
  those primitives from `builderWizardSteps.js`; leave the step renderers alone.
- The ability-method machinery (manual/standard array/point buy/roll). Level-up
  never sets base scores. ASI increases are stored as choices, not base edits.

---

## 4. Phase 1 data model and invariants

**No changes to `build`.** No schema-version bump. No `migrateState()` step.

Level-up writes only into existing structures:

| Write | Where |
| --- | --- |
| The new level | `build.levels.push({ classId, hp })` (via `appendLevel` + `setLevelHpAt`) |
| Subclass pick | `build.subclassByClass[classId]` |
| Fighting style / expertise | `build.choicesByLevel[<lvl>]["feature-<id>"]` |
| ASI / feat | `build.choicesByLevel[<lvl>]["asi-<lvl>"]` |
| Multiclass skills | `build.choicesByLevel["1"]["multiclass-skill-<classId>"]` (Gap D) |
| New cantrips | append only newly granted choices to `build.spellcasting[classId].cantripIds` |
| New known spells | append only newly granted choices to `build.spellcasting[classId].knownIds` |
| Wizard spellbook additions | append newly earned spells to `build.spellcasting.wizard.knownIds` |
| Prepared capacity | no persisted choice; derive and display before/after only |
| Prepared selections | **no write**; preserve `rest.preparedByClass` exactly |

Phase 1 invariants:

1. **One flow, one appended level.** The draft starts from the current build and its level
   count must increase by exactly one. Apply refuses a level-20 character or any draft with
   a different level-count delta.
2. **Draft isolation.** Opening, navigating, going Back, validation failure, and Cancel do
   not mutate character state and do not mark the save dirty.
3. **Same-character apply.** Capture the opening character ID. If the active character
   changes while the flow is open, cancel with a clear status message and mutate neither
   character. Recheck the ID inside the mutation callback, matching the shipped rest guard.
4. **Atomic commit.** Apply validates the complete draft and patch before one
   `mutateCharacter()` call. A successful apply marks dirty once, rerenders once, and closes
   the flow; errors leave the original character unchanged.
5. **Prepared ownership does not move.** `rest.preparedByClass` remains authoritative.
   Existing `build.spellcasting[classId].preparedIds` may remain for compatibility but is
   neither the Phase 1 source of truth nor a Level Up write target.
6. **Spell deltas are additive.** Existing cantrips, known spells, Wizard spellbook entries,
   granted spells, prepared selections, spell notes, descriptions, and expended flags are
   preserved. Only the exact newly granted number of choices may be appended.
7. **Slot availability is preserved.** Internal `used` means available slots. When a slot
   total grows, add the same delta to `used` and clamp it to the new total; do not refill
   previously spent slots. Short/Long Rest later refills against the new totals normally.
8. **User-owned sheet data survives.** Notes, inventory and pocket titles, equipment,
   attacks, conditions, death saves, `rest.hitDiceSpent`, manual feature cards,
   `featureUses` current counts, and diverged manual overrides are never overwritten.
9. **No duplicate canonical stores.** Live-derived values remain derived; mutable play-state
   stays in its existing canonical character fields. Phase 1 adds no parallel level-up or
   prepared-spell store.
10. **Content stays in scope.** Builtin options resolve through the active registry and the
    SRD 5.1 greenlist. Phase 1 does not add or hardcode content records in UI modules.

### 4.1 One new pure function

```js
// js/domain/rules/progression.js — additive export
/**
 * @returns {{
 *   fromLevel: number, toLevel: number, classId: string, classLevel: number,
 *   isNewClass: boolean,
 *   subclassRequired: { classId: string, options: string[] } | null,
 *   newFeatureIds: string[],
 *   featureChoiceIds: string[],
 *   asiSlot: { characterLevel, classId, classLevel } | null,
 *   multiclassSkillChoiceId: string | null,
 *   hitDie: number | null,
 *   spellcastingDelta: Array<{
 *     classId, preparationMode,
 *     cantripsGained, knownGained, spellbookGained,
 *     preparedCapacityBefore, preparedCapacityAfter,
 *     newSpellLevels: number[], grantedSpellIds: string[]
 *   }>,
 *   slotsBefore: number[], slotsAfter: number[],
 *   pactBefore: {...} | null, pactAfter: {...} | null,
 *   proficiencyBonusBefore: number, proficiencyBonusAfter: number,
 *   prerequisiteWarnings: string[]
 * }}
 */
export function getLevelUpPlan(build, classId, registry) { /* before/after diff */ }
```

Pure, testable, no DOM, no state. This is where every "does the new level grant
X?" question is answered exactly once. For prepared casters it reports capacity and new
spell levels but never asks for or returns a prepared selection.

### 4.2 One additive marker field (only if §7 Phase 2 lands)

`character.resources[].builderSeed` — e.g. `"class-resource:barbarian:rage_count"`.
`CharacterResource` is already `{ id, name, cur, max, [key: string]: unknown }`,
and `sanitizeForSave()` passes entries through untouched, so this needs **no
migration** — exactly the `inventoryItems[].builderSeed` precedent.

---

## 5. UI flow

### Entry point

`index.html`: new menu item after "Edit in Builder":

```html
<button type="button" class="swatchOption charActionMenuItem"
        data-char-action="level-up">Level Up</button>
```

Enabled only when `isBuilderCharacter(activeCharacter)` **and**
`normalizeBuildLevels(build).length < MAX_CHARACTER_LEVEL` — mirror the existing
`editBuilderButtons` disable logic in `characterPage.js`. At level 20 the item stays
visible but disabled with `aria-disabled="true"`.

### The wizard

New overlay `#levelUpOverlay` / `#levelUpPanel`, styled with a narrower
`max-width` than `#builderWizardPanel`, reusing existing modal/step/validation
classes from `styles.css`. Additive CSS only.

Steps are **skipped when they have nothing to ask** — same `isStepAvailable()` /
`getNextStep()` pattern as the builder wizard. A Fighter going 4 → 5 sees Class →
Features → HP → Summary. A Wizard going 1 → 2 sees Class → Subclass → Spells →
HP → Summary.

| # | Step | Shown when | Writes |
| --- | --- | --- | --- |
| 1 | **Class** | always | draft-only `appendLevel` |
| 2 | **Subclass** | new class level == `subclassLevel` and none stored | `subclassByClass` |
| 3 | **Features** | new level grants features with `subfeatureOptions` or expertise; plus read-only list of unchosen new features | `choicesByLevel` |
| 4 | **ASI / Feat** | `getAsiSlots()` gains a slot at the new level | `choicesByLevel["asi-<lvl>"]` |
| 5 | **Spells** | any spellcasting delta (cantrips, known, spellbook, prepared capacity, new slot level) | append cantrip/known/spellbook choices only; prepared capacity is read-only |
| 6 | **Hit Points** | always | `setLevelHpAt` |
| 7 | **Summary** | always | nothing — Apply commits |

Every write in this table targets the isolated draft. No step mutates the active character;
Apply is the only commit point.

**Step 1 — Class.** Radio: _Continue as \<current class\>_ (default, preselected)
vs _Multiclass_. Choosing Multiclass reveals a class select. Unmet SRD multiclass
prerequisites render as a **non-blocking warning**, matching
`renderClassesStep()`'s existing "allowed, but house-rules territory" copy. Also
show a new-class multiclass skill choice here when the class grants one (Gap D).

**Step 2 — Subclass.** Only when the appended level is the class's
`subclassLevel` and `subclassByClass[classId]` is unset. Required to continue.

**Step 3 — Features.** Two zones: choices that need input (Fighting Style,
Expertise) rendered with the shared `renderMultiPickChoice()` primitive, and a
read-only "You also gain" list of the new level's other features with their
`desc`.

**Step 4 — ASI / Feat.** Reuse the exact `renderAsiSlot()` shape: mode select
(ASI +2 total / Feat), then two +1 ability selects or a feat select.

**Step 5 — Spells.** Show **only the delta**:

- a cantrip picker only when `cantripsGained > 0`
- known-spell picks only for Bard, Ranger, Sorcerer, or Warlock when `knownGained > 0`
- level-earned Wizard spellbook additions, stored in Wizard `knownIds`
- prepared capacity and newly available spell levels as information only for Cleric, Druid,
  Paladin, and Wizard
- automatically granted subclass/domain/oath spells as read-only gained content

Existing selections render as locked context so earlier choices cannot be silently re-picked.
New slot levels are announced, not chosen. This step must not read or write
`rest.preparedByClass` as a Level Up choice, must not open the Long Rest prepared-spell
selector, and must not alter legacy `preparedIds`. If current prepared selections are shown
for context, they are read-only and sourced from `rest.preparedByClass`.

**Step 6 — Hit Points.** Per the reference flow: current max, the new level's
hit die, and three affordances — **Max**, **Average** (`die/2 + 1`, the model
default when `hp` is left null), **Roll** (uses the injected `rollDie` seam, so
tests stay deterministic) — plus a manual numeric input. Shows the arithmetic:
`roll + Con modifier = +N HP`.

> The build model stores **only the die roll** in `levels[i].hp`; `computeMaxHp()`
> applies the Con modifier and any `hp_per_level_bonus` feat effect. The
> reference app's "Misc Bonus" field has no home in this model and is
> deliberately omitted — a feat that grants per-level HP already flows through
> `collectFeatEffects()`.

Ordering note: HP comes **after** ASI because an ASI that raises Constitution to
the next even score retroactively raises max HP at every level. Asking for HP
first would show a stale Con modifier.

**Step 7 — Summary.** A before → after diff table, not a character sheet:

```text
Level                 4 → 5
Class                 Fighter 4 → Fighter 5
Proficiency Bonus     +2 → +3
Max HP                31 → 39   (rolled 6 + Con +2)
Hit Dice              4d10 → 5d10
New Features          Extra Attack
Spell Slots           unchanged
```

Plus a **preserved** section listing anything the apply step will deliberately
_not_ touch (see §6): `Armor Class 18 — manual value kept`.

Cancel at any step discards the draft entirely. Apply is the only commit.

---

## 6. Apply semantics

Apply mutates through `mutateCharacter()` (which calls `SaveManager.markDirty()`),
following the `onFinish` edit branch. The character's `build` is replaced with the
draft; then a **level-up-specific patch** is applied.

### 6.1 Target guard and transaction order

1. Capture the opening character ID and an immutable/plain before snapshot.
2. Build and validate the full draft without touching live state.
3. Before Apply, confirm the active character still has the captured ID.
4. Inside `mutateCharacter()`, confirm the callback character has that ID again.
5. Compute/apply the build replacement and sheet patch as one mutation.
6. Mark dirty once, rerender once, close, and show success.

> **Restore Character R1 (2026-07-18):** step 5's mutation now also appends one
> complete **pre-Level-Up snapshot record** to `state.characters.snapshots`
> immediately before the build/patch writes — constructed from the step-1 plain
> before-copy after all validation, so open/cancel/invalid/failed applies never
> capture, and the single vault write persists the snapshot and the advanced
> character together. See `docs/reference/restore-character-spec.md` §4.

If either identity check fails, close/cancel safely, show that Level Up was canceled because
the active character changed, and mutate neither the opening nor newly active character.

### 6.2 Two update policies, chosen per field

| Policy | Fields | Rule |
| --- | --- | --- |
| **Accumulate** | `hpMax`, `hpCur`, spell slot `total`/`used` | Apply the _delta_ between derived-before and derived-after. Preserves any manual offset the user had. |
| **Recompute-if-untouched** | `ac`, `spellDC`, `spellAttack` | If the stored value equals derived-before, set it to derived-after. If it diverges, the user overrode it: **leave it, and surface it in the summary's Preserved list.** |

> **Structured Vitals overlay (F2, 2026-07-17).** These two policies now apply
> only to **legacy** fields (no calc block). A field carrying a `derived` calc
> block (`spellcastingCalc`/`acCalc`/`hpMaxCalc` — see
> `docs/reference/character-calculation-contract.md` → "Structured Vitals
> ownership") re-derives its flat mirror at Level Up (adjustment included; for
> HP, `hpCur` moves by the max delta so a wound gap survives, clamped to the
> new max). A `fixed` field is left alone and reported in the Preserved list
> ("… — fixed value kept"). Legacy behavior is byte-identical to the table
> above.

Worked example for HP:

```text
delta   = computeMaxHp(levelsAfter).max − computeMaxHp(levelsBefore).max
hpMax  += delta
hpCur  += delta      // gaining a level grants the HP immediately
```

`delta` accounts for a Con-raising ASI across _all_ levels, because
`computeMaxHp()` applies the Con modifier per level. If `conModifier` is null,
`computeMaxHp()` returns `max: null`; skip the HP patch and warn in the summary
rather than writing garbage.

### 6.3 Never overwritten

Notes, feature notes, spell notes, inventory items and pockets, pocket titles,
manual feature cards, `featureUses` current counts, attack rows the user edited,
death saves, conditions, `rest.hitDiceSpent`, `rest.preparedByClass`, and any diverged manual
override. Additive-only, per `content-registry-plan.md` "Seeded Editable Content Ownership".

### 6.4 Idempotence

Applying the same level-up twice must be impossible (the flow appends exactly one
level and closes), but **re-seeding** must still be safe, because
`getBuilderFinishSheetSeedPatch()` also runs on "Edit in Builder". Therefore:

- New feature text goes through `appendMissingFeatureLines()` — dedupes on the
  `Name (Class N)` head, so an edited description is not re-appended.
- New spells dedupe by name within their level row.
- New attack rows dedupe by weapon name.
- Slot `total` is **set**, not incremented, when the seed patch runs from Edit
  mode; only the level-up patch applies deltas.

That last point is the sharp edge: the accumulate policy is correct **only** for
the level-up entry point. `getBuilderFinishSheetSeedPatch()` must keep its
fill-only-when-empty behavior for Edit-in-Builder. Implement the level-up patch
as a **separate exported function**, not a flag on the existing one.

> **2026-07-18 note:** Edit in Builder is slated for retirement
> (`docs/reference/restore-character-spec.md`), but the fill-only-when-empty rule
> outlives it — the same Finish seed patch also runs from the **Long Rest**
> prepared-spell path (`characterPage.js` rest action), so the two-policy split in
> this section remains binding after retirement.

---

## 7. Recommended phasing

The spec's resource requirement (Gap C) is a different piece of work from the
level-up flow, and bundling them makes both harder to review.

**Phase 1 — Level Up flow.** Exactly the in-scope contract in §2, excluding class resource
counters. The summary may list a newly gained feature whose rules mention Rage, Ki, Sorcery
Points, or another class resource, but Phase 1 makes no claim that the corresponding
counter changed. The user continues managing existing counters manually.

**Phase 2 — Derived class resources** _(authorized 2026-07-12, second session)_. Consume
`classSpecificByLevel` in `deriveCharacter()` as an additive `derivedResources` field,
seed/update `character.resources[]` duplicate-aware via the `builderSeed` marker, bumping
`max` while preserving `cur`. This stands on its own and also fixes resources for
_creation_, not just Level Up.

**Phase 3 — Level Up consumes derived resources.** Once Phase 2 exists, the
level-up patch bumps seeded resource `max` values by delta and the summary shows
`Rage 2 → 3`.

Attempting Phase 2 inside Phase 1 would touch `deriveCharacter.js`,
`abilitiesFeaturesPanel.js`, `vitalsPanel.js`, and `characterRest.js` on top of
the level-up surface — well past the ~3-file scope circuit breaker.

Completing Phase 1 does not authorize Phase 2 or Phase 3.

---

## 8. Files likely to change

### Phase 1

| File | Change |
| --- | --- |
| `index.html` | `data-char-action="level-up"` menu item; `#levelUpOverlay` panel markup |
| `js/pages/character/levelUpWizard.js` | **New.** `initLevelUpWizard({ deps })` → `{ open, close, destroy }` |
| `js/domain/rules/progression.js` | **Additive export** `getLevelUpPlan()` |
| `js/domain/builderSheetSeeding.js` | **Additive export** `getLevelUpSheetSeedPatch(before, after, registry)` |
| `js/pages/character/builderWizardSteps.js` | Export existing primitives (`makeSelect`, `renderMultiPickChoice`, `readChoice`, `writeChoice`). No behavior change. |
| `js/pages/character/characterPage.js` | Wire menu action, enable/disable, `onApply` |
| `js/utils/` or `js/domain/characterHelpers.js` | Move `clonePlainBuild()` out of `builderWizard.js` so both wizards import it |
| `styles.css` | Additive `.levelUp*` classes; narrower panel width |

Eight files plus tests. `characterPage.js` and `builderWizardSteps.js` changes are
wiring and re-exports, not logic. If the level-up renderers start needing changes
inside `builderWizardSteps.js`'s step functions, **stop** — that is the scope
circuit breaker firing.

### Phase 2 (separate change)

`js/domain/rules/deriveCharacter.js`, `js/domain/builderSheetSeeding.js`,
`js/pages/character/panels/vitalsPanel.js`, `docs/reference/content-registry-plan.md`.

---

## 9. Regression tests needed

### New — `tests/progression.levelUp.test.js` (pure, fast, highest value)

- Single-class 4 → 5: `getLevelUpPlan` reports Extra Attack, no ASI, no subclass.
- Fighter 3 → 4: reports an ASI slot; 4 → 5 does not.
- Wizard 1 → 2: reports cantrips gained 0, two spellbook additions, prepared-capacity
  information, and increased slot totals without returning prepared choices.
- Cleric 1 → 2: `subclassRequired` is null (cleric picks at 1); Fighter 2 → 3
  reports `subclassRequired`.
- Multiclass Fighter 5 → Wizard 1: `isNewClass`, multiclass skill choice id,
  prerequisite warnings when Int < 13.
- Level 19 → 20 works; 20 → 21 returns null / is refused.
- Proficiency bonus before/after crossing 4 → 5, 8 → 9, 12 → 13, 16 → 17.
- Pact Magic: Warlock 1 → 2 grows pact slots, not the standard slot array.
- Multiclass caster level: Wizard 3 / Cleric 2 uses `MULTICLASS_SPELL_SLOTS[4]`.
- A known-spell caster asks for exactly the before/after known-cap delta and preserves all
  earlier known IDs.
- A class/level with no cantrip-cap increase offers no cantrip choice; a level with an
  increase asks for exactly that delta.
- Prepared casters report capacity/new spell levels only; no plan field contains a prepared
  list mutation.

### New — `tests/levelUpSheetSeeding.test.js`

- `hpMax` accumulates by delta; a user who set `hpMax = 99` keeps `99 + delta`.
- `hpCur` rises by the same delta; a wounded character stays wounded.
- Con-raising ASI at the level-up applies retroactive HP across all levels.
- `conModifier == null` → no HP patch, warning surfaced, nothing corrupted.
- Slot row `total` grows; `used` grows by the same delta and clamps to `total`.
- A spent-slots character keeps its spent slots (`used` not reset to `total`).
- `ac` equal to derived-before → updated. `ac` diverged → preserved and reported.
- Same for `spellDC` / `spellAttack`.
- New feature lines appended once; a user-edited description is **not**
  re-appended (exercises `featureLineDedupKey`).
- Inventory pockets, pocket titles, spell notes, and `featureUses` untouched.
- `rest.preparedByClass`, `rest.hitDiceSpent`, death saves, conditions, and manual resource
  current counts remain unchanged.
- Known-spell and Wizard spellbook additions append without deleting existing IDs.
- Cleric/Druid/Paladin/Wizard capacity changes do not modify `preparedIds` or
  `rest.preparedByClass`.
- Applying the patch to an already-leveled character is a no-op (idempotence).

### Extend — existing suites

- `tests/characterPage.test.js` — "Level Up" appears in the action menu; disabled
  for freeform characters; disabled at level 20; opening it does not mutate state;
  Cancel does not `markDirty()`; successful Apply appends one level and marks dirty once;
  a double-click cannot append twice. Mirror the existing
  `"cancels Create with Builder without creating or marking dirty"` cases.
  Remember: this suite uses the `FakeElement` harness, **not** jsdom — no
  `replaceChildren`.
- `tests/builderSheetSeeding.test.js` — assert Finish-time seeding still
  fill-only-when-empty for `hpMax` / `ac` / slot `total`. This is the guard that
  proves the level-up patch did not leak into the create/edit path.
- `tests/characterRest.test.js` — a short/long rest after a level-up refills to
  the **new** slot totals and still preserves `rest.preparedByClass`.
- `tests/data/referential-integrity.test.js` — every `subclassLevel` and
  `asiLevels` entry a level-up can reach resolves to real features.
- `tests/smoke/builderWizard.smoke.js` or a new `tests/smoke/levelUp.smoke.js` —
  create a Fighter 1, Level Up to 2, assert the sheet shows Fighter 2, HP grew,
  and Action Surge appears in Features. Playwright, real DOM.

### New — flow safety and spell-boundary coverage

- Start Level Up for character A, switch active character to B while the flow is open, and
  Apply: the flow cancels with a clear status and neither character changes.
- Cancel from every step: build, sheet fields, rest state, and dirty state are unchanged.
- Validation failure and malformed/missing registry data fail visibly without partial state.
- Bard/Ranger/Sorcerer/Warlock append only newly granted known spells.
- Wizard appends only level-earned spellbook entries; its prepared list remains unchanged.
- Cleric/Druid/Paladin show prepared-capacity changes without a prepared picker or write.
- Cantrip selection appears only for a positive cantrip-cap delta.
- Granted spells are shown/seeded as granted and are not counted as manual choices unless
  registry data explicitly requires a choice.
- A successful Level Up followed by Long Rest restores slots to the new totals; prepared
  Yes/No behavior remains unchanged.

### Phase 1 acceptance criteria

- The action is available only for valid builder characters below level 20.
- One successful Apply appends exactly one level; no Apply path can append zero or multiple
  levels.
- Only choices newly unlocked by that level are editable; earlier choices are locked context.
- Single-class and multiclass paths derive the correct subclass, feature, ASI/feat, HP,
  proficiency, slot, Pact Magic, and spell-choice deltas.
- Known-spell and Wizard spellbook additions are exact-delta and additive.
- Prepared casters receive capacity/new-level information only; `rest.preparedByClass` and
  compatibility `preparedIds` are unchanged.
- Cancel, validation failure, active-character switching, and apply errors cause zero
  character mutation and zero dirty-state changes.
- Successful Apply commits atomically to the opening character, marks dirty once, rerenders,
  and cannot be submitted twice.
- Manual overrides and user-owned notes, spells, attacks, inventory, resources, rest state,
  conditions, and death saves survive unchanged except for the explicitly documented HP,
  slot-total, and additive seeded-content patches.
- Subsequent Short/Long Rest behavior uses the new slot totals and retains all shipped P0
  recovery and prepared-spell behavior.
- Phase 1 adds no schema version, no parallel store, no class-resource automation, no
  down-leveling, no builtin content expansion, and no audit-feature work.
- `npm run verify` and `npm run test:smoke` pass, followed by a phone-width manual check of
  every step, focus containment, validation messages, summary, Cancel, and Apply.

### Manual verification before merge

`npm run verify`, then `npm run test:smoke`. Then `npm run preview` and level a
character up on a phone-width viewport — the panel is narrower than the builder
wizard and the HP step's Max/Avg/Roll row is the most likely thing to wrap badly.

---

## 10. Ratified decisions

_These were open questions. They are now **decided** (2026-07-09). Do not re-litigate
them, and do not implement against the alternatives._

1. **Down-leveling is out of scope.** Lore Ledger does not need a gameplay flow for
   removing levels. **Do not build reverse level-up logic.** Do not attempt to reverse HP
   gains, features, spells, ASIs, feats, resource counters, or multiclass progression as
   part of Level Up. A user who made a mistake can use "Edit in Builder" or create a
   corrected character.

   > **2026-07-18 update:** the ratified mistake remedy going forward is **pre-Level-Up
   > snapshots + Restore Character** (`docs/reference/restore-character-spec.md`):
   > restore the pre-mistake copy and redo the Level Up. Edit in Builder remains the
   > interim remedy only until its retirement (spec phase R5) ships.

   _Known adjacent bug, not introduced by this spec:_ "Edit in Builder" removes levels via
   `removeLevelAt()` but does not reverse the stored `hpMax`. Track separately; do not fix
   it inside the Level Up batch. (It retires together with Edit in Builder — audit item A5
   in `docs/audits/edit-in-builder-retirement-audit-2026-07.md`.)

2. **Level Up appends exactly one level.** It asks **only** for the choices that the
   newly-appended level actually unlocks. Steps with nothing to ask are skipped. It never
   re-opens earlier levels' choices; existing selections render as locked context rows.

3. **Prepared casters: capacity here, selection at rest.** Prepared-spell lists are
   editable play-state, not permanent build choices. Level Up shows newly available spell
   levels and prepared capacity before/after as **informational lines**. It must not force
   a permanent prepared list. Prepared selection routes through the Long Rest
   prepared-spell flow — see [`rest-rules-spec.md`](./rest-rules-spec.md).

   - **Known-spell casters** (Bard, Ranger, Sorcerer, Warlock) choose newly known spells
     **during Level Up**.
   - **Wizards** choose spellbook additions during Level Up; they prepare from the
     spellbook during a Long Rest.
   - **Cantrips** are chosen during Level Up when the class gains one.
   - **Granted spells** (domain/oath/patron/subclass) are shown and seeded as granted, not
     manually chosen, unless the data requires a choice.

4. **`used` slot semantics: do not rename.** The field is named `used` but stores
   _available_ slots. Confirmed in `js/domain/characterRest.js` and
   `js/pages/character/panels/spellsPanel.js`. **Do not rename it inside the Level Up
   work.** Do fix any user-facing label that says "Used" while displaying available slots.
   An internal rename is a separate cleanup change.

---

## 11. Sequencing guard

**Phase 1 is implemented** (authorized and completed 2026-07-12), recorded in the binding
[Working Order](../../AGENTS.md#current-working-order) in `AGENTS.md`. That authorization
covered Phase 1 only, and completing it authorizes nothing further:

- do not begin Phase 2/3 resource work
- do not begin B1/B2/B3 or any other audit-feature batch
- do not build down-leveling, builder-panel retirement, or builtin content expansion

Known Phase 1 implementation notes (intentional):

- Spell pickers cap selections at the exact delta but allow choosing fewer; unpicked
  grants are recoverable via Edit in Builder. (After Edit in Builder retires, this
  recovery promise needs the owner-decision D3 resolution — see
  `docs/audits/edit-in-builder-retirement-audit-2026-07.md` §3.)
- Optional feature/ASI choices are not hard-required at Apply (matching the creation
  wizard); only the newly unlocked subclass and a usable HP result are required.
- Seeded attack rows are user-owned and are not recalculated when proficiency grows.
