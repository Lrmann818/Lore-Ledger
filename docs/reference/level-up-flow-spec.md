# Level Up Flow — Implementation Spec

_Status: proposal. Not implemented. Written 2026-07-09._

Adds a **Level Up** action to the character action menu for builder-created
characters: a narrow, guided wizard that walks only the choices the next
character level actually requires, previews the result, and applies it.

Read with `AGENTS.md`, `docs/reference/builder-scope-greenlist.md`, and
`docs/reference/content-registry-plan.md`. UX reference (structure only, not
visual design): `docs/reference/fifth-edition-character-sheet/.../03-level-up-flow`.

---

## 1. What already exists

### 1.1 The build model is already level-indexed

`build.levels[i]` describes character level `i + 1` as `{ classId, hp }`.
Multiclassing is just the ordered sequence of `classId`s. Adding a character
level is literally `appendLevel(build, classId)`.

This is the single most important fact in this spec: **the data model needs no
change to represent a level-up.** Level-up is an append plus the choices that
append unlocks.

### 1.2 `js/domain/rules/progression.js` is pure and complete

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

---

## 2. What is missing — the four real gaps

These are the load-bearing findings. Everything else in this spec is assembly.

### Gap A — Stored vitals never grow after creation

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

### Gap B — Spell slot totals never grow after creation

Same shape, in `getSeededSpells()`:

```js
if (finiteNumberOrNull(level.total) == null) { level.total = slot.count; ... }
```

A wizard going 2 → 3 keeps `total: 2` on the 1st-level slot row forever.

Note the naming trap: `level.used` tracks **currently available** slots, not
spent ones (`js/domain/characterRest.js:55`, and `spellsPanel.js:416` refills
`used = total`). Growing a slot row means raising `total` _and_ raising `used`
by the same delta, clamped to `[0, total]`.

### Gap C — Class resource counters are not derived at all

`game-data/srd/classes.json` **already ships** `classSpecificByLevel`:

```json
"barbarian": { "classSpecificByLevel": { "3": { "rage_count": 3, "rage_damage_bonus": 2, ... } } }
```

Nothing reads it. `deriveCharacter()` produces exactly one `derivedFeatureAction`
(Dragonborn Breath Weapon). `character.resources[]` is a hand-managed counter
list owned by the vitals panel. So _"update class resource counters when the new
level changes them"_ has the data but no code.

This is a **prerequisite task, not a level-up task** — it is item #4 on the
handoff's next-fixes list. See §7 for the recommended split.

### Gap D — Skill choices are stored under a hardcoded level key

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
- The `onFinish` edit branch in `characterPage.js:292-315` as the apply template.

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

## 4. Data model changes

**No changes to `build`.** No schema-version bump. No `migrateState()` step.

Level-up writes only into existing structures:

| Write | Where |
| --- | --- |
| The new level | `build.levels.push({ classId, hp })` (via `appendLevel` + `setLevelHpAt`) |
| Subclass pick | `build.subclassByClass[classId]` |
| Fighting style / expertise | `build.choicesByLevel[<lvl>]["feature-<id>"]` |
| ASI / feat | `build.choicesByLevel[<lvl>]["asi-<lvl>"]` |
| Multiclass skills | `build.choicesByLevel["1"]["multiclass-skill-<classId>"]` (Gap D) |
| New spells | `build.spellcasting[classId].{cantripIds,knownIds,preparedIds}` |

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
 *   spellcastingDelta: Array<{ classId, cantripsGained, knownGained, preparedCapacityBefore, preparedCapacityAfter }>,
 *   slotsBefore: number[], slotsAfter: number[],
 *   pactBefore: {...} | null, pactAfter: {...} | null,
 *   proficiencyBonusBefore: number, proficiencyBonusAfter: number,
 *   prerequisiteWarnings: string[]
 * }}
 */
