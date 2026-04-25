# Vertical Slice Schema (Design Record)

_Status: **RATIFIED 2026-04-22.** All open design questions resolved. Project-of-record rules are absorbed into `docs/reference/content-registry-plan.md` and `AGENTS.md` — see "Where These Decisions Are Canonical Now" at the end of this document._

_This file is a design record. It explains **why** the build-time choices schema and vertical-slice-first SRD registry strategy were chosen. `docs/reference/content-registry-plan.md` and `AGENTS.md` remain the authoritative **what** and rules. If they conflict with this record, the reference docs win and this file should be updated to reflect the discrepancy._

Last updated: 2026-04-22

---

## Purpose

This document captures the design for Lore Ledger's **build-time choices system** — the schema and conventions for representing the "pick one of these" moments throughout 5E character building (pick a language, pick a cantrip, pick a draconic ancestry, pick a subclass, pick a fighting style, etc.).

It also defines:

- How content records reference each other via IDs (normalization)
- How shipped content files are validated against SRD 5.1
- How traits whose mechanics depend on a choice are modeled
- The vertical-slice approach used to validate this design

It exists primarily as a **design record** — a "why we built it this way" reference for future contributors. The actual project rules live in `docs/reference/` and `AGENTS.md`; this file is the reasoning trail.

---

## Vertical Slice Approach

This design was built using a **vertical slice** — building one narrow path all the way through the architecture (race + class + subclass + background) before scaling horizontally to other content. The slice was chosen to exercise the most distinct architectural patterns, not the most surface content:

- **Dragonborn** — cascading choice (ancestry → determines breath weapon damage type, shape, save), forces the choice schema to handle "one input, multiple derived outputs"
- **Wizard** — spellcasting progression, level-gated features, choicesByLevel, prepared-vs-known spell distinction (designed in a later pass)
- **School of Evocation** — subclass feature progression by level, Sculpt Spells mechanic (designed in a later pass)
- **Acolyte** — multi-selection with constraint (`count: 2` languages, "any") (designed in a later pass)

If the schema designed for Dragonborn handles cascading choice cleanly, it generalizes. If it doesn't, we discover the failure on one race with one choice instead of after rebuilding twelve races.

---

## Relationship to Other Project Files

This file should be read together with:

- `docs/reference/srd-licensing-notes.md` — licensing posture, attribution
- `docs/reference/builder-scope-greenlist.md` — what categories may ship as builtin
- `docs/reference/content-registry-plan.md` — how shipped content is modeled (project rule of record for the schema)
- `docs/plans/lore-ledger-builder-plan.md` — phased rollout plan
- `AGENTS.md` — contributor rules and data fetch pipeline

Interpretation order:

1. `srd-licensing-notes.md` defines what we may use
2. `builder-scope-greenlist.md` defines what we intend to ship
3. `content-registry-plan.md` defines how records are modeled (rule of record)
4. **this document** explains _why_ the rules in (3) are what they are
5. `game-data/srd/*.json` contains the actual data

---

## Decisions Already Settled (Pre-Ratification)

These were worked through in conversation before the ratification questions and are recorded here so future readers can audit the reasoning.

1. **SRD 5.1 is the sole active source** for builtin content. SRD 5.2.1 is retired. (Per `srd-licensing-notes.md`.)
2. **Draconic ancestries are not subraces.** They are a build-time choice made within the Dragonborn race entry. Dragonborn's `subraceIds` correctly remains empty.
3. **Normalization wins over denormalization.** Content categories live in their own files, referenced by id. Inlining content into parent records is an anti-pattern.
4. **Descriptions are included in schemas now, populated from the API now, but NOT anchor-tested.** Anchor tests cover mechanics; flavor text is intentionally out of scope for anchoring.
5. **Draconic ancestries get their own file** (`game-data/srd/draconic-ancestries.json`). Ancestries are rich content records with per-entry mechanics, not simple string references.
6. **Chromatic/Metallic is lore metadata, not a schema grouping.** SRD 5.1 presents ancestries as a flat table with no chromatic/metallic split (verified against PDF). The distinction is represented as a `category` field on each ancestry record, which the UI can group by if it chooses.
7. **Licensing posture for text content**: all description/flavor text must come from SRD 5.1 only. No mixing in descriptions from other sources, even if they read "better."

