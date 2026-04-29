# Content Registry Plan

_Last updated: 2026-04-22_

## Purpose

This document defines how Lore Ledger should model shipped builtin builder content in structured data files.

It exists to answer these questions:

- What is the content registry?
- Which files hold builtin builder content?
- What shape should each content record use?
- How should IDs, naming, and source metadata work?
- What rules should contributors and coding agents follow when expanding the registry?

This is a project design and implementation guidance document, not a user-facing feature spec.

---

## Relationship to Other Project Files

This file should be read together with:

- `docs/reference/srd-licensing-notes.md`
- `docs/reference/builder-scope-greenlist.md`
- `game-data/srd/*.json`
- `AGENTS.md`

Interpretation order:

1. `srd-licensing-notes.md` defines the licensing posture
2. `builder-scope-greenlist.md` defines what categories are approved for builtin scope
3. this file defines how approved builtin content should be modeled
4. `game-data/srd/*.json` contains the actual registry data

If a content category is not greenlit, it should not be added to the registry as shipped builtin content.

---

## What the Content Registry Is

In Lore Ledger, the **content registry** is the collection of structured data files that define shipped builtin builder content.

The registry is not just a storage convenience. It is the canonical source for builder-facing content definitions used by the app.

That means the registry should be:

- explicit
- structured
- version-controlled
- auditable
- easy for both humans and coding agents to read
- stable enough that app logic can depend on it without guessing

The registry should never be replaced by scattered hardcoded data in UI modules.

---

## Current Planned Registry Files

The planned builtin registry files are:

- `game-data/srd/races.json`
- `game-data/srd/classes.json`
- `game-data/srd/backgrounds.json`
- `game-data/srd/feats.json`
- `game-data/srd/subclasses.json`
- `game-data/srd/traits.json`
- `game-data/srd/draconic-ancestries.json`
- `game-data/srd/languages.json`
- `game-data/srd/skills.json`
- `game-data/srd/equipment.armor.json`
- `game-data/srd/equipment.weapons.json`
- `game-data/srd/spells.json` *(optional/later, only if needed for granted builtin spell support or future expansion)*

These files hold **shipped builtin content only**.

They are not for arbitrary runtime state, user-edited characters, or campaign data.

---

## Registry Design Goals

The registry should support these project goals:

### 1. Builtin vs custom separation

Builtin content that ships with Lore Ledger must remain clearly distinct from custom user content.

### 2. Predictable derivation

Builder logic should be able to read registry records and derive character values without relying on UI-specific assumptions.

### 3. Incremental expansion

The registry should let Lore Ledger grow category-by-category without forcing major rewrites every time a new content type is added.

### 4. Human readability

The files should be understandable enough that you can inspect them directly in the repo and tell what they mean.

### 5. Stable IDs

Each registry record must have a stable identifier that can be safely stored in character build data.

---

## Core Registry Rules

Every registry record should follow these rules unless a category has a documented exception.

### Rule 1: Every item needs a stable `id`

The `id` is the machine identifier stored in builder state.

IDs should be:

- lowercase
- ASCII
- hyphen-separated
- limited to lowercase ASCII letters, digits, and hyphens
- stable over time
- descriptive enough to remain understandable in code and saved data

Examples:

- `dwarf`
- `fighter`
- `soldier`
- `tough`
- `champion`
- `studded-leather`
- `longsword`

Do not use display names as IDs.

### Rule 2: Every item needs a human-readable `name`

Each item should include a display name used by the UI.

Examples:

- `"name": "Dwarf"`
- `"name": "Fighter"`
- `"name": "Studded Leather"`

### Rule 3: Every item needs a `source`

Each item should declare where it comes from.

For shipped builtin SRD content, use:

- `"source": "srd-5.1"`

This keeps the provenance explicit.

### Rule 4: Every item needs a `kind`

Each record should declare its category.

Examples:

- `"kind": "race"`
- `"kind": "class"`
- `"kind": "background"`
- `"kind": "feat"`
- `"kind": "subclass"`
- `"kind": "armor"`
- `"kind": "weapon"`

### Rule 5: Use structured fields, not prose blobs

Wherever possible, content should be represented as explicit data fields rather than one large paragraph of descriptive text.

Good:

