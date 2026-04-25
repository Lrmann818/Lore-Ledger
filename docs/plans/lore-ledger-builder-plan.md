# Lore Ledger — Character Builder: Cleanup & Implementation Plan

_Drafted: April 20, 2026 — Updated to reflect current Refactoring branch state_

---

## The Decision (Already Made)

SRD 5.1 is the primary source. SRD 5.2.1 is retired. Both are CC-BY-4.0 licensed — the
attribution requirement is identical and simple:

> "This work includes material taken from the System Reference Document 5.1 ("SRD 5.1") by
> Wizards of the Coast LLC and available at https://dnd.wizards.com/resources/systems-reference-document.
> The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License
> available at https://creativecommons.org/licenses/by/4.0/legalcode."

One statement in your README and an in-app credits page. That's it.

---

## Part 1: Branch Cleanup Checklist

### What's already done ✅

- SRD 5.1 PDF and TXT added to `docs/reference/`
- `species.json` renamed to `races.json` (empty, ready for data)
- `classes.json` emptied and ready
- Old 5.2.1 JSON data removed from `game-data/srd/`

### What still needs doing

---

### 1.1 — Rename: "species" → "race" throughout the codebase

This is the most significant cleanup task. Renaming `species.json` to `races.json` was the
right call, but the terminology runs through JS files, the state schema, HTML, and docs too.
Everything needs to be consistent.

**Files with "species" that need updating:**

`js/domain/rules/builtinContent.js`
- `BuiltinContentKind` typedef: `"species"` → `"race"`
- All stub entry `kind` fields: `"species"` → `"race"`
- All stub entry `id` fields: `"species_human"` → `"race_human"`, etc.
- `RULESET` constant: `"srd-5.2.1"` → `"srd-5.1"`
- `ruleset` field in typedef: `"srd-5.2.1"` → `"srd-5.1"`

`js/domain/characterHelpers.js`
- `DEFAULT_CHARACTER_RULESET`: `"srd-5.2.1"` → `"srd-5.1"`
- `speciesId: null` in builder character init → `raceId: null`
- Comment referencing "species" → "race"
- `isBuilderCharacter()` check: `build.speciesId` → `build.raceId`

`js/domain/rules/deriveCharacter.js`
- All `speciesId` references → `raceId`
- All `speciesEntry` references → `raceEntry`
- `getBuildContentId(build, "species")` → `getBuildContentId(build, "race")`
- `getContentByFlexibleId(registry, "species", ...)` → `getContentByFlexibleId(registry, "race", ...)`
- Warning strings that say "species" → "race"
- `race: build ? speciesEntry?.name` → `race: build ? raceEntry?.name`

`js/pages/character/panels/builderIdentityPanel.js`
- `BUILD_FIELD_BY_KIND` map: `species: "speciesId"` → `race: "raceId"`
- All `speciesSelect` variable references → `raceSelect`
- DOM selector `"#charBuilderSpeciesSelect"` → `"#charBuilderRaceSelect"`
- `BuiltinContentKind` type references: `"species"` → `"race"`
- `updateContentId("species", ...)` calls → `updateContentId("race", ...)`

`js/pages/character/panels/builderSummaryPanel.js`
- `speciesLabel` → `raceLabel`
- Display label `"Species"` → `"Race"`

`js/state.js`
- `speciesId?: string | null` in build typedef → `raceId?: string | null`

`index.html`
- One mention of "species" in builder panel comment → "race"
- DOM element `id="charBuilderSpeciesSelect"` → `id="charBuilderRaceSelect"`

`docs/reference/builder-scope-greenlist.md`
- Any "species" references → "race"
- `game-data/srd/species.json` filename reference → `game-data/srd/races.json`

`docs/reference/content-registry-plan.md`
- Any "species" references → "race"
- `game-data/srd/species.json` filename reference → `game-data/srd/races.json`

`docs/architecture.md`
- `build.speciesId` → `build.raceId`
- `species` terminology in builder descriptions → "race"

`docs/state-schema.md`
- `speciesId` in build typedef description → `raceId`
- `species` terminology → "race"

`./new-features-roadmap.md`
- "species" references in builder feature descriptions → "race"

`../features/multi-character-design.md`
- `species` references → "race"
- `speciesId` references → `raceId`
- `"kind": "species"` in schema examples → `"kind": "race"`

`AGENTS.md`
- Any "species" references → "race" where applicable

> ⚠️ **Note for Claude Code:** This is a terminology rename, not a logic change. Do not
> alter any business logic while making these changes. Change strings and identifiers only.
> Run the full test suite after completing this task to confirm nothing broke.