---

## Core Concepts

### Normalization via IDs

Every content category has one canonical file. Records in other files reference content by id, never by inlining. This mirrors the dnd5eapi's URL-based reference pattern:

```Pseudocode
races.json → dragonborn → traits: ["draconic-ancestry", ...]
                                     ↑
                                     │ id reference
                                     │
traits.json ─────────────────────────┘
  draconic-ancestry → name, description
```

**The test for whether an id reference is sound**: for any id-shaped string in any file, you must be able to answer "which file owns the full definition of this id?" If the answer is ambiguous, the schema needs sharpening before implementation.

### The "choice" shape

Every build-time choice in 5E reduces to four questions:

1. **What kind of thing is being chosen?** (language, cantrip, skill, ancestry, fighting style, etc.)
2. **How many?** (usually 1, sometimes 2)
3. **From what pool?** (any language; any wizard cantrip; a specific fixed list; etc.)
4. **Where does this choice come from?** (granted by which race, class, background, feature?)

The shape:

```js
{
  id: "dragonborn-ancestry",          // stable id for this specific choice
  kind: "ancestry",                    // what category of thing is being picked
  count: 1,                            // how many to pick
  from: {                              // where the options come from
    type: "list",
    source: "draconic-ancestries"      // refers to draconic-ancestries.json
  },
  source: "race:dragonborn"            // where this choice originates
}
```

Other shapes for `from`:

