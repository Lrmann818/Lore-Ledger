# Multi-Character System — Design Document

Lore Ledger · April 2026

This document captures every design decision agreed upon for the multi-character system. It serves as the single reference for implementation.

---

## Summary

The character page evolves from a single freeform sheet into a multi-character manager with a creation wizard, tracker card linking, and cross-campaign import. Implementation is sequenced in four steps to minimize risk and keep the app shippable at each stage.

---

## Step 1 — Multi-character support

**Status:** Complete, audited, and fully verified.

### Goal

Move from one character per campaign to many characters per campaign, with a selection and management UI.

### State shape change

```js
// Before (singleton)
character: { name, race, classLevel, abilities, spells, ... }

// After (collection)
characters: {
  activeId: string | null,
  entries: CharacterEntry[]
}
```

The existing character field schema is unchanged inside each entry. The only structural change is wrapping the singleton in an indexed collection.

The legacy singleton `state.character` key is valid only in migration and backward-compatibility handling for old saves/backups. It must not be reintroduced in production code.

### Migration

When `migrateState` encounters the legacy `character` object (no `characters` wrapper):

1. If the legacy character has any non-default data → wrap it as the first entry in `entries[]` with a generated ID, set `activeId` to that ID.
2. If the legacy character is entirely default/empty → set `entries: []` and `activeId: null`.
3. New campaigns start with `entries: []` and `activeId: null`.

Migration is test-backed and part of the completed Step 1 verification suite.

### CampaignDoc type update

`CampaignDoc.character` became `CampaignDoc.characters`. The vault normalization layer (`normalizeCampaignDoc`) handles both shapes during the transition, but current campaign documents persist `characters`.

### Character page — empty state

When `activeId` is null and `entries` is empty, the character page displays an empty-state "Create your first character" prompt. Creating a character adds a blank character entry, selects it, and rerenders the page. Dismissal is session-only; a fresh campaign can intentionally have no active character until one is created.

### Character page — sub-toolbar

A character-specific toolbar is added between the main app toolbar/nav row and the first panel section. It sits inside `#page-character` and is only visible when the Character tab is active.

Contents (compact single row for mobile):

- Left side: character selector
- Right side: `...` actions menu containing:
  - New Character
  - Rename Character
  - Delete Character

Step 2 tracker-card linking actions, Step 3 character builder/rules-engine actions, and Step 4 import/export actions remain future work.

### Character selector behavior

- Shows all `entries` by name, scrollable if the list is long.
- Selecting a character sets `activeId` and re-renders the page.
- The currently active character is visually indicated.
- Default name for new characters: "New Character" (user can rename immediately).

### Panel data resolution

All character panels read from the active entry:

```js
function getActiveCharacter(state) {
  const { activeId, entries } = state.characters;
  if (!activeId || !entries.length) return null;
  return entries.find(e => e.id === activeId) || null;
}
```

When `getActiveCharacter` returns null, panels render in their current default/empty state. This preserves the existing behavior for "no character selected."

Character writes should use state action helpers such as `mutateCharacter(...)` and `updateCharacterField(...)` so updates target the active entry under `state.characters.entries`.

### Combat workspace

The combat embedded panels (Vitals, Spells, Weapons / Attacks) are live alternate views of canonical active character data. They resolve the active character through `getActiveCharacter(state)`, the same as the Character page.

Which character is active on the Character page is the character shown in Combat. Embedded panel updates use active-character change events and panel invalidation/rebinding rather than duplicate state or a sync store. The architectural rule is strict: no duplicate character data and no embedded-panel sync store.

A future enhancement could let the Combat workspace pin a specific character independently.

### Files affected

- `state.js` — default shape, migration, sanitize, typedef
- `campaignVault.js` — CampaignDoc type, extractCampaignDoc, normalizeCampaignDoc, projectActiveCampaignState, persistRuntimeStateToVault
- `characterPage.js` — active character resolution, sub-toolbar init, empty state
- `basicsPanel.js` — read from active entry
- `vitalsPanel.js` — read from active entry
- `abilitiesPanel.js` — read from active entry
- `spellsPanel.js` — read from active entry
- `attackPanel.js` — read from active entry
- `equipmentPanel.js` — read from active entry
- `proficienciesPanel.js` — read from active entry
- `personalityPanel.js` — read from active entry
- `combatEmbeddedPanels.js` — read from active entry
- `backup.js` — import validation for new shape
- `index.html` — sub-toolbar DOM structure
- `styles.css` — sub-toolbar styling
- Tests for migration, backup import/export, and active character resolution
- Smoke tests updated for the Step 1 model where fresh campaigns can have no active character until one is created

---

## Step 2 — Character ↔ tracker card linking

**Status:** Future work.

### Goal

