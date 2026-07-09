# Multi-Character System — Design Document

Lore Ledger · drafted April 2026 · restructured 2026-07-09

> **How to read this document.** It has two parts, and they have different authority:
>
> - **Part 1 — Current character architecture.** Canonical. Rules that still bind new
>   code. Keep in sync with the code.
> - **Part 2 — Historical implementation notes (Steps 1-4).** A record of how the
>   multi-character system was built, step by step, in April 2026. **Reference only.**
>   Its "Status", "Files affected", and schema-version statements were accurate when
>   written and have drifted since. Do not treat Part 2 as a description of today's code,
>   and do not change code to match it.
>
> The multi-character system shipped. All four steps are complete.

---

# Part 1 — Current character architecture (canonical)

## Character model

- Characters live in `state.characters.entries`, selected by `state.characters.activeId`.
  Resolve the active one with `getActiveCharacter(state)`.
- The legacy `state.character` singleton key is valid **only** in migration and
  backward-compatibility code. Never use it in new production code.
- **Builder characters have `build !== null`. Freeform characters have `build: null`.**
  These two modes must not be collapsed.
- Builder characters use the level-by-level build model (`build.version` 2) with bare SRD
  registry ids. Current schema version is `11` — see `docs/state-schema.md`, which is
  canonical for the persisted shape.
- Custom content is persisted per campaign in the `content.custom` bucket (schema v11).

## Architecture rules (carried forward)

1. **Canonical data has one source of truth.** Linked cards are views, not copies.
2. **UI composition state is not domain data.** Which character is active, which cards are collapsed — these are separate from character content.
3. **Migration safety is mandatory.** Every state shape change gets a defensive migration with tests.
4. **Freeform mode is always available.** Users who don't want the builder can use the sheet manually.
5. **Builtin content is read-only.** Edits fork into custom copies.
6. **The green-list rule is absolute.** If it's not in the SRD 5.1 green list, it's custom.
   See `docs/reference/builder-scope-greenlist.md` for what that list actually contains —
   it is much smaller than full 5E.

## Where the canonical detail lives

| Topic | Canonical doc |
| --- | --- |
| Persisted shape, migrations | `docs/state-schema.md` |
| Shipped builtin content scope | `docs/reference/builder-scope-greenlist.md` |
| Registry record shapes | `docs/reference/content-registry-plan.md` |
| Module boundaries | `docs/architecture.md` |
| Rules that win on conflict | `AGENTS.md` |

---

# Part 2 — Historical implementation notes (Steps 1-4)

> ⚠️ **Reference only. Written April 2026, during implementation.**
>
> Everything below describes the sequence in which the multi-character system was built.
> Status lines, file lists, and especially **schema version numbers** in this part are
> frozen at time of writing and are now stale — for example, Step 3 below references
> schema v6; the current version is v11. Trust `docs/state-schema.md` over anything here.
>
> Kept because it records the decisions and tradeoffs that later changes must respect.

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
- New Builder Character
- Rename Character
- Add to NPCs
- Add to Party
- Export Character
- Import Character
- Delete Character

Step 2 tracker-card linking actions and Step 4 import/export actions have since shipped. Step 3 character builder/rules-engine work is now in progress: the current builder creation path supports the shipped Identity, Dragonborn Race Choices, Ability Scores, Summary, Finish seeding, and derived Dragonborn surfaces. Broader content-complete class/background/equipment/spell choice flows, generalized seeding, level-up additions, shared-resource automation, and full builder-card customization remain future work.

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

The combat embedded panels (Vitals, Spells, Weapons / Attacks, Equipment, and Abilities / Skills) are live alternate views of canonical active character data. They resolve the active character through `getActiveCharacter(state)`, the same as the Character page.

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

**Status:** Complete, audited, and fully verified (2026-04-15). See `STEP2_TASKS.md` for the full task list and closeout summary.

### Goals

