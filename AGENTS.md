# AGENTS.md

## Purpose

This file tells coding agents how to work safely in the Lore Ledger / CampaignTracker repo, especially for the SRD-backed character builder work.

It exists to reduce ambiguity, prevent scope drift, and keep implementation aligned with the project's architecture and documentation.

---

## Project Priorities

Lore Ledger is intended to be:

- stable
- thoughtful
- architecturally clean
- boringly reliable
- well-documented
- polished

Do not optimize for speed at the expense of data safety, architectural clarity, or maintainability.

---

## Current Builder Source of Truth

For builder-related builtin content:

- **Active source:** `SRD 5.1`
- **Retired:** `SRD 5.2.1` (data deleted from game-data/srd/)

Use SRD 5.1 terminology and content policy for all builder implementation work.

Do not use SRD 5.2.1 as a source for any builtin content. It has been retired.

---

## Authoritative Builder Files

When working on the builder, read these files first:

1. `docs/reference/srd-licensing-notes.md`
2. `docs/reference/builder-scope-greenlist.md`
3. `docs/reference/content-registry-plan.md`
4. `game-data/srd/*.json`

Interpretation order:

- licensing notes define the source posture
- greenlist defines what is allowed to ship as builtin
- content registry plan defines how approved content should be modeled
- JSON files contain the actual implementation data

If a requested change conflicts with those files, update the docs intentionally instead of silently improvising.

---

## Builtin vs Custom Content Rule

Lore Ledger uses a strict separation between:

- **builtin content**: content that ships with the app
- **custom content**: user-created or user-added content

Default rule:

> If content is not explicitly greenlit and modeled in project data, treat it as custom content.

Do not silently promote custom or unclear content into shipped builtin data.

---

## Current Greenlit Builtin Builder Scope

The current intended shipped builtin builder scope includes:

- races
- classes
- backgrounds
- subclasses
- feats
- armor
- weapons
- spellcasting progression metadata
- automatically granted builtin spells

The current deferred categories include:

- full builtin spell registry support for all spell selection flows
- magic items
- monster data

Important spell rule:

- the existing spells panel remains the main manual-entry UI for user-managed spells
- the builder may derive spellcasting progression data such as caster status, spellcasting ability, spell level access, and spell slot counts
- the builder may surface automatically granted spells or cantrips from builtin races, classes, subclasses, feats, or similar builder-backed content
- do not treat this as a commitment to a full builtin spell compendium or fully builder-managed spellbook workflow

---

## Content Registry Rules

When working with `game-data/srd/*.json`:

- use stable lowercase underscore-separated IDs
- use explicit `kind` fields
- use explicit `source` fields (`"srd-5.1"` for current shipped builtin SRD data)
- prefer structured fields over prose blobs
- do not hardcode registry facts in UI modules when they belong in data files
- keep record shapes aligned with `docs/reference/content-registry-plan.md`

If you introduce a new category shape or cross-record convention, update the registry plan doc too.

---

## Character Builder Architecture Rules

The builder must remain compatible with the project's existing architecture.

### 1. Freeform and builder modes must remain distinct

If `build` is null, the character remains freeform/manual.

If `build` is present, builder-derived logic applies.

Do not collapse freeform and builder modes together.

### 2. Canonical data must have one source of truth

Do not introduce duplicate sync stores for character data.

Builder panels, character panels, and combat embedded panels must continue reading canonical character state rather than maintaining parallel copies.

### 3. Do not materialize derived data casually

Do not persist derived fields back into flat character fields unless the current phase explicitly calls for it.

Prefer derivation from build choices and registry data over writing computed values into storage prematurely.

### 4. Keep UI state out of domain data

Do not store modal-open flags, picker expansion state, or similar UI-only state inside builder domain records.

### 5. Migrations are mandatory for storage shape changes

Any persisted shape change must be handled through the existing versioned migration system and be covered by tests.

---

## Documentation Discipline

When changing builder behavior, registry data shape, or shipped builtin scope:

- update the relevant docs in `docs/reference/`
- keep roadmap and architecture documentation aligned with reality
- do not leave docs describing a state that no longer exists

Minimum expectation:

- if you change policy, update policy docs
- if you change schema, update schema docs
- if you change shipped scope, update the greenlist

---

## Testing Expectations

Builder-related changes should preserve the project's quality bar.

When relevant, update or add:

- unit tests
- migration tests
- derivation tests
- panel behavior tests

Do not rely on manual clicking alone for builder logic changes.

---

## Implementation Style Rules

Prefer:

- small, bounded changes
- explicit data modeling
- pure helpers for derivation logic
- reuse of existing project patterns
- minimal-scope edits that preserve current architecture

Avoid:

- broad refactors unrelated to the requested task
- burying rules in UI code
- introducing duplicate state just to make one panel easier
- adding content that is not clearly approved
- inventing undocumented source rules

---

## When Unsure

If you are unsure whether content is allowed, modeled correctly, or in current scope:

1. check `srd-licensing-notes.md`
2. check `builder-scope-greenlist.md`
3. check `content-registry-plan.md`
4. prefer the conservative interpretation

When in doubt, do not ship it as builtin.

---

## SRD Data Fetch Pipeline

`game-data/srd/*.json` files are produced by running adapter scripts — they are **not hand-edited**.

The pipeline is:

```
scripts/fetch-srd-data.js    ← orchestrator
scripts/adapters/
  racesAdapter.js            ← produces races.json
  classesAdapter.js          ← produces classes.json
  backgroundsAdapter.js
  equipmentAdapter.js
  spellsAdapter.js
  ... etc
```

These scripts fetch from `dnd5eapi.co` during development and transform the results into the repo's structured JSON format. The JSON files are then committed and shipped with the app — there are no runtime API calls.

**Rule for coding agents:** If the content in a `game-data/srd/*.json` file needs to change, edit the relevant adapter script in `scripts/adapters/` and re-run it. Do not edit the JSON files directly. Direct edits will be overwritten the next time the adapter runs.

---

## Practical Working Rule

For Lore Ledger builder work:

> Use SRD 5.1 as the active builtin source. SRD 5.2.1 is retired. Content kind for race is "race" not "species". Source field value is "srd-5.1". Treat ungreenlit content as custom. Keep implementation data-driven, migration-safe, and architecture-aligned.