A character can be added to the party cards, NPC cards, or location cards from the character page. Linked cards are bidirectional views into the character data.

### Linking model

Tracker cards (NPC, Party, Location) gain an optional field:

```
characterId: string | null   // references a characters.entries[].id
```

When `characterId` is present, the card is a **linked card**. When null/absent, it is a **standalone card** (current behavior, unchanged).

### Data flow — "multiple windows into the same room"

Linked card fields that exist on both the card and the character are **read from and written to** the character entry:

- `name` ↔ `character.name`
- `imgBlobId` ↔ `character.imgBlobId`
- `hpCurrent` ↔ `character.hpCur`
- `hpMax` ↔ `character.hpMax`
- `status` ↔ `character.status` (new field on character, or kept as card-only — TBD)
- `className` ↔ `character.classLevel`
- `notes` ↔ `character.looseNotes` (new field — a "loose notes" section on the character page that mirrors the card notes field)

Edits on the tracker card write through to the character. Edits on the character page reflect on all linked cards. The card does not store its own copy of these fields when linked.

Card-only fields that have no character equivalent (like `sectionId`, `group`, `collapsed`, `portraitHidden`) remain on the card itself.

### Multiple placements

A single character can be linked to cards in multiple tracker sections simultaneously (party, NPCs, and/or locations). Each linked card is an independent view referencing the same `characterId`.

### "Add to NPCs / Party / Locations" flow

Triggered from the character page sub-toolbar overflow menu:

1. User taps "Add to NPCs" (or Party / Locations).
2. A linked card is created in the appropriate tracker section with `characterId` set.
3. A confirmation toast/status message appears ("Added to NPCs").
4. User stays on the character page.

### Deleting a character with linked cards

When the user deletes a character:

1. A warning dialog lists all tracker sections where this character has linked cards.
2. The dialog explains: "Linked cards will keep their last known data and become standalone cards."
3. On confirm: the character is removed from `entries`, all cards with that `characterId` get their linked fields copied into the card's own fields, and `characterId` is set to null. They become standalone cards with a snapshot of the data.

### Deleting a linked card

When the user deletes a linked tracker card:

1. Only the card is removed from the tracker section.
2. The character is unaffected.
3. No special warning needed beyond the standard card deletion confirmation (if any).

### Rendering linked cards

Card rendering logic needs a branch:

```
if (card.characterId) {
  const char = getCharacterById(state, card.characterId);
  // read name, hp, portrait, class from char
  // fall back to card's own fields if char not found (orphaned link)
} else {
  // current standalone behavior
}
```

If a `characterId` points to a character that no longer exists (data corruption, partial import), the card falls back to standalone mode silently. No crash, no error — just uses whatever data it has.

---

## Step 3 — Rules engine and character builder

**Status:** Future work.

### Goal

Add a character creation wizard and level-up flow backed by SRD 5.2.1 content, with a clean builtin/custom content split.

### Character state evolution

Each character entry gains a `build` object and an `overrides` object alongside the existing flat fields:

```
{
  id: "char_abc123",
  
  // Build choices (source of truth for the rules engine)
  build: {
    species: "dwarf",           // green-list id or custom id
    class: "fighter",
    subclass: "champion",       // null until subclass level
    level: 3,
    background: "soldier",
    abilityMethod: "standard-array",
    abilityBase: { str: 15, dex: 13, con: 14, int: 8, wis: 10, cha: 12 },
    equippedArmor: "armor_studded_leather",  // content registry id or null
    equippedShield: true,                     // whether a shield is equipped
    // level-up choices recorded per level
    levelChoices: {
      1: { skills: ["athletics", "intimidation"], ... },
      4: { feat: null, asi: { str: 2 } },
      ...
    }
  },
  
  // Manual overrides — additive, never replace computed values
  overrides: {
    strMisc: 0,
    dexMisc: 0,
    // ...per-ability misc bonus
    strSaveMisc: 0,
    dexSaveMisc: 0,
    // ...per-save misc bonus
    acMisc: 0,
    acShieldBonus: 0,             // manual shield bonus input (typically 0 or 2)
    acAdditionalAbility: null,    // "wis", "con", etc. or null — for Monk/Barbarian unarmored defense
    initiativeMisc: 0,
    speedMisc: 0,
    hpMisc: 0,
    // ...any additional escape hatches
  },
  
  // Existing flat fields become computed outputs
  // OR: if build is null, these remain freeform (manual mode)
  name: "Thorin",
  classLevel: "Fighter 3",
  race: "Dwarf",
  hpMax: 28,
  ac: 18,
  // ...etc
}
```

### Freeform vs builder mode

If `build` is null, the character operates in freeform mode — exactly like today. All fields are manually editable. This preserves backward compatibility and supports users who decline the "Create a character?" prompt.