---

### 1.2 — Update version strings in docs and code

Every `"srd-5.2.1"` string needs to become `"srd-5.1"`. Do this as its own pass separate
from the species rename.

**Files:**

- `js/domain/rules/builtinContent.js` — `RULESET` constant and typedef
- `js/domain/characterHelpers.js` — `DEFAULT_CHARACTER_RULESET`
- `docs/reference/content-registry-plan.md` — many occurrences in schema examples
- `docs/reference/builder-scope-greenlist.md` — source tag examples
- `AGENTS.md` — "Current Builder Source of Truth" section and content registry rules

> ⚠️ **Note for Claude Code:** Run a project-wide search for `"srd-5.2.1"` after making
> these changes to confirm none remain.

---

### 1.3 — Update AGENTS.md policy sections

Beyond the version string, these sections need deliberate rewrites:

**"Current Builder Source of Truth"** — currently says:
> Active source: SRD 5.2.1 / Reference/archive only: SRD 5.1

Should say:
> Active source: SRD 5.1 / Retired: SRD 5.2.1 (data deleted from game-data/srd/)

**"Content Registry Rules"** — update `source` field example from `"srd-5.2.1"` to `"srd-5.1"`

**Add a new section: "SRD Data Fetch Pipeline"** — explaining that `game-data/srd/*.json`
files will be produced by running adapter scripts in `scripts/adapters/`, not hand-edited.
Coding agents should edit adapter scripts, not JSON files directly.

---

### 1.4 — Update srd-licensing-notes.md

This file currently designates 5.2.1 as primary and 5.1 as reference/fallback. That's now
backwards. Update:

- Flip primary/reference designations
- Remove the reasoning that 5.2.1 has "cleaner licensing" — both are CC-BY-4.0, this is
  no longer a differentiator
- Note that SRD 5.1 was re-released under CC-BY-4.0 in 2023
- Update "Current Working Recommendation" summary at the bottom
- Update attribution text to show the SRD 5.1 version

---

### 1.5 — Create LEGAL.md

Create `LEGAL.md` at the repo root containing the CC-BY-4.0 attribution statement (see
Part 6 of this document for the exact text). This is the complete licensing obligation —
no OGL text needed.

Also create a placeholder `docs/reference/attribution-requirements.md` noting that an
in-app attribution/credits page is required before public release (Phase 4 work).

---

### 1.6 — Check the #personal folder doc before handing off to Claude Code

There is a file at `docs/#personal/SRD building master prompts.md` in your local branch.
Review this manually before giving Claude Code any tasks. If it references 5.2.1 or
"species," update it to match the new direction — otherwise Claude Code may find it and
follow conflicting instructions.

---

### 1.7 — Equipment JSON filenames (note for later, do NOT do now)

Currently in `game-data/srd/`:
- `equipment.armor.json`
- `equipment.weapons.json`

The plan calls for eventually consolidating into a single `equipment.json`. Leave these
alone during cleanup. Renaming them is Phase 2 work once you know what shape the
equipment data needs to be.

---

### 1.8 — Run tests and verify

- [ ] `npm test` — full suite should pass
- [ ] Confirm no remaining `"srd-5.2.1"` strings: `grep -r "5.2.1" js/ --include="*.js"`
- [ ] Confirm no remaining `"species"` kind strings: `grep -r '"species"' js/ --include="*.js"`
- [ ] Confirm no remaining `speciesId` references: `grep -r "speciesId" js/ --include="*.js"`
- [ ] Commit: `chore: rename species→race, update SRD version to 5.1, clean up docs`

---

## Part 2: Data Architecture Plan

### 2.1 — How the data will flow

```
dnd5eapi.co/api/2014/     SRD 5.1 PDF (docs/reference/)
         ↓                      ↓
   [adapter scripts]        [reference]
         ↓
   game-data/srd/*.json   ← structured, shaped for Lore Ledger
         ↓
   js/domain/rules/registry.js   ← loads and indexes the JSON
         ↓
   builtinContent.js (stub entries remain for fallback/test)
         ↓
   Builder panels / Character sheet panels
```

The JSON files in `game-data/srd/` are your owned, versioned copy of the data. You do not
call dnd5eapi at runtime — you fetch and transform once during development, store the result
in your repo, and ship that. This keeps the app offline-capable and not dependent on a
third-party API.

### 2.2 — Phased data categories

**Phase 1 — Character Creator (blocks everything else)**

