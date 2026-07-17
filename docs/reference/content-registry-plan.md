# Content Registry Plan

Last updated: 2026-07-06

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

## Shipped Registry Files

The 14 builtin registry files, all loaded by `js/domain/rules/builtinContent.js`:

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
- `game-data/srd/equipment.packs.json`
- `game-data/srd/features.json`
- `game-data/srd/spells.json`

All of the above are **shipped today**. `spells.json` carries the full SRD 5.1 spell
registry (319 spells) and `equipment.packs.json` carries the 7 SRD packs with inline
contents; neither is optional or deferred.

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
- `acolyte`
- `grappler`
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

#### Per-level HP bonus (`hpPerLevelBonus`, 2026-07-17)

A race or subrace record may carry an optional structured
`"hpPerLevelBonus": <number>` when one of its traits raises maximum HP by a
flat amount at every character level. The only SRD 5.1 instance is the Hill
Dwarf's Dwarven Toughness (`hpPerLevelBonus: 1`); the adapter emits it keyed by
the stable trait id (`racesAdapter.js` → `HP_PER_LEVEL_TRAIT_BONUSES` — the
mechanic is rules text, so like the unarmored AC formulas it lives in code, not
in trait prose). `deriveCharacter()` stacks race + subrace values with feat
`hp_per_level_bonus` effects when calling `computeMaxHp`, so derived max HP
(contract "Structured Vitals") scales correctly. Custom races may author the
field through JSON import.

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

Class records carry structured spellcasting progression data. The app also ships the full builtin spell registry, so progression metadata and spell selection work together rather than one standing in for the other.

Class-level spellcasting fields:

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
- class-level `grantedSpells` are consumed by `getGrantedSpells()` (2026-07-13):
  entries accept `classLevel` or the `level` alias for the unlock level; no
  builtin SRD class carries one today, so this is primarily the custom-class
  extension point
- the full builtin spell registry is **shipped** (`game-data/srd/spells.json`, 319 SRD 5.1 spells); the builder offers class-list spell selection and seeds it into the spells panel at Finish

### Backgrounds

Stored in:

- `game-data/srd/backgrounds.json`

**Acolyte is the only background in SRD 5.1**, and therefore the only shipped builtin
background. Criminal, Sage, and Soldier are not SRD 5.1 content — if you need them, they
are custom/homebrew content, not builtin registry records.

Shipped shape, abridged from the real `acolyte` record:

```json
{
  "id": "acolyte",
  "kind": "background",
  "name": "Acolyte",
  "source": "srd-5.1",
  "skillProficiencies": ["insight", "religion"],
  "choices": [
    {
      "id": "acolyte-language",
      "kind": "language",
      "count": 2,
      "from": { "type": "any" },
      "source": "background:acolyte"
    }
  ],
  "startingEquipment": [
    { "itemId": "clothes-common", "name": "Clothes, common", "quantity": 1 }
  ],
  "startingEquipmentOptions": [
    {
      "desc": "Choose 1 from Holy Symbols",
      "choose": 1,
      "options": [
        { "categoryId": "holy-symbols", "categoryName": "Holy Symbols", "itemOptions": [] }
      ]
    }
  ],
  "feature": {
    "name": "Shelter of the Faithful",
    "desc": "…"
  }
}
```

Notes:

- `feature` is an **object** (`{ name, desc }`), not a string id
- fixed starting gear lives in `startingEquipment`; player choices live in
  `startingEquipmentOptions`