If `build` is present, the rules engine computes derived fields. The flat fields are written by the engine and should not be directly edited by the user (the UI disables direct input on computed fields and provides the override modal instead, like the Fifth Edition Character Sheet app).

### Content model

Every piece of game content follows one schema:

```
{
  id: string,
  kind: "species" | "class" | "subclass" | "background" | "feat" | "spell" | "armor" | "weapon",
  name: string,
  source: "builtin" | "custom",
  data: { ... }   // kind-specific payload
}
```

- `builtin` items ship with the app, are read-only, and are backed by SRD 5.2.1.
- `custom` items are user-created. Editing a builtin item creates a custom copy.
- The green list (SRD 5.2.1 baseline) defines exactly which items are builtin.

Content registry lives at app level, not per-campaign. All campaigns share the same builtin + custom content library.

#### Armor data shape

```
{
  id: "armor_studded_leather",
  kind: "armor",
  source: "builtin",
  name: "Studded Leather",
  data: {
    type: "light" | "medium" | "heavy",
    baseAC: 12,
    addDex: true,            // whether Dex mod is added to AC
    maxDex: null,            // null = unlimited, number = capped (e.g. 2 for medium)
    minStr: null,            // minimum Str to avoid speed penalty (e.g. 15 for heavy)
    stealthDisadv: false,    // disadvantage on Stealth checks
    cost: "45gp",
    weight: 13
  }
}
```

#### Weapon data shape

```
{
  id: "weapon_spear",
  kind: "weapon",
  source: "builtin",
  name: "Spear",
  data: {
    category: "simple" | "martial",
    type: "melee" | "ranged",
    damage: "1d6",
    damageType: "piercing",
    range: "20/60",            // melee weapons: reach in feet; thrown/ranged: short/long
    properties: ["thrown", "versatile"],
    versatileDamage: "1d8",    // damage when used two-handed (if versatile)
    cost: "1gp",
    weight: 3
  }
}
```

### Override modal pattern (from Fifth Edition Character Sheet)

When a user taps and holds (or taps an edit button) on a computed field like Strength:

- A modal opens showing the base score and a "Misc Bonus" input.
- The displayed value is `base + racial + misc`.
- The user can only edit the misc bonus — the base and racial are computed.
- Cancel / Apply buttons.

Same pattern for saves (save proficiency checkboxes + misc save bonus), initiative, speed, etc.

### Armor Class modal

The AC modal decomposes Armor Class into its component parts:

- **Armor Bonus**: set by selecting armor from the registry (see Select Armor flow below).
- **Shield Bonus**: manual input (0 if no shield, 2 for standard shield).
- **Dex Mod**: derived from ability scores. Grayed out / non-editable.
- **Max Dex**: derived from armor type (unlimited for light, capped for medium, ignored for heavy). Grayed out / non-editable.
- **Misc Mod**: manual override for magic items, feats, class features, etc.
- **Armor Type**: dropdown (Light / Medium / Heavy). Set automatically by armor selection, but can be overridden.
- **Additional Ability Mod**: dropdown (None / other ability). For edge cases like Monk Unarmored Defense adding Wis.

Computed AC = `Armor Bonus + min(Dex Mod, Max Dex) + Shield Bonus + Misc Mod + Additional Ability Mod`.

#### Select Armor flow (nested modal)

From the AC modal, a "Select Armor" button opens a secondary picker:

1. **Armor Type** dropdown: Light / Medium / Heavy.
2. **Armor** dropdown: filtered list of armor from the content registry matching the selected type.
3. Details shown below the selection: AC formula, cost, weight, and any special properties (e.g. stealth disadvantage).
4. Cancel / Apply — applying sets the armor bonus, max dex, and armor type in the parent AC modal.

Both builtin (SRD) and custom armor appear in the dropdown.

### Add Weapon modal

The weapon modal uses a **Custom / Select toggle** at the top:

**Select mode** (picking from registry):

1. **Category** toggle: Simple / Martial.
2. **Type** toggle: Melee / Ranged.
3. **Weapon** dropdown: filtered list from content registry matching category + type.
4. Details shown below: damage, damage type, range, and properties (e.g. "Thrown (range 20/60), versatile (1d8)").
5. Cancel / Apply — applying adds the weapon to the character's attacks list with all stats pre-filled.

**Custom mode** (freeform entry):

- User types weapon name, damage, range, type, notes manually.
- No content registry lookup. This is the existing "+ Weapon" behavior.

Both builtin and custom weapons appear in the Select dropdown. The Custom/Select toggle maps directly to the builtin/custom content split — Select browses the registry, Custom bypasses it.

### Level Up flow

Triggered from the character sub-toolbar menu. Walks the user through level-appropriate choices:

- HP increase (roll or average)
- New features granted by class at this level
- ASI or feat at appropriate levels
- Subclass selection at the class's branch level
- New spells known / prepared (if applicable)