- `speed: 30`
- `damage: "1d8"`
- `abilityScoreIncreases: [{ ability: "con", bonus: 2 }]`
- `properties: ["versatile"]`

Bad:

- one giant text block that app logic has to interpret later

### Rule 6: Keep derived logic out of the registry when possible

The registry should define content facts, not duplicate derived values that app logic can compute.

Good:

- armor record contains `baseAC`, `maxDex`, `stealthDisadvantage`

Avoid:

- precomputed AC strings that the app must trust blindly when it could derive the value from fields

---

## Shared Base Record Shape

Every registry record should at minimum follow this shared shape:

```json
{
  "id": "fighter",
  "kind": "class",
  "name": "Fighter",
  "source": "srd-5.1"
}
```

Category-specific fields then extend that shape.

---

## Category Shapes

The following sections define the recommended first-pass shape for each current builder category.

### Races

Stored in:

- `game-data/srd/races.json`

Recommended shape:

```json
{
  "id": "dwarf",
  "kind": "race",
  "name": "Dwarf",
  "source": "srd-5.1",
  "size": "Medium",
  "speed": 30,
  "abilityScoreIncreases": [
    {
      "ability": "con",
      "bonus": 2
    }
  ],
  "traits": [
    "darkvision",
    "dwarven-resilience",
    "dwarven-combat-training",
    "tool-proficiency",
    "stonecunning"
  ],
  "subraceIds": [],
  "languages": [
    "common",
    "dwarvish"
  ]
}
```

Notes:

- `traits` should usually contain stable IDs, not long prose text
- if later needed, trait definitions can live in a separate trait registry or embedded structured objects
- keep the initial version simple enough to support builder derivation without overengineering

#### Spell-grant note for races

If a race grants a cantrip or spell as part of builtin builder content, that should be represented as structured data rather than buried in prose.

Example:

```json
"grantedSpells": [
  {
    "level": 1,
    "spellId": "thaumaturgy",
    "grantType": "known_cantrip"
  }
]
```

This does not require Lore Ledger to support a full spell registry immediately, but it does reserve a clean, data-driven place for builtin granted spells.

### Classes

Stored in:

- `game-data/srd/classes.json`

Recommended shape:

```json
{
  "id": "fighter",
  "kind": "class",
  "name": "Fighter",
  "source": "srd-5.1",
  "hitDie": 10,
  "primaryAbilities": [
    "str",
    "dex"
  ],
  "savingThrowProficiencies": [
    "str",
    "con"
  ],
  "armorProficiencies": [
    "light",
    "medium",
    "heavy",
    "shield"
  ],
  "weaponProficiencies": [
    "simple",
    "martial"
  ],
  "toolProficiencies": [],
  "skillChoices": {
    "choose": 2,
    "from": [
      "acrobatics",
      "animal-handling",
      "athletics",
      "history",
      "insight",
      "intimidation",
      "perception",
      "survival"
    ]
  },
  "subclassLevel": 3,
  "featuresByLevel": {
    "1": ["fighting-style", "second-wind"],
    "2": ["action-surge"],
    "3": ["fighter-subclass"],
    "4": ["ability-score-improvement"]
  }
}
```

Notes:

- `featuresByLevel` should contain stable IDs, not UI text
- this lets the builder reason about progression without hardcoding level tables into UI modules
- if feature detail becomes large, features can later move into a dedicated registry file

#### Spellcasting note for classes

Lore Ledger's builder may need class records to carry structured spellcasting progression data even if the app does not yet support a full builtin spell selection registry.

Examples of class-level spellcasting fields that may be introduced when needed:

```json
"spellcasting": {
  "ability": "wis",
  "progression": "full",
  "preparationMode": "prepared"
}
```

and/or:

```json
"grantedSpells": [
  {
    "level": 1,
    "spellId": "cure-wounds",
    "grantType": "always_prepared"
  }
]
```

The important rule is:

- spellcasting progression metadata is in scope for the builder
- automatically granted builtin spells are in scope for the builder
- a full builtin spell compendium is still optional/later unless the project explicitly expands into that area

### Backgrounds

Stored in:

- `game-data/srd/backgrounds.json`

Recommended shape:

```json
{
  "id": "soldier",
  "kind": "background",
  "name": "Soldier",
  "source": "srd-5.1",
  "skillProficiencies": [
    "athletics",
    "intimidation"
  ],
  "toolProficiencies": [],
  "languages": [],
  "equipment": [
    "uniform",
    "insignia-of-rank"
  ],
  "feature": "military-rank"
}
```

Notes:

- background equipment can start simple
- if equipment needs richer structure later, that can evolve separately

### Feats

Stored in:

- `game-data/srd/feats.json`

Recommended shape:

```json
{
  "id": "tough",
  "kind": "feat",
  "name": "Tough",
  "source": "srd-5.1",
  "category": "general",
  "prerequisites": [],
  "effects": [
    {
      "type": "hp_per_level_bonus",
      "value": 2
    }
  ]
}
```

Notes:

- `effects` should be structured enough for later rules-engine use
- keep the effect model simple at first; expand only when the builder needs it

#### Spell-grant note for feats

If a feat grants a spell, cantrip, or spellcasting-related effect, prefer structured fields over prose-only description.

Example:

```json
"grantedSpells": [
  {
    "level": 1,
    "spellId": "misty-step",
    "grantType": "once_per_long_rest"
  }
]
```

This keeps feat-driven spell grants compatible with future builder derivation.

### Subclasses

Stored in:

- `game-data/srd/subclasses.json`

Recommended shape:

```json
{
  "id": "champion",
  "kind": "subclass",
  "name": "Champion",
  "source": "srd-5.1",
  "classId": "fighter",
  "featuresByLevel": {
    "3": ["improved-critical"],
    "7": ["remarkable-athlete"],
    "10": ["additional-fighting-style"],
    "15": ["superior-critical"],
    "18": ["survivor"]
  }
}
```

Notes:

- every subclass must reference its parent class with `classId`
- subclass progression must be data-driven, not hardcoded by name in builder UI

### Armor

Stored in:

- `game-data/srd/equipment.armor.json`

Recommended shape:

```json
{
  "id": "studded-leather",
  "kind": "armor",
  "name": "Studded Leather",
  "source": "srd-5.1",
  "armorCategory": "light",
  "baseAC": 12,
  "addDex": true,
  "maxDex": null,
  "strengthRequirement": null,
  "stealthDisadvantage": false,
  "weight": 13,
  "cost": {
    "quantity": 45,
    "unit": "gp"
  }
}
```

Notes:

- use explicit numeric and boolean fields wherever possible
- avoid encoding mechanical logic into human text

### Weapons

Stored in:

- `game-data/srd/equipment.weapons.json`

Recommended shape:

```json
{
  "id": "longsword",
  "kind": "weapon",
  "name": "Longsword",
  "source": "srd-5.1",
  "weaponCategory": "martial",
  "attackType": "melee",
  "damage": "1d8",
  "damageType": "slashing",
  "properties": [
    "versatile"
  ],
  "versatileDamage": "1d10",
  "range": null,
  "weight": 3,
  "cost": {
    "quantity": 15,
    "unit": "gp"
  }
}
```

Notes:

- keep properties normalized as stable string IDs
- represent range explicitly instead of embedding it only in display text

### Draconic Ancestries

Stored in:

- `game-data/srd/draconic-ancestries.json`

Recommended shape:

```json
{
  "id": "red",
  "kind": "ancestry",
  "name": "Red",
  "source": "srd-5.1",
  "category": "chromatic",
  "damageType": "fire",
  "breathWeapon": {
    "shape": "cone",
    "size": 15
  },
  "saveAbility": "dex"
}
```

Notes:

- `breathWeapon` is a structured object (not a stringly-encoded value like `"cone-15-dex"`) so each component is independently queryable and anchor-testable
- `category` is `"chromatic"` or `"metallic"` and is lore metadata only — SRD 5.1 presents ancestries as a flat table with no chromatic/metallic split, so this field exists for UI grouping affordances, not as a schema-level grouping
- `damageType` is one of `"acid"`, `"cold"`, `"fire"`, `"lightning"`, or `"poison"`
- `breathWeapon.shape` is `"cone"` or `"line"`; cones use `size` in feet, and lines use explicit `width` and `length` in feet
- `saveAbility` is `"dex"` or `"con"`
- ten records total: black, blue, brass, bronze, copper, gold, green, red, silver, white — all values verified against the SRD 5.1 PDF Draconic Ancestry table

---

## Build-Time Choices Schema