| dnd5eapi endpoint | Your JSON file | Status |
|---|---|---|
| `/races` + `/subraces` | `game-data/srd/races.json` | Empty ← ready |
| `/classes` + `/subclasses` | `game-data/srd/classes.json` | Empty ← ready |
| `/backgrounds` | `game-data/srd/backgrounds.json` | Empty placeholder |
| `/features` | `game-data/srd/features.json` | Doesn't exist yet |
| `/traits` | `game-data/srd/traits.json` | Doesn't exist yet |
| `/proficiencies` | `game-data/srd/proficiencies.json` | Doesn't exist yet |
| `/skills` | `game-data/srd/skills.json` | Doesn't exist yet |
| `/languages` | `game-data/srd/languages.json` | Doesn't exist yet |
| `/ability-scores` | `game-data/srd/ability-scores.json` | Doesn't exist yet |

**Phase 2 — Equipment & Inventory**

| dnd5eapi endpoint | Your JSON file |
|---|---|
| `/equipment` + `/equipment-categories` | `game-data/srd/equipment.json` |
| `/weapon-properties` | `game-data/srd/weapon-properties.json` |
| `/magic-items` | `game-data/srd/magic-items.json` |

This is where the Explorer's Pack auto-expansion lives. The existing `equipment.armor.json`
and `equipment.weapons.json` get replaced by the single `equipment.json` at this phase.

**Phase 3 — Spells & Combat**

| dnd5eapi endpoint | Your JSON file |
|---|---|
| `/spells` | `game-data/srd/spells.json` |
| `/magic-schools` | `game-data/srd/magic-schools.json` |
| `/damage-types` | `game-data/srd/damage-types.json` |
| `/conditions` | `game-data/srd/conditions.json` |

Note: spells is 300+ entries. Decide before Phase 3 whether it gets lazy-loaded or bundled.

**Phase 4 — Lore & Reference (your differentiator)**

| dnd5eapi endpoint | Your JSON file |
|---|---|
| `/rules` + `/rule-sections` | `game-data/srd/rules.json` |
| `/monsters` | `game-data/srd/monsters.json` |
| `/feats` | `game-data/srd/feats.json` |
| `/alignments` | `game-data/srd/alignments.json` |

### 2.3 — The adapter layer

Scripts that fetch from dnd5eapi and produce your JSON files. These live in `scripts/`
and run during development, not at runtime.

```
scripts/
  fetch-srd-data.js        ← orchestrator, fetches and runs adapters
  adapters/
    racesAdapter.js        ← /races + /subraces → races.json
    classesAdapter.js      ← /classes + /subclasses → classes.json
    backgroundsAdapter.js
    equipmentAdapter.js    ← handles pack expansion logic
    spellsAdapter.js
    ... etc
```

Build adapters one at a time, starting with races since that's the most visible gap.

### 2.4 — Schema notes for key categories

**Races**

5.1 races have fixed ASIs. Example target structure:

```json
{
  "id": "hill-dwarf",
  "kind": "race",
  "name": "Hill Dwarf",
  "source": "srd-5.1",
  "size": "Medium",
  "speed": 25,
  "abilityScoreIncreases": [
    { "ability": "con", "bonus": 2 },
    { "ability": "wis", "bonus": 1 }
  ],
  "traits": ["darkvision", "dwarven-resilience", "dwarven-combat-training",
             "tool-proficiency", "stonecunning", "dwarven-toughness"],
  "languages": ["common", "dwarvish"],
  "parentRace": "dwarf"
}
```

**Equipment packs**

Detect `isPack: true` and resolve contents into a pocket at character creation:

```json
{
  "id": "explorers-pack",
  "kind": "equipment",
  "name": "Explorer's Pack",
  "source": "srd-5.1",
  "equipmentCategory": "adventuring-gear",
  "isPack": true,
  "contents": [
    { "itemId": "backpack", "quantity": 1 },
    { "itemId": "bedroll", "quantity": 1 },
    { "itemId": "mess-kit", "quantity": 1 },
    { "itemId": "tinderbox", "quantity": 1 },
    { "itemId": "torch", "quantity": 10 },
    { "itemId": "rations-1-day", "quantity": 10 },
    { "itemId": "waterskin", "quantity": 1 },
    { "itemId": "hempen-rope-50-feet", "quantity": 1 }
  ]
}
```

---

## Part 3: Character Creator (Wizard) Implementation Plan

### 3.1 — What already exists

- `builderIdentityPanel.js` — race/class/background/level selection (needs species→race
  rename from Part 1, otherwise partially working)