- build-time choices (e.g. Acolyte's two languages) live inline in `choices`
- read the real record in `game-data/srd/backgrounds.json` before changing this shape

### Feats

Stored in:

- `game-data/srd/feats.json`

**Grappler is the only feat in SRD 5.1**, and therefore the only shipped builtin feat.
Alert, Lucky, Sentinel, Tough, War Caster, and every other familiar 5E feat are **not**
SRD 5.1 content. They are custom/homebrew content, not builtin registry records.

Shipped shape, from the real `grappler` record:

```json
{
  "id": "grappler",
  "kind": "feat",
  "name": "Grappler",
  "source": "srd-5.1",
  "prerequisites": [
    { "ability": "str", "minimum": 13 }
  ],
  "desc": "…",
  "effects": []
}
```

Notes:

- `prerequisites` entries are structured `{ ability, minimum }` records, not prose
- `effects` is present but **empty** on the only shipped feat; it exists for later
  rules-engine use and for custom content
- keep the effect model simple; expand only when the builder actually needs it
- read the real record in `game-data/srd/feats.json` before changing this shape

#### Spell-grant note for feats

No SRD 5.1 feat grants a spell — Grappler does not. The shape below is **illustrative**,
for custom/homebrew feats and for any future approved source pack. It does not describe
shipped builtin data.

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

### Equipment Packs (added 2026-07-09)

Stored in:

- `game-data/srd/equipment.packs.json`

Recommended shape:

```json
{
  "id": "explorers-pack",
  "kind": "pack",
  "name": "Explorer's Pack",
  "source": "srd-5.1",
  "cost": {
    "quantity": 10,
    "unit": "gp"
  },
  "contents": [
    { "itemId": "backpack", "name": "Backpack", "quantity": 1 },
    { "itemId": "torch", "name": "Torch", "quantity": 10 }
  ]
}
```

Notes:

- a pack is a **container**, referenced by id from class/background `startingEquipment` and `startingEquipmentOptions`
- `contents` is stored **inline** on the pack record as `{ itemId, name, quantity }` rows; the individual adventuring-gear items are deliberately not shipped as standalone registry entries, so `itemId` here is a stable identifier rather than a cross-file reference
- packs never nest other packs — the referential integrity test enforces this, because builder Finish expands a pack into one inventory pocket and must not recurse
- builder Finish seeds loose starting gear into the character's general inventory pocket and gives each pack its own pocket listing `contents`; do not hardcode pack contents in seeding or UI code

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

Choice storage remains normalized. The persisted value is the selected
option's ID — or, for count > 1 choices, an array of option IDs.
Two structured exceptions exist for class progression choices
(2026-07-06):

- ASI-or-feat slots use the choice id `asi-<characterLevel>` and store
  either `{ "type": "asi", "increases": { "str": 1, "dex": 1 } }` or
  `{ "type": "feat", "featId": "grappler" }`.
- Feature subfeature choices (e.g. Fighting Style) and expertise picks use
  the choice id `feature-<featureId>` and store the chosen feature id(s)
  or skill id(s).

Class-driven skill choices use `class-skill-<classId>` (first class) and
`multiclass-skill-<classId>` (later classes). These ids are generated by
`js/domain/rules/progression.js`, not stored in registry data.

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

### Seeded Editable Content Ownership

Registry and rules data may seed or suggest sheet content for normal editable
fields or entries when that sheet surface is the appropriate home. Examples
include Features / Traits text, Proficiencies & Languages entries, Equipment
entries, spell entries or spell information, weapon entries, Vitals resources,
and structured Abilities & Features entries. Once content is written into an
editable sheet field or entry, the persisted sheet content is user-owned
content, not synchronized registry output.

Later builder/rules updates may append or offer duplicate-aware additions when
new information becomes relevant, such as after a level-up. They must preserve
existing content and user edits, and they should use an explicit add/update flow
when practical. Registry records are not authority to silently rewrite, replace,
delete, normalize, or overwrite user-owned sheet content.

This seeded editable content rule is separate from live-derived calculations and
counters. Read-only builder previews and live-derived displays do not prevent
the wizard Finish flow from seeding appropriate existing normal sheet homes.
Compact values such as proficiency bonus, derived DCs, level-scaled dice, and
feature-use maximums should usually stay derived from choices and rules data
rather than being materialized as editable sheet content.

Phase 3I proves this rule narrowly for the current Dragonborn slice: wizard
Finish seeds Dragonborn Draconic Ancestry and Damage Resistance text into
`character.features`, and fixed Dragonborn languages into `character.languages`.
That seeded text is duplicate-aware on creation only and becomes user-owned
editable sheet content immediately. Breath Weapon mechanics remain live-derived
in Abilities & Features and Vitals rather than copied into seeded text.

### Derived Table-Use Values

Builder Summary may collect and explain derived mechanics, but table-use values
should also appear in the normal character sheet panel where users need them.
For combat DCs and similar at-the-table stats, that practical panel is usually
Vitals or the relevant normal sheet panel, not a temporary builder-only surface.

Current example: Dragonborn Breath Weapon DC is derived from the stored ancestry
choice, Constitution modifier, and proficiency bonus, so Vitals is the
appropriate normal-sheet home when the value is derivable. Phase 3H adds the
first derived feature-use counter for Dragonborn Breath Weapon as
character-owned `featureUses["dragonborn-breath-weapon"].current`, surfaced on
the derived Abilities & Features card. Broad shared pools, such as Sorcery
Points or Ki, should follow the single canonical Vitals/resource-counter path
before any intentional tracking or editing slice is added.

Normal sheet ownership should stay explicit:

- Vitals owns compact derived stats and broad shared canonical resource counters.
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
Phase 3F later completed the manual/freeform card foundation and first polish
pass. Phase 3H adds Dragonborn Breath Weapon use tracking only, using
character-owned `featureUses` for the mutable current count while deriving max
uses, recovery, label, and mechanics from rules/build data. Phase 3I seeds only
Dragonborn passive/descriptive text and fixed languages into their existing
editable homes; it does not copy Breath Weapon into seeded text. Partial regain
behavior, spell slots, broader rest/resource automation, broad derived
feature-use automation, generalized seeding, level-up additions, and broader
feature coverage remain future work.

Resource state must have one canonical counter. Feature-specific limited-use
counters may be surfaced on Abilities & Features cards when they belong only to
one feature or sub-feature, but they should still be character-owned feature-use
entries or equivalent rather than duplicate panel-local counters. Feature cards
may later reference, spend, restore, or explain broad shared resources, but they
must not duplicate those shared counters. Rest actions are character-level
actions, not panel-local buttons, so Short Rest and Long Rest can eventually
apply recovery rules across all relevant systems.

Rest/recovery metadata should use the shared vocabulary `shortRest`,
`longRest`, `shortOrLongRest`, `manual`, and `none`. Phase 3D foundation
complete: Character page Short Rest / Long Rest toolbar controls now route
through `recoverCharacterForRest(character, "shortRest" | "longRest")` for
active-character recovery. The helper now covers explicit `character.resources[]`
counters, Phase 3G manual/custom `manualFeatureCards[].limitedUse` counters, and
the Phase 3H Dragonborn Breath Weapon `featureUses` counter when their recovery
metadata matches the rest type: `shortRest` recovers `shortRest` and
`shortOrLongRest`; `longRest` recovers `longRest` and `shortOrLongRest`.
Missing, `manual`, `none`, unknown recovery metadata, already-full counters,
malformed counters, unrelated fields, existing manual resource trackers without
recovery metadata, and stale feature-use entries not backed by a currently
derived feature are intentionally left unchanged.

Phase 3E foundation complete: Vitals resource recovery metadata can now be
configured from resource tiles through press-and-hold on the tile body or
Enter/Space keyboard activation on a focused tile, without adding visible tile
settings buttons, gears, or ellipses. The Resource Settings dialog writes only
the selected Vitals resource tracker's existing `recovery` field using the same
vocabulary above. It does not add a new schema, duplicate settings store,
panel-owned recovery map, or bulk migration for existing untagged resources.
Missing recovery metadata displays as "Manual" in the dialog for user
understanding, but saving is explicit and scoped to the selected resource only.
Save preserves `cur`, `max`, `name`, and unrelated fields; Cancel and Escape
close without mutation. Existing untagged/manual resources remain intentionally
untouched until the user assigns recovery metadata.
Limited-use feature usage should be modeled as character-owned feature-use or
resource/use entries referenced by feature cards, not as duplicate counters
owned by the Abilities & Features panel.

Long term, builder characters can receive cards from rules/build choices, and
freeform characters can create manual feature cards after Phase 3F. Phase 3F
foundation complete: freeform characters and builder characters can create,
edit, delete, reorder, collapse, and persist user-owned manual cards while
builder-derived/rules-backed cards remain derived and read-only in the current
foundation state. Both sources render through the same Abilities & Features
panel UI, but they remain separate data sources: manual/custom cards are
character-owned user content in `manualFeatureCards[]`, not SRD registry records,
and builder-derived cards must not be duplicated into manual/freeform card state
unless a later explicit copy, customize, or override behavior is designed.
Post-creation edit, reorder, and customization support for builder-created
feature cards is a required future builder direction, not optional polish, but
cards that mix live-derived mechanics with editable user content need an explicit
persisted customization model before becoming editable. Live-derived mechanics
can remain derived; user-customized card content must not be silently
overwritten by registry/rules derivation. Manual-card management actions live
behind a gear/settings menu, card headers can collapse cards, and manual-card
notes/descriptions can collapse independently for readability. Manual cards may
store optional plain-text attack, damage, and effect fields; the older
`damageEffect` field remains backward-compatible. These text fields are not
registry mechanics and do not imply attack/damage calculation, resource
automation, or AC derivation.
Phase 3G foundation complete: manual/custom feature cards can optionally persist
a nested `limitedUse` object with enabled tracking, a use label, current uses,
max uses, and one recovery setting from the existing `manual`, `shortRest`,
`longRest`, `shortOrLongRest`, and `none` vocabulary. The Abilities & Features
panel displays compact Use, Regain, and Reset controls for enabled manual cards,
clamps current uses between 0 and max, and normalizes invalid values
defensively. Short Rest and Long Rest recover eligible manual/custom feature
counters through the existing character-level `recoverCharacterForRest(...)`
path.

Phase 3H foundation complete: derived Dragonborn Breath Weapon receives compact
Use, Regain, and Reset controls on the derived card. The mutable state is stored
only as `character.featureUses["dragonborn-breath-weapon"].current`, with
missing state treated as full uses. Max uses `1`, recovery `shortOrLongRest`,
label, DC, area, damage, damage type, ancestry, and feature text remain derived
from rules/build data. Short Rest and Long Rest recover the derived counter
through the same `recoverCharacterForRest(...)` path. This does not copy Breath
Weapon into `manualFeatureCards[]`, does not store it as `character.resources[]`,
and does not implement broad derived feature-use automation, Sorcery Points, Ki,
Metamagic, Flexible Casting, spell slots, Pact Magic slots, prepared/known spell
automation, attack/damage calculation, AC derivation, equipment automation, or
broader SRD/class-feature coverage.
Specialized shared-resource-linked feature cards, such as Sorcery Points,
Metamagic, and Flexible Casting, may need dedicated renderers later, but they
must still use the single canonical resource counter.

These derived mechanics are not registry records and are not flat stored
character fields by default. Race bonuses, derived combat stats, Breath Weapon
area, save DC, damage dice, and future derived resources should be computed from
persisted choices and rules data unless a later explicit slice adds tracked or
editable storage. Seeded Damage Resistance text in `character.features` is an
editable user-owned note, not the canonical mechanics source.

### Choice `from` Types

`from` takes one of these shapes:

- `{ "type": "any" }` means any record matching the choice's `kind`, such as Human's free language choice.
- `{ "type": "list", "options": ["red", "blue", "brass"] }` means a literal list of IDs.
- `{ "type": "list", "source": "draconic-ancestries" }` means every record in a referenced content file.
- `{ "type": "list", "source": "spells", "filter": { "classId": "wizard", "maxLevel": 0 } }`
  means every spell in `spells.json` matching the filter. Filter keys
  (all optional, ANDed): `classId` (spell's `classIds` includes it),
  `maxLevel` / `minLevel` (inclusive on the spell's `level`), and `school`.
  Resolution lives in `js/domain/rules/spellChoices.js`
  (`resolveSpellChoiceOptions`), shared by the wizard picker and derivation.
  The referential-integrity test asserts every filtered spell choice resolves
  to at least one spell.

### `kind` Vocabulary

`kind` controls what the user is picking and what file or files the chosen value is validated against.

Current vocabulary:

- `language` means the chosen value must be an ID in `languages.json`
- `ancestry` means the chosen value must be an ID in `draconic-ancestries.json`
- `skill` means the chosen value must be an ID in `skills.json`
- `cantrip` means the chosen value must be an ID in `spells.json`, restricted to
  the choice's `from` filter (**wired 2026-07-15** — High Elf's wizard cantrip
  is the first consumer; the wizard renders the filtered picker, Finish gates on
  it, and `deriveCharacter` feeds the selection into `grantedSpells` with the
  choice's `spellcastingAbility` provenance). A `cantrip`/spell choice may carry
  a top-level `spellcastingAbility` (e.g. `"int"`) recording which ability casts
  the granted spell; it is provenance only and does not change class spell math.

This vocabulary is a closed set. Adding a new `kind` requires updating this
document and updating the referential integrity test. Choice-based granted
spells are resolved generically (`collectChoiceGrantedSpells` in
`spellChoices.js`) from race/subrace `choices[]`, so the mechanism is reusable
for any future filtered spell choice without new code.

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

**Updated 2026-07-06:** with the full generated registry (spells, features,
equipment, …) IDs are unique **per kind**, not globally. Known cross-kind
collisions in SRD data: `shield` (armor vs spell), `darkvision` (trait vs
spell), `draconic` (subclass vs language), `halfling` (race vs language).
Registry lookups are therefore kind-aware (`getContentByKind`); the legacy
id-only lookup remains only where the id space cannot collide.

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

> **Historical.** This described the vertical-slice-first rollout. That slice is complete and
> the registry is fully expanded. The principles below still apply to *new* categories.

The approach was:

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

Several registries listed here as "future" have since shipped: feature definitions
(`features.json`), spell definitions (`spells.json`), trait definitions (`traits.json`),
language definitions (`languages.json`), and equipment bundles (`equipment.packs.json`,
as packs with inline contents).

Still genuinely future, and not currently in scope:

- tool definitions
- effect schemas
- magic items
- monster / NPC stat blocks

Those should be added deliberately rather than prematurely, and only after the greenlist
is updated to approve them.

---

## Custom Content (2026-07-06)

Campaign homebrew records live in `state.content.custom` and use the same
normalized record shapes as the SRD registry files, with
`"source": "custom"` (forced on import). They merge into the active content
registry at derivation time (`js/domain/rules/registry.js`), may not shadow
a builtin `kind:id`, travel with backup/export/import as part of campaign
state, and are managed from the Data panel (import/export/list/remove).
This is also the extension point for future licensed content packs: a pack
is a record list with its own `source` value.

**Persistence note (2026-07-13):** `state.content` is carried on the
campaign vault doc (`js/storage/campaignVault.js` — `extractCampaignDoc`,
`projectActiveCampaignState`, `replaceRuntimeState`). Older vault docs
without a `content` key hydrate to an empty bucket; no schema migration was
needed.

### In-app authoring (2026-07-13, matrix #15)

Data & Settings → **Manage Custom Content** opens the manager dialog
(`js/ui/customContentManager.js`): it lists every custom record, removes any
record behind a confirmation that names the characters referencing it
(`findCharactersReferencingContent`; removal stays allowed because
derivation degrades soft), and authors supported kinds through forms.
Draft → record normalization lives in `js/domain/customContentAuthoring.js`
and delegates final validation to `validateCustomContentRecord`, so the
editor and the JSON import path share one rule system. Contract:

- ids are generated from the display name (slug, suffixed past builtin and
  custom collisions) and are **immutable after creation** — editing never
  mints a new record, so character references stay valid;
- authored records are byte-identical in shape to imported ones (no
  parallel authoring format);
- currently authorable kinds:
  - **spell** — all fields of the SRD spell shape, including
    `classIds`/`subclassIds` list membership;
  - **feat** — prerequisites and the closed `effects` vocabulary as
    repeatable rows;
  - **race** — size, speed, ability score increases, languages, lore, and
    inline **trait sub-records** (each trait row is saved as its own
    `kind: "trait"` custom record referenced from the race's `traits` array);
  - **class** — hit die, saving throws, armor/weapon/tool proficiencies,
    skill choices, ASI levels, inline **feature sub-records** (saved as
    `kind: "feature"` records with `classId`/`level`), spellcasting
    (progression none/full/half/pact with the **standard SRD slot table**
    deep-copied from the shipped wizard/paladin/warlock records; preparation
    mode known/prepared/spellbook; cantrips/spells-known as comma lists that
    pad to 20 levels by repeating the last value), `resources[]` pools
    (constant / classLevelMultiple / abilityModifier / byClassLevel incl.
    `unlimited`), and always-prepared `grantedSpells`.

  Multi-record saves are all-or-nothing; trait/feature records orphaned by
  an edit are removed only when no other custom record references them.
  Anything a form cannot represent — subclasses/subraces, build-time
  `choices[]`, multiclassing blocks, starting equipment, threshold-recovery
  resources, hand-written slot tables — is **preserved verbatim** through
  edits and remains JSON-import territory.

## Class Resources (2026-07-12, Level Up Phase 2)

A **class resource** is a shared limited-use pool granted by class levels
(Rage, Ki Points, Sorcery Points, Channel Divinity, Lay on Hands, …).
Derivation lives in `js/domain/rules/classResources.js`; seeding into
`character.resources[]` lives in `js/domain/builderSheetSeeding.js`.

### Definition shape (custom-class authoring)

Class records may carry a `resources: []` array. When present it is
**authoritative** for that class — including an empty array, which is a
deliberate "this class has no pools". Each entry:

```json
{
  "id": "runes",
  "name": "Runes",
  "max": { "type": "byClassLevel", "values": [2, 2, 3, 3, "unlimited"] },
  "recovery": "longRest"
}
```

- `id` — stable lowercase-hyphen pool id, unique within the class. Pools
  sharing an id **across** classes merge into one tile (SRD Channel Divinity
  multiclass rule: the highest single-class maximum wins; the most
  permissive recovery wins).
- `max` is one of:
  - `{ "type": "byClassLevel", "values": [...] }` — index = class level − 1;
    `null`/`0` = not yet unlocked; the literal string `"unlimited"` marks an
    untracked pool (Rage at barbarian 20).
  - `{ "type": "constant", "value": n, "startLevel": n }`
  - `{ "type": "classLevelMultiple", "multiplier": n, "startLevel": n }`
    (Lay on Hands is `multiplier: 5`)
  - `{ "type": "abilityModifier", "ability": "cha", "minimum": 1, "startLevel": n }`
- `recovery` — one mode from the closed rest vocabulary (`shortRest`,
  `longRest`, `shortOrLongRest`, `manual`, `none`) or an array of
  `{ "minClassLevel": n, "recovery": mode }` thresholds (Bardic Inspiration
  upgrades to `shortOrLongRest` at bard 5).

Malformed definitions are skipped with a derivation warning and rejected
with a per-entry error at custom-content import time.

### Builtin synthesis

Builtin SRD classes do **not** carry `resources` arrays in
`game-data/srd/classes.json`. Their pool definitions synthesize at runtime
in `classResources.js` from the shipped `classSpecificByLevel` counts plus a
closed rules-text vocabulary for what the upstream API does not model
(recovery cadence; Second Wind, Wild Shape, Lay on Hands, Bardic
Inspiration, and Paladin Channel Divinity counts — keyed on the class's
`featuresByLevel` actually granting the feature). This is the same
rules-text precedent as `UNARMORED_AC_FORMULAS`. Deliberately **not**
resources: static progression values (Rage damage, Bardic die size, Sneak
Attack dice), calculated recovery amounts (Arcane Recovery's slot levels —
only its 1/day use is a pool), and feature-specific counters owned by
`featureUses`.

### Seeded resource ownership

Seeded entries in `character.resources[]` carry
`builderSeed: "class-resource:<poolId>"` (the `inventoryItems[].builderSeed`
precedent — no schema change). Ownership:

- **User-owned:** `name` (never auto-renamed), `cur` (moved only by the
  level-up delta, rest recovery, or the user).
- **Builder-updated:** `max` grows by the derived before→after delta on
  Level Up (manual offsets are kept; spent uses stay spent; unlimited pools
  stop receiving numeric updates); `recovery` follows
  recompute-if-untouched.
- Finish/Edit seeding is fill-only-when-empty and duplicate-aware: an
  unmarked manual tracker whose name matches a derived pool is **adopted**
  (marker stamped, values kept) instead of duplicated.
- If the granting class/content is later edited or removed, seeded entries
  degrade to inert user-owned tiles — they are never deleted automatically.

## Structured Attacks (2026-07-15 — supersedes matrix #9 Recalculate)

Attacks follow the [character calculation contract](./character-calculation-contract.md):
they **derive live** rather than being recalculated on demand. The one canonical
calculator lives in `js/domain/attackCalculation.js` and is called by wizard
Finish seeding, the attack editor, the character-page Attacks panel, and the
combat embedded Weapons panel — there is no second attack formula.

A structured attack row carries a `calc` block (an optional extra key on the
open `AttackEntry` shape — no schema change):

```js
calc: {
  mode: "weapon" | "ability" | "spell" | "fixed",
  weaponId,            // weapon mode: builtin or custom weapon record
  ability,             // "" = auto (weapon rule / primary spellcasting)
  proficient,          // stored input — never assumed from being weapon-backed
  baseDamage,          // "" = from the weapon record (weapon mode)
  damageAbility,       // "" = same ability as the attack roll
  addAbilityToDamage,
  damageType, range,   // "" = from the weapon record (weapon mode)
  attackAdjustment,    // explicit homebrew adjustments, stored separately so
  damageAdjustment     // recalculation never erases them
}
```

Ownership and behavior:

- **Derived (build/sheet-driven):** `bonus`, `damage`, `range`, `type` are
  computed from `calc` + `deriveCharacter()` at render time. Changing STR,
  DEX, proficiency bonus, a linked weapon record, or an ability selection
  updates the displayed values automatically — **no recalculate action, for
  both builder and freeform characters**.
- **Always user-owned:** `name`, `notes`, row order, `id`.
- **`calc.mode: "fixed"`** is the intentional fixed override — the stored
  strings are the display and nothing recalculates until the user switches
  modes. **Legacy rows (no `calc`)** are snapshots that keep their stored
  strings until explicitly converted in the editor.
- **Proficiency** is `calc.proficient`, defaulted from the character's derived
  weapon proficiencies (`isWeaponProficient`) when a weapon is chosen; a
  category token ("martial") or a specific token ("longswords") both match.
- Seeded weapon rows carry `builderSeed: "weapon:<weaponId>"`. The marker
  survives renames; **display names are never used to infer a source**, and
  re-seeding (Edit in Builder / Level Up) dedupes by the marker, so a renamed
  seeded attack is never duplicated.

**The per-row Edit dialog** replaces the retired "Recalculate from Build"
dialog (whose Apply failed in production preview and whose on-demand model was
the wrong shape). It previews the derived result live, applies one atomic
patch on confirm, never mutates on Cancel/Escape, and is where legacy rows are
converted (link a weapon explicitly, enter structured inputs, or confirm fixed
mode). Custom weapon records resolve through the same kind-aware registry path
as builtins.

## Feat Effects Vocabulary (2026-07-06)

Feat records may carry structured `effects` interpreted by
`collectFeatEffects()` in `js/domain/rules/progression.js`. The closed
vocabulary (unknown types are ignored as description-only):

- `{ "type": "hp_per_level_bonus", "value": n }`
- `{ "type": "ability_bonus", "ability": "str", "value": n }`
- `{ "type": "speed_bonus", "value": n }`
- `{ "type": "ac_bonus", "value": n }`
- `{ "type": "initiative_bonus", "value": n }`
- `{ "type": "save_proficiency", "ability": "str" }`
- `{ "type": "skill_proficiency", "skill": "athletics" }`

## Level-by-Level Build Model (build.version 2, 2026-07-06)

Builder characters store one entry per character level in `build.levels`
(`{ classId, hp }`; `hp` null = SRD average, level 1 always max die), plus
`subclassByClass`, `spellcasting` selections per class
(`{ cantripIds, knownIds, preparedIds }`), and `equipment`
(`{ armorId, shield, weaponIds, startingChoices, notes }`). Legacy v1
builds (`classId` + `level`) migrate via `normalizeCharacterBuild()` in
`js/domain/characterHelpers.js` (schema v11).

---

## Summary

Lore Ledger's content registry should be:

- structured
- data-driven
- source-labeled
- stable-ID based
- separate from UI state and runtime state

The 14 shipped registry files are listed once, under
[Shipped Registry Files](#shipped-registry-files). Do not restate them here.

Final rule:

> If builtin content is approved to ship, it should live in structured registry files with stable IDs and explicit source metadata, not in scattered hardcoded UI logic.