Every choice the user makes during character building is represented as a `choice` object.

Examples include picking a language, picking a draconic ancestry, picking a cantrip, or picking a fighting style.

Design rationale for this schema and the vertical-slice-first SRD registry strategy lives in `docs/design/vertical-slice-schema.md`. This document remains the canonical schema/rules reference.

Choice objects use this shape:

```json
{
  "id": "dragonborn-ancestry",
  "kind": "ancestry",
  "count": 1,
  "from": { "type": "list", "source": "draconic-ancestries" },
  "source": "race:dragonborn"
}
```

Fields:

- `id` is the stable identifier for this specific choice. It is used as a key when storing the user's selection on the character.
- `kind` is the category of thing being picked.
- `count` is how many to pick. This is usually `1`, but may be more, such as the Acolyte background choosing two languages.
- `from` defines where the options come from.
- `source` identifies where this choice originates, such as `race:dragonborn`, `class:fighter`, or `background:acolyte`.

User selections are stored on the character's `build` object keyed by level.

Example:

```js
build.choicesByLevel["1"]["dragonborn-ancestry"] = "red";
```

Choice storage remains normalized. The persisted value is the selected option's ID,
not a copied label, description, or mechanical summary.

When a choice option has meaningful explanation or mechanical impact available in
registry data, the wizard should render a read-only selected-option preview
before the user continues. Content records should expose enough displayable,
structured data for that preview when the data is already part of the approved
SRD-backed model. The preview is derived UI, not persisted character data:
labels, descriptions, and mechanics are resolved from the stored choice ID,
registry records, and domain derivation logic at render time. Do not duplicate
mechanics calculations in UI-only code.

Dragonborn Draconic Ancestry is the first concrete example. The stored value is a
bare ancestry ID such as `"red"`; the selected ancestry record supplies the
damage type, breath weapon shape/size, save ability, and related display text.
Rules derivation combines that record with builder level, Constitution modifier,
and proficiency bonus to display damage resistance, breath weapon damage type,
breath weapon area/shape, save ability, save DC (`8 + Constitution modifier +
proficiency bonus`), and level-scaled damage dice. These values are derived from
the stored choice ID and registry/rules data for preview and builder display;
they are not duplicated into flat persisted character fields by default. Choices
without meaningful displayable data are not required to invent preview content.

### Derived Table-Use Values

Builder Summary may collect and explain derived mechanics, but table-use values
should also appear in the normal character sheet panel where users need them.
For combat DCs and similar at-the-table stats, that practical panel is usually
Vitals or the relevant normal sheet panel, not a temporary builder-only surface.

Current example: Dragonborn Breath Weapon DC is derived from the stored ancestry
choice, Constitution modifier, and proficiency bonus, so Vitals is the
appropriate normal-sheet home when the value is derivable. Future class-derived
resources, such as Sorcery Points, should follow the same read-only derivation
pattern before any intentional tracking or editing slice is added.

Normal sheet ownership should stay explicit:

- Vitals owns compact derived stats and canonical resource counters.
- Weapons owns normal weapon/equipment attacks.
- Spells owns actual spells.
- Abilities & Features owns special feature/action mechanics such as Dragonborn
  Breath Weapon, Dhampir Vampiric Bite, class/race feature actions, and similar
  rules-backed abilities that need structured fields such as activation, source,
  save type, DC, area/range, damage, damage type, recovery, cost, and rules
  description.

Do not route Breath Weapon or similar feature actions into Spells just because
they have DCs, damage, descriptions, or limited uses. Do not route them into
Weapons unless they are actually normal weapon/equipment attacks. Phase 3C
foundation complete: Dragonborn Breath Weapon now renders as the first derived,
display-only Abilities & Features card, while its derived save DC may also
appear in Vitals as a compact combat stat. This is the foundation slice only;
visual/card polish, manual/freeform feature cards, user-created/custom feature
cards, use tracking, broader rest/resource recovery, and broader feature
coverage remain future work.

Resource state must have one canonical counter. Feature cards may reference,
spend, restore, or explain that resource, but they must not duplicate the
counter. Rest actions are character-level actions, not panel-local buttons, so
Short Rest and Long Rest can eventually apply recovery rules across all relevant
systems.