- `builderAbilitiesPanel.js` — ability score entry
- `builderSummaryPanel.js` — summary step
- The `build` object on characters (data model is correct)
- The content registry system in `registry.js`
- Freeform vs. builder mode distinction enforced in code

What's missing: the **wizard shell** and **real data** behind the dropdowns.

### 3.2 — Wizard overlay architecture

A modal overlay that sits on top of the character page with step-by-step navigation.
Updates character state live as choices are made. Dismisses on Finish.

**Step order:**

1. **Identity** — Name, Race, Subrace (if applicable), Class, Background, Level
2. **Ability Scores** — Method choice (Standard Array / Point Buy / Roll / Custom),
   assign scores, racial bonuses shown
3. **Class Features** — Subclass (if level qualifies), class-specific choices
4. **Skills** — Choose from class + background skill lists
5. **Equipment** — Starting equipment choices, pack auto-expansion happens here
6. **Summary** — Review before committing

### 3.3 — Locked vs. free-edit logic

`isBuilderCharacter()` is the gate. Builder characters open edit modals on click;
freeform characters are directly editable.

**Wizard-locked in builder mode:** race, class, background, level, base ability scores,
race traits, class features, class/background skills.

**Always free-edit:** name, alignment, XP, current HP, personality traits, ideals, bonds,
flaws, notes, equipment added post-creation, additional skills added manually.

### 3.4 — The "no" path

User says no → `build` stays null → all fields blank and manually editable → freeform
mode exactly as today. No new code needed.

---

## Part 4: Implementation Order

### Phase 0 — Branch cleanup (current task)
Complete everything in Part 1. No new features.

### Phase 1 — Real SRD data
Adapter scripts + populate `races.json`, `classes.json`, `backgrounds.json`,
`features.json`, `traits.json`. Makes existing dropdowns actually useful.
Do this before touching wizard UI.

### Phase 2 — Wizard shell
Overlay/modal wrapper turning existing panels into a step-by-step flow.
Back/Next navigation and progress indicator. No new panels yet.

### Phase 3 — Skills & Equipment steps
Skills selection step and equipment step. Explorer's Pack auto-expansion lives here.
Requires Phase 1 equipment data.

### Phase 4 — Polish & locked fields
Wizard-locked field behavior. In-app attribution/credits page. Full smoke test.

### Phase 5 — Spells
Spellcasting progression from class data. Automatically granted spells.
Not a full spell compendium — existing spells panel stays as manual entry UI.

### Phase 6+ — Lore & reference layer
Rules reference browser, monster reference, feat browser. The differentiators.

---

## Part 5: AGENTS.md Updates Needed

When updating `AGENTS.md` as part of cleanup, confirm it reflects:

1. SRD 5.1 is primary. SRD 5.2.1 is retired/deleted.
2. Content kind for race is `"race"` not `"species"`.
3. Build field is `raceId` not `speciesId`.
4. Source field value is `"srd-5.1"` not `"srd-5.2.1"`.
5. New section: **"SRD Data Fetch Pipeline"** — `game-data/srd/*.json` files are produced
   by `scripts/fetch-srd-data.js` + adapters. Do not hand-edit JSON files; edit adapter
   scripts instead.

---

## Part 6: Attribution (Complete Requirement)

`LEGAL.md` content — this is the entire obligation, nothing else needed:

> This work includes material taken from the System Reference Document 5.1 ("SRD 5.1") by
> Wizards of the Coast LLC and available at https://dnd.wizards.com/resources/systems-reference-document.
> The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License
> available at https://creativecommons.org/licenses/by/4.0/legalcode.

Use "compatible with fifth edition" or "5E compatible" to describe the app.
Do not use "Dungeons & Dragons" or "D&D."

---

## Quick Reference: Cleanup Task List (Phase 0)

In order:

1. **Manually** review `docs/#personal/SRD building master prompts.md` for conflicting instructions before Claude Code touches anything
2. Rename `"species"` → `"race"` throughout JS files (see 1.1 for full file list)
3. Update all `"srd-5.2.1"` strings to `"srd-5.1"` (see 1.2)
4. Rewrite policy sections in `AGENTS.md` (see 1.3)
5. Update `srd-licensing-notes.md` (see 1.4)
6. Create `LEGAL.md` with CC-BY-4.0 attribution statement
7. Create `docs/reference/attribution-requirements.md` placeholder
8. Run `npm test` — confirm clean
9. Grep confirm: zero `"srd-5.2.1"` and zero `"species"` kind strings remaining
10. Commit: `chore: rename race terminology, update SRD version to 5.1, clean up docs`