A character can be added to the party cards or NPC cards from the character page. Linked cards are bidirectional views into the shared character fields. Location-card linking was deliberately deferred because location cards do not share the same HP/class/status shape.

### Linking model

Tracker cards (NPC and Party) gain an optional field:

```json
characterId: string | null   // references a characters.entries[].id
```

When `characterId` is present, the card is a **linked card**. When null/absent, it is a **standalone card** (current behavior, unchanged).

### Data flow — "multiple windows into the same room"

Linked card fields that exist on both the card and the character are **read from and written to** the character entry:

- `name` ↔ `character.name`
- `imgBlobId` ↔ `character.imgBlobId`
- `hpCurrent` ↔ `character.hpCur`
- `hpMax` ↔ `character.hpMax`
- `status` ↔ `character.status`
- `className` ↔ `character.classLevel`

Edits on the tracker card write through to the character. Edits on the character page reflect on all linked cards. The card does not store its own copy of these fields when linked.

Card-only fields that have no character equivalent (like `sectionId`, `group`, `collapsed`, `portraitHidden`, and `notes`) remain on the card itself. The earlier `looseNotes` idea was not implemented; Step 2 intentionally kept tracker card notes card-only because they often represent DM-facing or session-specific context rather than character-sheet content.

### Multiple placements

A single character can be linked to cards in multiple tracker sections simultaneously (party and/or NPCs). Each linked card is an independent view referencing the same `characterId`.

### "Add to NPCs / Party" flow

Triggered from the character page sub-toolbar overflow menu:

1. User taps "Add to NPCs" or "Add to Party".
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