Rest/recovery metadata should use the shared vocabulary `shortRest`,
`longRest`, `shortOrLongRest`, `manual`, and `none`. Phase 3D foundation
complete: Character page Short Rest / Long Rest toolbar controls now route
through `recoverCharacterForRest(character, "shortRest" | "longRest")` for
active-character recovery. The current helper supports only explicit
`character.resources[]` counters with the existing current/max shape and
matching recovery metadata: `shortRest` recovers `shortRest` and
`shortOrLongRest`; `longRest` recovers `longRest` and `shortOrLongRest`.
Missing, `manual`, `none`, unknown recovery metadata, already-full counters,
malformed counters, unrelated fields, and existing manual resource trackers
without recovery metadata are intentionally left unchanged.

Phase 3E is planned as the Resource Recovery Settings Dialog slice. That UI
should write the selected Vitals resource tracker's existing `recovery` field
using the same vocabulary above. It should not add a new schema, duplicate
settings store, panel-owned recovery map, or bulk migration for existing
untagged resources. Missing recovery metadata may be displayed as "Manual" in
the dialog for user understanding, but saving must be explicit and scoped to
the selected resource only.
Limited-use feature usage should be modeled as character-owned resource/use
entries referenced by feature cards, not as duplicate counters owned by the
Abilities & Features panel.

Long term, builder characters can receive derived feature cards from rules/build
choices, and freeform characters should be able to create manual feature cards.
Both should render through the same Abilities & Features panel UI. Builder-derived
cards should not be duplicated into manual/freeform card state unless a later
explicit copy, customize, or override behavior is designed. Specialized
resource-linked feature cards, such as Sorcery Points, Metamagic, and Flexible
Casting, may need dedicated renderers later, but they must still use the single
canonical resource counter.

These derived values are not registry records and are not flat stored character
fields by default. Race bonuses, derived combat stats, damage resistance, breath
weapon area, save DC, damage dice, and future derived resources should be
computed from persisted choices and rules data unless a later explicit slice
adds tracked or editable storage.

### Choice `from` Types

`from` takes one of three shapes:

- `{ "type": "any" }` means any record matching the choice's `kind`, such as Human's free language choice.
- `{ "type": "list", "options": ["red", "blue", "brass"] }` means a literal list of IDs.
- `{ "type": "list", "source": "draconic-ancestries" }` means every record in a referenced content file.

A future variant may add `filter`, such as `{ "type": "list", "source": "spells", "filter": { ... } }`, but that is not currently in scope.

### `kind` Vocabulary

`kind` controls what the user is picking and what file or files the chosen value is validated against.

Current vocabulary:

- `language` means the chosen value must be an ID in `languages.json`
- `ancestry` means the chosen value must be an ID in `draconic-ancestries.json`
- `skill` means the chosen value must be an ID in `skills.json`
- `cantrip` means the chosen value must be an ID in `spells.json`

This vocabulary is a closed set. Adding a new `kind` requires updating this document and updating the referential integrity test.

### Choice Placement

Choices live inline on the parent entry as a `choices: []` array on that entry.

Parent entries include races, classes, backgrounds, and subclasses.

There is no separate `choices.json`.

The dominant access pattern is "render this race entry," and inlining keeps a race's grants discoverable in one place.

### Trait Fields

Trait records in `traits.json` are purely descriptive.

Allowed fields:

- `id`
- `kind`
- `name`
- `description`
- `source`
- `derivedFrom` (optional)

For traits, use `"kind": "trait"`.

Traits do not carry a `choiceRef` field.

The relationship between a trait and a build-time choice flows through the parent race/class entry's `choices` array, not through the trait itself.

`derivedFrom` is the only allowed pointer-style field on a trait. Use it when the trait's mechanics depend on a choice the user made. For example, Breath Weapon's damage type and shape depend on the chosen Draconic Ancestry, so its trait record carries `"derivedFrom": "dragonborn-ancestry"`.

### ID Uniqueness and Referential Integrity

IDs are bare, with no namespace prefix like `race:` or `trait:`.

All IDs must be globally unique across all `game-data/srd/*.json` content files.

Uniqueness and reference soundness are enforced by a referential integrity test at `tests/data/referential-integrity.test.js`.

The test:

- walks every ID-shaped reference across all SRD JSON files
- asserts each reference resolves to a real record in the appropriate file
- asserts global ID uniqueness across all SRD content
- validates that every choice's `from` resolves to a real source file or list