Choices are recorded in `build.levelChoices[level]`.

### Short / Long Rest

Triggered from the sub-toolbar menu:

- Short Rest: prompts for hit die usage, restores relevant resources.
- Long Rest: restores HP to max, resets hit dice (half level, min 1), restores all long-rest resources and spell slots.

Both operate on the active character only.

### SRD 5.2.1 green list (builtin baseline)

Species: Dragonborn, Dwarf, Elf, Gnome, Goliath, Halfling, Human, Orc, Tiefling

Classes (one subclass each): Barbarian (Berserker), Bard (College of Lore), Cleric (Life Domain), Druid (Circle of the Land), Fighter (Champion), Monk (Warrior of the Open Hand), Paladin (Oath of Devotion), Ranger (Hunter), Rogue (Thief), Sorcerer (Draconic Sorcery), Warlock (Fiend Patron), Wizard (Evoker)

Backgrounds: Acolyte, Criminal, Sage, Soldier (plus others present in SRD — to be confirmed against source PDFs)

Spells: subset present in SRD 5.2.1 (to be extracted from PDF)

Feats: subset present in SRD 5.2.1 (to be extracted from PDF)

Armor (all SRD armor):
- Light: Padded, Leather, Studded Leather
- Medium: Hide, Chain Shirt, Scale Mail, Breastplate, Half Plate
- Heavy: Ring Mail, Chain Mail, Splint, Plate
- Shield

Weapons (all SRD weapons):
- Simple Melee: Club, Dagger, Greatclub, Handaxe, Javelin, Light Hammer, Mace, Quarterstaff, Sickle, Spear, Unarmed Strike
- Simple Ranged: Crossbow (light), Dart, Shortbow, Sling
- Martial Melee: Battleaxe, Flail, Glaive, Greataxe, Greatsword, Halberd, Lance, Longsword, Maul, Morningstar, Pike, Rapier, Scimitar, Shortsword, Trident, War Pick, Warhammer, Whip
- Martial Ranged: Blowgun, Crossbow (hand), Crossbow (heavy), Longbow, Net

(Exact list to be confirmed against SRD 5.2.1 PDF — the above is the expected set.)

---

## Step 4 — Cross-campaign character import

### Goal

A character (with portrait) can be exported from one campaign and imported into another as an independent copy.

### Export format

A single JSON file containing:

- The full character entry object (all fields, build, overrides)
- The portrait image as a base64-encoded blob (if present)
- A format version tag for future-proofing

```
{
  formatVersion: 1,
  type: "lore-ledger-character",
  character: { ...full entry },
  portrait: { mimeType: "image/webp", base64: "..." } | null
}
```

### Import flow

Triggered from the character sub-toolbar menu ("Import Character"):

1. File picker opens, user selects the JSON file.
2. App validates the format version and character structure.
3. Character is added to `entries[]` with a **new generated ID** (never reuse the original ID to avoid collisions).
4. Portrait blob is stored in IndexedDB with a new blob ID, and the character's `imgBlobId` is updated to point to it.
5. `activeId` is set to the imported character.
6. If the character had linked cards in the original campaign, those are **not** imported. The character arrives standalone.

### Scope

One character at a time. No batch export/import.

---

## Architecture rules (carried forward)

1. **Canonical data has one source of truth.** Linked cards are views, not copies.
2. **UI composition state is not domain data.** Which character is active, which cards are collapsed — these are separate from character content.
3. **Migration safety is mandatory.** Every state shape change gets a defensive migration with tests.
4. **Freeform mode is always available.** Users who don't want the builder can use the sheet manually.
5. **Builtin content is read-only.** Edits fork into custom copies.
6. **The green-list rule is absolute.** If it's not in the SRD 5.2.1 green list, it's custom.

---

## Open questions (to be resolved during implementation)

1. **`status` field**: Currently exists on tracker cards but not on the character. Should a character have a `status` field that linked cards read from? Or does status remain card-specific? (Leaning toward: add it to character, since it's useful on the character page too.)

2. **Content registry storage location**: The builtin/custom content registry (species, classes, spells, etc.) should live at app level, not per-campaign. Need to decide exact storage shape and where in the vault it goes.

3. **Spell notes scoping**: Spell notes currently use campaign-scoped IDB text keys. With multi-character, they may need character-scoped keys: `spellNote:{campaignId}:{characterId}:{spellId}`.

4. **Character sub-toolbar styling**: Needs to be compact enough to not feel like it steals too much vertical space on mobile. May want to collapse into a single row with icon-only buttons beyond the selector and overflow menu.

5. **`looseNotes` field**: New field on character entries to match the tracker card `notes` field for linked card sync. Needs a corresponding UI section on the character page. Placement TBD.