- `{ type: "any" }` — any member of the `kind` category (e.g. Human's free language: "any language")
- `{ type: "list", options: ["red","blue","brass"] }` — literal list of ids
- `{ type: "list", source: "draconic-ancestries" }` — reference to a whole file's contents
- Future: `{ type: "list", source: "wizard-cantrips", filter: {...} }` — filtered list

### Constraints on the `kind` field

`kind` controls what the user is picking and what file(s) the chosen value is validated against. Working vocabulary for the Dragonborn slice:

- `language` — chosen value must be an id in `languages.json`
- `ancestry` — chosen value must be an id in `draconic-ancestries.json`
- `skill` — chosen value must be an id in `skills.json`
- `cantrip` — chosen value must be an id in `spells.json` (eventually)

This vocabulary grows as we build more content. It must never grow _silently_; adding a new `kind` value means updating `content-registry-plan.md` and the referential integrity test.

### Recording a user's chosen value

When a user makes a choice, the result is stored on the character's `build` object by choice id, keyed by the level at which the choice was made:

```js
build.choicesByLevel["1"]["dragonborn-ancestry"] = "red"
```

For race-level choices that happen at character creation, they live under level 1. Class/subclass choices made at later levels are keyed appropriately.

---

## Ratified Decisions

These were the open questions during design. Each is now ratified with the answer and reasoning.

### Q1 — ID naming: bare or namespaced?

**Decision: Bare ids.**

IDs like `"dragonborn"`, `"draconic-ancestry"`, `"red"` rather than namespaced like `"race:dragonborn"`.

**Reasoning:** Namespacing would be a bandaid for discipline. Uniqueness across content files is enforceable through the referential integrity test, and matches the dnd5eapi convention which keeps adapter friction lower. Project rule: **all ids must be unique across all `game-data/srd/*.json` content files**. Enforced by the referential integrity test.

**Consequence:** if a future situation creates a real id collision (e.g. `red` as both an ancestry and an equipment dye color), we revisit. Until then, bare wins.

---

### Q2 — Breath weapon shape: structured or stringly?

**Decision: Structured.**

```js
"breathWeapon": { "shape": "cone", "size": 15, "save": "dex" }
```

**Reasoning:** Structured fields are queryable, individually anchor-testable, and extend cleanly if a future edition adds new shape types or parameters. Stringly encodings (e.g. `"cone-15-dex"`) look simple until you need to read or change them in three different places — they're a classic beginner-trap that compounds cost over time.

---

### Q3 — Where do choices attach to races?

**Decision: Inline on the parent entry.**

Choices live as a `choices: []` array on the race (or class, or background, or subclass) entry that grants them. Not in a separate `choices.json`.

**Reasoning:** Lore Ledger is a campaign-tracker use case, where the dominant access pattern is "render this race entry" — not "find every choice across all content." Discoverability of all of a race's grants in one place outweighs the marginal benefit of cross-cutting normalization that we're unlikely to need.

---

### Q4 — Do traits carry choice-pointer information?

**Decision: No. Traits are purely descriptive.**

Trait records contain `id`, `name`, `description`, and (when applicable) `derivedFrom` — but NOT `choiceRef`. The connection between a trait and a choice flows through the parent race entry, not through the trait itself.

**Reasoning:** The builder discovers what to prompt by iterating `race.choices` directly. A `choiceRef` on the trait would be a redundant pointer that adds a synchronization burden (must stay in sync with the actual choice in the race entry) without providing structural value. Cosmetic affordances like "this trait is configurable" badges can be derived at render time by inverting the lookup. Symmetry — every choice discovered the same way regardless of whether a trait is involved — is worth more than the convenience of a back-pointer.

This decision was reversed mid-design after seeing concrete examples; the reversal is itself worth recording as a reference for future "are we adding this field for real architectural reasons or for cosmetic convenience?" decisions.

---

### Q5 — Derived mechanics on traits whose values depend on a choice

**Decision: `derivedFrom` field on traits whose mechanics are determined by a choice.**

```js
{
  "id": "breath-weapon",
  "description": "...",
  "derivedFrom": "dragonborn-ancestry"
}
```

**Reasoning:** When a trait's full meaning depends on a choice the user made, the data should declare that dependency rather than relying on builder code to know it. The builder becomes generic: it follows the pointer to find the chosen value and looks up the derived fields from the relevant content file. This pattern extends to any future "trait whose content depends on a choice" — Warlock pact features, Sorcerer bloodline traits, etc. Hardcoding the derivation in JavaScript would block clean extension.

---

## Per-Category Design: Dragonborn (Full)

### races.json — Dragonborn entry

```js
{
  "id": "dragonborn",
  "kind": "race",
  "name": "Dragonborn",
  "source": "srd-5.1",
  "size": "Medium",
  "speed": 30,
  "abilityScoreIncreases": [
    { "ability": "str", "bonus": 2 },
    { "ability": "cha", "bonus": 1 }
  ],
  "traits": ["draconic-ancestry", "breath-weapon", "damage-resistance"],
  "languages": ["common", "draconic"],
  "subraceIds": [],
  "choices": [
    {
      "id": "dragonborn-ancestry",
      "kind": "ancestry",
      "count": 1,
      "from": { "type": "list", "source": "draconic-ancestries" },
      "source": "race:dragonborn"
    }
  ],
  "lore": { /* age, alignment, sizeDescription, languageDesc — unchanged */ }
}
```

What's not changing from the current shape: size, speed, ASIs, trait ids, languages, subraceIds, lore. Those remain as-is. The only addition is the `choices` array. This is a strictly additive schema change — old anchor tests keep passing, new anchor tests get added for the new field.

### traits.json — relevant entries (purely descriptive, per Q4)

```js
{
  "id": "draconic-ancestry",
  "name": "Draconic Ancestry",
  "source": "srd-5.1",
  "description": "You have draconic ancestry. Choose one type of dragon from the Draconic Ancestry table..."
},
{
  "id": "breath-weapon",
  "name": "Breath Weapon",
  "source": "srd-5.1",
  "description": "You can use your action to exhale destructive energy...",
  "derivedFrom": "dragonborn-ancestry"
},
{
  "id": "damage-resistance",
  "name": "Damage Resistance",
  "source": "srd-5.1",
  "description": "You have resistance to the damage type associated with your draconic ancestry.",
  "derivedFrom": "dragonborn-ancestry"
}
```

`draconic-ancestry` is purely descriptive — no `choiceRef`, no pointer. The trait _describes itself_. The choice it implies is owned by the race entry.

`breath-weapon` and `damage-resistance` carry `derivedFrom` because their displayed mechanics depend on the chosen ancestry.

### draconic-ancestries.json — new file

Each ancestry record:

```js
{
  "id": "red",
  "name": "Red",
  "source": "srd-5.1",
  "category": "chromatic",
  "damageType": "fire",
  "breathWeapon": {
    "shape": "cone",
    "size": 15,
    "save": "dex"
  },
  "description": "..."
}
```

All ten ancestries (black, blue, brass, bronze, copper, gold, green, red, silver, white) get entries. Verified against SRD 5.1 PDF table.

**Anchor-tested fields per ancestry:**

- `damageType`
- `breathWeapon.shape` (`line` or `cone`)
- `breathWeapon.size` (5 or 15)
- `breathWeapon.save` (`dex` or `con`)
- `category` (`chromatic` or `metallic`)

**Not anchor-tested:**

- `description` text
- `name` (trivially derivable from id)

### Builder flow

When the user picks Dragonborn, the wizard:

1. Looks up `race.choices`. Finds one choice: `dragonborn-ancestry`.
2. Renders a "Pick your Draconic Ancestry" picker, with options pulled from `draconic-ancestries.json` (per `from.source`).
3. User picks `red`. Stored as `build.choicesByLevel["1"]["dragonborn-ancestry"] = "red"`.
4. When rendering trait cards, looks up the three traits. For `breath-weapon` and `damage-resistance`, sees `derivedFrom: "dragonborn-ancestry"`, looks up the user's chosen value, and pulls the derived fields (fire damage, 15-foot cone, Dex save, fire resistance) from the ancestry record into the rendered card.

Notice: the same `race.choices` iteration handles every choice, regardless of whether a trait is involved. Human's "extra language" choice flows through identical builder code; it just resolves to a language picker instead of an ancestry picker.

### Anchor test (illustrative)

```js
describe("SRD anchor — Dragonborn", () => {
  it("grants a one-pick ancestry choice from the ancestries file", () => {
    const db = racesById("dragonborn");
    const choice = db.choices.find(c => c.id === "dragonborn-ancestry");

    expect(choice.kind).toBe("ancestry");
    expect(choice.count).toBe(1);
    expect(choice.from).toEqual({
      type: "list",
      source: "draconic-ancestries"
    });
  });
});

describe("SRD anchor — Draconic Ancestries (Red)", () => {
  it("has the damage type, shape, size, and save stated in SRD 5.1", () => {
    const red = ancestriesById("red");
    expect(red.damageType).toBe("fire");
    expect(red.breathWeapon.shape).toBe("cone");
    expect(red.breathWeapon.size).toBe(15);
    expect(red.breathWeapon.save).toBe("dex");
    expect(red.category).toBe("chromatic");
  });
});
```

One anchor test per distinct ancestry pattern at minimum (e.g. Red for chromatic-cone-dex, Green for chromatic-cone-con, Black for chromatic-line-dex, Gold for metallic-cone-dex). Covering all ten is fine but not required — pick enough to cover the variation.

---

## Per-Category Design: Wizard, Evocation, Acolyte (Placeholder)

These are part of the vertical slice but are not detailed here. The schema concepts that must extend to them:

- **Wizard** will exercise: `choicesByLevel` (spell choices at each level), a progression table (cantrips/spells known, spell slots, prepared spells count), subclass selection at a gated level, Arcane Recovery as a level-derived resource. The `choice` shape and normalization discipline must extend without modification.
- **School of Evocation** will exercise: subclass feature progression by level, Sculpt Spells mechanic. The subclass file shape will need design.
- **Acolyte** will exercise: multi-selection with constraint (`count: 2` languages from "any"), skill grants (fixed, not choices), feature text. Should be the simplest of the three.

These get their own design passes after Dragonborn is implemented and this design is proven in practice.

---

## Referential Integrity

### The test

A single test that walks every id-shaped field across all `game-data/srd/*.json` files and validates that each reference resolves to a real record.

Pseudocode:

```Pseudocode
load all *.json files from game-data/srd/
build an index: { [fileKind]: Set<id> }

for each race in races.json:
  for each traitId in race.traits:
    assert traitId exists in index["traits"]
  for each languageId in race.languages:
    assert languageId exists in index["languages"]
  for each choice in race.choices:
    if choice.from.type === "list" && choice.from.source:
      assert choice.from.source exists as a known content file
    if choice.from.type === "list" && choice.from.options:
      for each optionId in choice.from.options:
        assert optionId exists in the file mapped from choice.kind

for each trait in traits.json:
  if trait.derivedFrom:
    assert at least one race or class entry has a choice with that id

assert all ids across all *.json content files are globally unique
  (per Q1's bare-ids-with-uniqueness rule)
```

### Why this is worth building

The cost of one broken id reference in production is: a builder dropdown shows a blank label, a character sheet fails to render, or worse, the app crashes on a specific race+class combination. These bugs sit undiscovered because they only fire under specific content selections. A referential integrity test catches them the moment a bad id gets introduced.

Cost of writing the test: one afternoon, once. Probably extending over time as new `kind` vocabulary appears. Worth it.

### Placement

`tests/data/referential-integrity.test.js`. Runs as part of the normal `npm run test:run` suite.

---

## Anchor Test Strategy (Recap)

- **Assert the strongest true claim**, not the most specific one. Use `toContain`, `new Set()` equality, and sorted-array comparison to avoid brittle order-sensitive assertions.
- **Anchor mechanics, not text.** Size, speed, ASIs, trait ids, languages, ancestry fields (damageType, breathWeapon.shape/size/save, category), choice shape — anchored. Descriptions, lore, age/alignment flavor text — NOT.
- **Never "fix" a failing anchor test by updating expected values to match the data.** A failing anchor means investigate: is the PDF saying one thing and the JSON another? Is the adapter dropping a field? Pick the right thing to fix, then update the test if needed.
- **The PDF is the source of truth for anchor values.** Not the adapter output. Not the API response. Not anyone's recollection. Always go back to `docs/reference/SRD_OGL_v5.1.pdf`.

---

## Initial Dragonborn Vertical Slice Sequence

The design is ratified. This is the first implementation slice selected to prove the
build-time choice schema through real generated SRD data. `docs/plans/lore-ledger-builder-plan.md`
tracks this sequence as Phase 1; this design record preserves the rationale for why this
slice comes first.

1. Update `racesAdapter.js` to populate the `choices` field on races from `raw.language_options` (for races like Human) and to hardcode the ancestry choice for Dragonborn (since it isn't in the API's race endpoint directly).
2. Build `draconicAncestriesAdapter.js` — new adapter pulling from `/api/2014/traits/draconic-ancestry` (or similar endpoint), extracting the ancestry table, producing normalized records. Every field verified against the SRD PDF table.
3. Build `traitsAdapter.js` — new adapter pulling from `/api/2014/traits/*`, including `derivedFrom` on the appropriate traits.
4. Regenerate all affected JSON files.
5. Write anchor tests per the strategy above.
6. Write the referential integrity test.
7. Run full test suite; confirm green.
8. Commit.

This is the intended first vertical slice before broader SRD expansion. If the active
builder plan diverges from this sequence, resolve the disagreement explicitly before
implementation.

---

## Where These Decisions Are Canonical Now

The decisions in this document have been absorbed into tracked project files. This design record stays in `docs/design/vertical-slice-schema.md` as the rationale for why the current rules were chosen.

### `docs/reference/content-registry-plan.md`

This is the canonical schema/rules document for shipped builtin registry content. It now defines:

- the build-time `choice` shape
- choice `from` types
- the closed `kind` vocabulary
- inline choice placement on parent entries
- trait field rules, including `derivedFrom` and the explicit absence of `choiceRef`
- bare global ID uniqueness across `game-data/srd/*.json`
- referential integrity expectations
- the planned `game-data/srd/draconic-ancestries.json` registry file and structured `breathWeapon` shape

### `AGENTS.md`

This is the canonical contributor and coding-agent rules document. It now records the practical rules for:

- adapter-owned SRD JSON generation
- inline `choices` on parent race/class/background/subclass entries
- traits staying descriptive and never carrying `choiceRef`
- the closed build-time choice `kind` vocabulary
- globally unique SRD content IDs
- referential integrity testing as a quality gate
- anchor tests covering mechanics rather than text

### `docs/reference/srd-licensing-notes.md`

The licensing posture is unaffected by this design. SRD source and attribution rules remain governed there.

Reference docs are the single source of truth for what the rules _are_; this file remains the design record for _why they are what they are_.

---

_End of ratified design record._