Adding a new content file or new `kind` value requires updating this test.

Note: this test now exists and should remain part of the normal verification path for
SRD registry content changes.

---

## ID and Naming Conventions

### IDs

Use stable lowercase hyphen-separated IDs.

Allowed characters are lowercase ASCII letters (`a-z`), digits (`0-9`), and hyphens (`-`).

Good:

- `life-domain`
- `college-of-lore`
- `chain-mail`
- `light-crossbow`

Avoid:

- `LifeDomain`
- `Light Crossbow`
- `studded leather`

### Display names

Use the official item/class/feature display name in `name`.

### Linked references

When one record points to another, use `...Id` naming.

Examples:

- `classId`
- `subclassId`
- `raceId`
- `backgroundId`

### Arrays of related IDs

Use pluralized descriptive names.

Examples:

- `traits`
- `languages`
- `savingThrowProficiencies`
- `weaponProficiencies`

---

## Source Metadata Rules

For the current Lore Ledger builder scope, shipped builtin records should use:

```json
"source": "srd-5.1"
```

If the project ever introduces other approved builtin source packs later, the source field will make that distinction explicit.

Do not omit source metadata.

---

## JSON File Structure Rules

Each registry file should be a top-level array of records.

Example:

```json
[
  {
    "id": "fighter",
    "kind": "class",
    "name": "Fighter",
    "source": "srd-5.1"
  },
  {
    "id": "wizard",
    "kind": "class",
    "name": "Wizard",
    "source": "srd-5.1"
  }
]
```

Why arrays instead of object maps:

- easier to scan in raw files
- preserves human-friendly ordering
- simpler for many build/import workflows
- can still be indexed by app code after loading

Recommended ordering inside files:

- sort records by display name unless a different ordering is explicitly useful

Recommended field ordering inside each record:

1. `id`
2. `kind`
3. `name`
4. `source`
5. category-specific fields

This helps keep diffs readable.

---

## What Should Not Be Stored Here

The registry should not store:

- live character state
- user-created custom content unless a future custom-content registry is intentionally designed
- campaign-specific content
- derived values that belong in runtime logic
- UI-only state such as whether a dropdown is open or whether a picker is collapsed

The registry is app content, not app session state.

---

## Contributor Rules

When expanding registry files:

1. Check `builder-scope-greenlist.md` first.
2. Do not add content categories that are not greenlit.
3. Keep record shapes structured and predictable.
4. Use stable IDs.
5. Prefer adding explicit fields over stuffing mechanics into prose.
6. Do not hardcode registry facts into UI code when they belong in data.
7. Update this document if a new category shape or cross-record convention is introduced.

---

## Recommended First Implementation Strategy

For Lore Ledger's current builder phase, the safest implementation approach is:

1. Create the registry files with a small number of clean, representative records.
2. Confirm the builder can load and reference them through stable IDs.
3. Expand category coverage incrementally.
4. Only add more schema complexity when real builder needs require it.

That means the first milestone should optimize for:

- clean data shape
- stable IDs
- consistent naming
- compatibility with builder derivation

not for maximum content volume on day one.

---

## Future Evolution

This plan is intentionally first-pass and practical.

Later, Lore Ledger may introduce additional registry files or supporting registries for things like:

- feature definitions
- spell definitions (only if the project later chooses to support broader builtin spell workflows)
- trait definitions
- language definitions
- tool definitions
- equipment bundles
- effect schemas

That is fine, but those should be added deliberately rather than prematurely.

The first version should stay simple enough to ship and maintain.

---

## Summary

Lore Ledger's content registry should be:

- structured
- data-driven
- source-labeled
- stable-ID based
- separate from UI state and runtime state

Current planned builtin registry files:

- `races.json`
- `classes.json`
- `backgrounds.json`
- `feats.json`
- `subclasses.json`
- `traits.json`
- `draconic-ancestries.json`
- `languages.json`
- `skills.json`
- `spells.json` *(optional/later if needed for granted builtin spell support or broader spell workflows)*
- `equipment.armor.json`
- `equipment.weapons.json`

Final rule:

> If builtin content is approved to ship, it should live in structured registry files with stable IDs and explicit source metadata, not in scattered hardcoded UI logic.
