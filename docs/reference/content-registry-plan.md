# Content Registry Plan

_Last updated: 2026-04-17_

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

- `game-data/srd/species.json`
- `game-data/srd/classes.json`
- `game-data/srd/backgrounds.json`
- `game-data/srd/feats.json`
- `game-data/srd/subclasses.json`
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
- underscore-separated
- stable over time
- descriptive enough to remain understandable in code and saved data

Examples:

- `dwarf`
- `fighter`
- `soldier`
- `tough`
- `champion`
- `studded_leather`
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

- `"kind": "species"`
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
- `abilityBonuses: { con: 2 }`
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

### Species

Stored in:

- `game-data/srd/species.json`

Recommended shape:

```json
{
  "id": "dwarf",
  "kind": "species",
  "name": "Dwarf",
  "source": "srd-5.1",
  "size": "Medium",
  "speed": 30,
  "abilityBonuses": {
    "con": 2
  },
  "traits": [
    "darkvision",
    "dwarven_resilience",
    "dwarven_combat_training",
    "tool_proficiency",
    "stonecunning"
  ],
  "languages": [
    "Common",
    "Dwarvish"
  ]
}
```

Notes:

- `traits` should usually contain stable IDs, not long prose text
- if later needed, trait definitions can live in a separate trait registry or embedded structured objects
- keep the initial version simple enough to support builder derivation without overengineering

#### Spell-grant note for species

If a species grants a cantrip or spell as part of builtin builder content, that should be represented as structured data rather than buried in prose.

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
      "animal_handling",
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
    "1": ["fighting_style", "second_wind"],
    "2": ["action_surge"],
    "3": ["fighter_subclass"],
    "4": ["ability_score_improvement"]
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
    "spellId": "cure_wounds",
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
    "insignia_of_rank"
  ],
  "feature": "military_rank"
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
    "spellId": "misty_step",
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
    "3": ["improved_critical"],
    "7": ["remarkable_athlete"],
    "10": ["additional_fighting_style"],
    "15": ["superior_critical"],
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
  "id": "studded_leather",
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

---

## ID and Naming Conventions

### IDs

Use lowercase underscore-separated IDs.

Good:

- `life_domain`
- `college_of_lore`
- `chain_mail`
- `light_crossbow`

Avoid:

- `LifeDomain`
- `life-domain`
- `Light Crossbow`

### Display names

Use the official item/class/feature display name in `name`.

### Linked references

When one record points to another, use `...Id` naming.

Examples:

- `classId`
- `subclassId`
- `speciesId`
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

- `species.json`
- `classes.json`
- `backgrounds.json`
- `feats.json`
- `subclasses.json`
- `spells.json` *(optional/later if needed for granted builtin spell support or broader spell workflows)*
- `equipment.armor.json`
- `equipment.weapons.json`

Final rule:

> If builtin content is approved to ship, it should live in structured registry files with stable IDs and explicit source metadata, not in scattered hardcoded UI logic.