export function getLevelUpPlan(build, classId, registry) { /* before/after diff */ }
```

Pure, testable, no DOM, no state. This is where every "does the new level grant
X?" question is answered exactly once.

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
`editBuilderButtons` disable logic in `characterPage.js:378-381`. At level 20 the
item stays visible but disabled with `aria-disabled="true"`.

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
| 1 | **Class** | always | `appendLevel` |
| 2 | **Subclass** | new class level == `subclassLevel` and none stored | `subclassByClass` |
| 3 | **Features** | new level grants features with `subfeatureOptions` or expertise; plus read-only list of unchosen new features | `choicesByLevel` |
| 4 | **ASI / Feat** | `getAsiSlots()` gains a slot at the new level | `choicesByLevel["asi-<lvl>"]` |
| 5 | **Spells** | any spellcasting delta (cantrips, known, spellbook, prepared capacity, new slot level) | `build.spellcasting` |
| 6 | **Hit Points** | always | `setLevelHpAt` |
| 7 | **Summary** | always | nothing — Apply commits |

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

**Step 5 — Spells.** Show **only the delta**: `cantripsGained` new cantrip picks,
`knownGained` new known-spell picks, wizard spellbook additions, and — for
prepared casters — the new prepared capacity as an informational line (prepared
lists are play-state, re-chosen at rest, not a level-up decision). Existing
selections render as locked/disabled rows so the user sees context without being
able to silently re-pick. New slot levels are announced, not chosen.

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

### 6.1 Two update policies, chosen per field

| Policy | Fields | Rule |
| --- | --- | --- |
| **Accumulate** | `hpMax`, `hpCur`, spell slot `total`/`used` | Apply the _delta_ between derived-before and derived-after. Preserves any manual offset the user had. |
| **Recompute-if-untouched** | `ac`, `spellDC`, `spellAttack` | If the stored value equals derived-before, set it to derived-after. If it diverges, the user overrode it: **leave it, and surface it in the summary's Preserved list.** |

Worked example for HP:

```sudo
delta   = computeMaxHp(levelsAfter).max − computeMaxHp(levelsBefore).max
hpMax  += delta
hpCur  += delta      // gaining a level grants the HP immediately
```

`delta` accounts for a Con-raising ASI across _all_ levels, because
`computeMaxHp()` applies the Con modifier per level. If `conModifier` is null,
`computeMaxHp()` returns `max: null`; skip the HP patch and warn in the summary
rather than writing garbage.

### 6.2 Never overwritten

Notes, feature notes, spell notes, inventory items and pockets, pocket titles,
manual feature cards, `featureUses` current counts, attack rows the user edited,
death saves, conditions, and any diverged manual override. Additive-only, per
`content-registry-plan.md` "Seeded Editable Content Ownership".

### 6.3 Idempotence

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

---

## 7. Recommended phasing

The spec's resource requirement (Gap C) is a different piece of work from the
level-up flow, and bundling them makes both harder to review.

**Phase 1 — Level Up flow.** Everything above except class resource counters.
The summary's "New Features" list still names Rage / Ki / Sorcery Points changes
as text; the user updates their counter manually, exactly as they do today. This
is shippable and violates nothing.

**Phase 2 — Derived class resources.** Consume `classSpecificByLevel` in
`deriveCharacter()` as an additive `derivedResources` field, seed/update
`character.resources[]` duplicate-aware via the `builderSeed` marker, bumping
`max` while preserving `cur`. This is handoff item #4 and stands on its own — it
also fixes resources for _creation_, not just level-up.

**Phase 3 — Level Up consumes derived resources.** Once Phase 2 exists, the
level-up patch bumps seeded resource `max` values by delta and the summary shows
`Rage 2 → 3`.

Attempting Phase 2 inside Phase 1 would touch `deriveCharacter.js`,
`abilitiesFeaturesPanel.js`, `vitalsPanel.js`, and `characterRest.js` on top of
the level-up surface — well past the ~3-file scope circuit breaker.

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

Seven files plus tests. `characterPage.js` and `builderWizardSteps.js` changes are
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
- Wizard 1 → 2: reports cantrips gained 0, known gained 2, new slot level.
- Cleric 1 → 2: `subclassRequired` is null (cleric picks at 1); Fighter 2 → 3
  reports `subclassRequired`.
- Multiclass Fighter 5 → Wizard 1: `isNewClass`, multiclass skill choice id,
  prerequisite warnings when Int < 13.
- Level 19 → 20 works; 20 → 21 returns null / is refused.
- Proficiency bonus before/after crossing 4 → 5, 8 → 9, 12 → 13, 16 → 17.
- Pact Magic: Warlock 1 → 2 grows pact slots, not the standard slot array.
- Multiclass caster level: Wizard 3 / Cleric 2 uses `MULTICLASS_SPELL_SLOTS[4]`.

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
- Applying the patch to an already-leveled character is a no-op (idempotence).

### Extend — existing suites

- `tests/characterPage.test.js` — "Level Up" appears in the action menu; disabled
  for freeform characters; disabled at level 20; opening it does not mutate state;
  Cancel does not `markDirty()`. Mirror the existing
  `"cancels Create with Builder without creating or marking dirty"` cases.
  Remember: this suite uses the `FakeElement` harness, **not** jsdom — no
  `replaceChildren`.
- `tests/builderSheetSeeding.test.js` — assert Finish-time seeding still
  fill-only-when-empty for `hpMax` / `ac` / slot `total`. This is the guard that
  proves the level-up patch did not leak into the create/edit path.
- `tests/characterRest.test.js` — a short/long rest after a level-up refills to
  the **new** slot totals.
- `tests/data/referential-integrity.test.js` — every `subclassLevel` and
  `asiLevels` entry a level-up can reach resolves to real features.
- `tests/smoke/builderWizard.smoke.js` or a new `tests/smoke/levelUp.smoke.js` —
  create a Fighter 1, Level Up to 2, assert the sheet shows Fighter 2, HP grew,
  and Action Surge appears in Features. Playwright, real DOM.

### Manual verification before merge

`npm run verify`, then `npm run test:smoke`. Then `npm run preview` and level a
character up on a phone-width viewport — the panel is narrower than the builder
wizard and the HP step's Max/Avg/Roll row is the most likely thing to wrap badly.

---

## 10. Open questions

1. **Down-leveling.** Out of scope here. "Edit in Builder" already removes levels
   via `removeLevelAt()`, but it does not reverse the stored `hpMax`. Worth a
   separate look; it is an existing bug, not one this spec introduces.
2. **Prepared casters.** This spec treats prepared-spell _lists_ as play-state
   and only reports the new capacity. Confirm that matches the intended
   at-the-table workflow before building step 5.
3. **`used` slot semantics.** Named `used`, means _available_. Confirmed in
   `characterRest.js:55` and `spellsPanel.js:416`. Worth a rename in a separate
   cleanup change — do not rename inside the level-up work.