```psudocode
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

**Status:** In progress. The original design below still describes the larger target. Current shipped scope includes schema v6 builder metadata, pure first-slice derivation, the current builder creation path through Identity, supported Dragonborn Race Choices, Ability Scores, Summary, and Finish, an informational Builder Mode badge, Builder Identity and Builder Abilities editors, Builder Summary as temporary live review/comparison scaffolding, normal-panel display for supported builder-derived values, manual/custom Abilities & Features cards, manual/custom limited-use counters, derived Dragonborn Breath Weapon use tracking through `featureUses`, and narrow Dragonborn Finish-time seeding into existing editable Features / Traits and Languages fields. Broader content-complete class/background/equipment/spell choice flows, generalized seeding, level-up additions, field locking/override UI, full builder-card customization, custom content, and broad HP/AC/spell/combat/shared-resource automation remain future work.

### Goal

Add a character creation wizard and level-up flow backed by SRD 5.1 content, with a clean builtin/custom content split.

### Character state evolution

Each character entry gains a `build` object and an `overrides` object alongside the existing flat fields. The shape below reflects the schema-v6 implementation; see `docs/state-schema.md` for the canonical schema-of-record.

```json
{
id: "char_abc123",
// Build choices (source of truth for the rules engine when build !== null)
build: {
version: 1,
ruleset: "srd-5.1",
raceId: "dwarf",                  // registry id or null
classId: "fighter",               // registry id or null
subclassId: "champion",           // registry id or null until subclass level
backgroundId: "soldier",          // registry id or null
level: 3,
abilityMethod: "standard-array",  // "standard-array" | "point-buy" | "rolled" | "manual"
abilities: {
base: { str: 15, dex: 13, con: 14, int: 8, wis: 10, cha: 12 }
},
// user selections for build-time choices, keyed by level then by choice id.
// Example: a Dragonborn picking Red ancestry at character creation:
//   choicesByLevel["1"]["dragonborn-ancestry"] = "red"
// See docs/reference/content-registry-plan.md "Build-Time Choices Schema".
choicesByLevel: {
"1": { /* per-choice picks / },
"4": { / ASI/feat picks at level 4, etc. */ }
}
},
// Manual overrides — additive deltas applied on top of derived values.
// Currently shipped scope: ability/save/skill/initiative deltas only.
overrides: {
abilities:   { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
saves:       { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
skills:      { /* skillId: delta */ },
initiative:  0
},
// Existing flat freeform fields. For builder characters these remain as fallback
// storage; derived display values are read from deriveCharacter(...) per panel.
// For freeform characters (build: null), these are the source of truth.
name: "Thorin",
classLevel: "Fighter 3",
race: "Dwarf",
hpMax: 28,
ac: 18,
// ...etc
}
```

The `overrides` shape above is intentionally narrower than the original aspirational design. It will expand as automation lands for HP, AC, hit points, speed, AC additional-ability (Unarmored Defense), shield bonus, and similar fields. New override fields must be added through the schema migration path.

> **Stale when written.** This paragraph said "current schema version `6`" and pointed at
> `docs/plans/lore-ledger-builder-plan.md` for the roadmap. The current schema version is
> `11` (see `docs/state-schema.md`), and that plan doc is archived at
> `docs/archive/lore-ledger-builder-plan.md`.

### Freeform vs builder mode

If `build` is null, the character operates in freeform mode — exactly like today. All fields are manually editable. This preserves backward compatibility and supports users who decline the "Create a character?" prompt.

If `build` is present, the rules engine computes derived fields. The flat fields are written by the engine and should not be directly edited by the user (the UI disables direct input on computed fields and provides the override modal instead, like the Fifth Edition Character Sheet app).

Current implementation note: builder-created characters are editable characters, not locked rules objects. Builder Identity can edit the current identity inputs, Builder Abilities edits only `build.abilities.base`, and Builder Summary reads `deriveCharacter(...)` as temporary review scaffolding without persisting derived labels, proficiency bonuses, ability totals, Dragonborn DCs, or Breath Weapon mechanics back into unrelated flat fields. Supported live-derived values appear in normal panel homes where players use them: Basics for identity labels, Abilities/Skills for derived ability totals and builder proficiency scalar, Vitals for compact derived stats such as Breath Weapon DC, and Abilities & Features for action-style mechanics such as Breath Weapon. Phase 3I seeds only Dragonborn Draconic Ancestry/Damage Resistance text into `features` and fixed Dragonborn languages into `languages` at wizard Finish; that text becomes user-owned and is not silently synchronized afterward. The broader content-complete builder wizard, subclass/class/background/equipment/spell choices, generalized seeding, level-up additions, field locking/override UI, HP/AC/spell automation, shared-resource automation, custom content, and full builder-card customization remain future work.

### Content model

Every piece of game content follows one schema:

```json
{
  id: string,
  kind: "race" | "class" | "subclass" | "background" | "feat" | "spell" | "armor" | "weapon",
  name: string,
  source: "builtin" | "custom",
  data: { ... }   // kind-specific payload
}
```

- `builtin` items ship with the app, are read-only, and are backed by SRD 5.1.
- `custom` items are user-created. Editing a builtin item creates a custom copy.
- The green list (SRD 5.1 baseline) defines exactly which items are builtin.

> **Superseded.** This section originally read: "Content registry lives at app level, not
> per-campaign. All campaigns share the same builtin + custom content library." That is
> **not** what shipped. Builtin SRD content is code-shipped under `js/domain/rules/` and
> never persisted; **custom content is campaign-scoped** in the `content.custom` bucket
> (schema v11, `js/state.js`). Campaigns do not share a custom content library.

#### Armor data shape

```json
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

```json
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
- Long Rest: restores HP to max, recovers spent Hit Dice, restores long-rest resources and spell slots.

Both operate on the active character only.

> **Corrected.** This originally said Long Rest "resets hit dice (half level, min 1)".
> Under SRD 5.1 a long rest recovers **spent Hit Dice up to half the character's total
> Hit Dice** (minimum one die) — it is not a reset, and it is keyed to total Hit Dice, not
> character level. Canonical rest behavior now lives in
> [`docs/reference/rest-rules-spec.md`](../reference/rest-rules-spec.md).

### SRD 5.1 green list (builtin baseline) — SUPERSEDED, DO NOT USE

> ⚠️ **This section was wrong and has been removed.** It was drafted from memory of 5E
> before the registry was built, and it named content that SRD 5.1 does not contain:
>
> - It listed **Goliath** and **Orc** as races. Those are SRD **5.2.1** content, and
>   5.2.1 is retired for this project. SRD 5.1 has Half-Elf and Half-Orc instead.
> - It listed **Criminal, Sage, and Soldier** as backgrounds. **Acolyte is the only
>   background in SRD 5.1.**
> - It said spells and feats were "a subset, to be extracted from PDF". The full 319-spell
>   registry ships, and **Grappler is the only feat in SRD 5.1.**
> - Its subclass names used 5.2.1 phrasing ("Warrior of the Open Hand", "College of Lore").
>
> Anything not in SRD 5.1 is **custom/homebrew content**, never shipped builtin content.
>
> The single source of truth for shipped builtin scope is
> [`docs/reference/builder-scope-greenlist.md`](../reference/builder-scope-greenlist.md),
> which is measured against `game-data/srd/*.json`. Read that, not this.

---

## Step 4 — Cross-campaign character import

**Status:** Complete, audited, and fully verified. See [`./character-portability.md`](./character-portability.md) for the full implementation rationale. (This previously also pointed at `STEP4_TASKS.md`, which no longer exists in the repo.)

### Goal

A character (with portrait) can be exported from one campaign and imported into another as an independent copy.

### Export format

A single JSON file containing:

- The full character entry object (all fields, build, overrides)
- The portrait image as a full data URL (if present)
- Spell notes keyed by spell entry ID
- A format version tag for future-proofing

```json
{
  formatVersion: 1,
  type: "lore-ledger-character",
  character: { ...full entry },
  portrait: { dataUrl: "data:image/webp;base64,...", mimeType: "image/webp" } | null,
  spellNotes: { [spellId]: noteText }
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

### Shipped summary

- Export writes `{ formatVersion: 1, type: "lore-ledger-character", character, portrait, spellNotes }` to a `.ll-character.json` file.
- Import validates and parses the full file before mutating state or writing blobs.
- Imported characters always receive fresh IDs; import adds a new character and never replaces an existing one.
- Portraits are bundled in the export and restored as new destination IndexedDB blobs.
- Spell notes remain outside structured state, but export bundles only the active character's spell notes and import restores them under destination-campaign text keys.
- Linked NPC/Party cards do not travel with the character. The imported character arrives standalone and can be linked to destination tracker cards afterward.

### Scope

One character at a time. No batch export/import.

---

## Original open questions (all resolved — historical)

These were the open questions recorded during implementation. They are listed here for
provenance; none are open work.

1. **`status` field**: Resolved in Step 2. Characters gained a `status: ""` field (schema v5). Linked cards read and write status from the character entry via `cardLinking.js`. Status is character-level state, visible everywhere the character appears.

2. **Content registry storage location**: Resolved. Builtin SRD content is code-shipped under `js/domain/rules/` and never persisted. Custom content is persisted **per campaign** in the `content.custom` bucket, added in schema v11 — not at app level as this question originally proposed.

3. **Spell notes scoping**: Resolved in Step 4. Spell notes remain campaign-scoped IDB text records (`textKey_spellNotes(campaignId, spellId)`). Character export bundles notes for the exported character's spell IDs, and import restores those notes under the destination campaign.

4. **Character sub-toolbar styling**: Resolved during implementation. The shipped sub-toolbar uses the selector plus a `...` overflow menu.

5. **`looseNotes` field**: Not implemented. Step 2 kept tracker card notes card-only, so no character-level `looseNotes` field or mirrored notes UI is needed for the shipped linking model.

The canonical architecture rules that came out of this work now live in **Part 1** at the
top of this document.
