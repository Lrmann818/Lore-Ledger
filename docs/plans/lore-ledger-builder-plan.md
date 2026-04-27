# Lore Ledger — Character Builder Implementation Plan

Drafted: April 20, 2026  
Last updated: April 27, 2026

---

## Purpose

This document tracks the builder-specific implementation sequence. It is not the canonical
schema reference and should not duplicate the complete registry model.

Canonical references:

- `docs/reference/srd-licensing-notes.md` — SRD source and attribution posture
- `docs/reference/builder-scope-greenlist.md` — shipped builtin content scope
- `docs/reference/content-registry-plan.md` — canonical registry/schema rules
- `docs/design/vertical-slice-schema.md` — design rationale for the build-time choices schema and vertical-slice-first SRD registry strategy
- `game-data/srd/*.json` — committed generated builtin data

---

## Current Direction

SRD 5.1 is the active builtin source. SRD 5.2.1 is retired and must not be used as a
source for shipped builder content.

The implementation strategy is vertical-slice-first:

1. Prove one complete SRD data path from development-time adapter output.
2. Validate the generated registry records and cross-record references.
3. Consume that data in the builder UI/domain path.
4. Expand category coverage only after the first slice is working and test-backed.

This is intentionally not a "populate every SRD category at once" project.
The rationale for this strategy is recorded in `docs/design/vertical-slice-schema.md`.

---

## Completed Phase 0: Branch Cleanup

Phase 0 cleanup is complete on the Refactoring branch. It established the current builder
direction and removed the stale SRD 5.2.1/species terminology path.

Completed outcomes:

- SRD 5.1 is documented as the active builtin source.
- SRD 5.2.1 is documented as retired.
- Builder terminology uses race, not species.
- Builder source values use `srd-5.1`.
- The branch policy now describes the SRD data fetch pipeline.
- The canonical registry/schema rules now live in `docs/reference/content-registry-plan.md`.
- Design rationale is tracked separately in `docs/design/vertical-slice-schema.md` instead
  of being treated as the public implementation plan.

Do not treat Phase 0 as current work. Future builder work starts from the vertical slice
below.

---

## Data Pipeline Model

Runtime behavior:

```text
game-data/srd/*.json
        ↓
js/domain/rules/registry.js
        ↓
builder derivation helpers and panels
        ↓
character sheet and combat embedded views
```

Development-time generation:

```text
dnd5eapi.co SRD 5.1 data + SRD 5.1 reference material
        ↓
scripts/fetch-srd-data.js + scripts/adapters/*
        ↓
game-data/srd/*.json committed to the repo
```

There are no runtime SRD API calls. The app ships the committed JSON and remains
offline-capable.

Schema details, closed vocabularies, ID rules, source fields, choice shapes, and
cross-record conventions belong in `docs/reference/content-registry-plan.md`.

---

## Phase 1: Dragonborn Vertical-Slice SRD Registry Pipeline

Goal: ship the smallest complete data slice that proves the full path from adapter output
to builder consumption.

The active first implementation slice is the Dragonborn race-choice path described in
`docs/design/vertical-slice-schema.md#initial-dragonborn-vertical-slice-sequence`. That
sequence is the concrete Phase 1 plan; this document owns the implementation tracking,
while the design record explains why this slice proves the schema.

Phase 1 sequence status, last verified April 25, 2026:

- [x] Update `racesAdapter.js` to populate the `choices` field on races from
   `raw.language_options` for races like Human and to hardcode the ancestry choice for
   Dragonborn because the API race endpoint does not expose it directly.
- [x] Build `draconicAncestriesAdapter.js` to pull from the SRD API trait endpoint for
   Draconic Ancestry, extract the ancestry table, and produce normalized records in
   `game-data/srd/draconic-ancestries.json`. Verify every mechanical field against the
   SRD 5.1 PDF table.
- [x] Build `traitsAdapter.js` to pull SRD trait records and include `derivedFrom` on traits
   whose mechanics depend on the Dragonborn ancestry choice.
- [x] Regenerate all affected `game-data/srd/*.json` files through the adapter pipeline.
- [x] Write anchor tests for the generated Dragonborn race choice, draconic ancestry records,
   and trait derivation fields using the strategy in `docs/design/vertical-slice-schema.md`.
- [x] Write the referential integrity test for cross-record IDs, choice sources, choice
   options, globally unique IDs, and `derivedFrom` references.
- [x] Run the full applicable verification suite and confirm green.
- [x] Commit the completed Phase 1 vertical slice.

Expected first-slice content should be representative, not exhaustive. It should include
Dragonborn, Human language-choice coverage, supporting traits, supporting languages, and
dragonborn ancestry records where needed to validate the model. Do not broaden Phase 1
into full race/class/background coverage before this slice is proven.

Completion criteria:

- Generated JSON follows `docs/reference/content-registry-plan.md`.
- The slice is created through adapter code.
- Cross-record references are covered by tests where they exist.
- Builder UI/domain code can read the generated records without hardcoded registry facts.
- No storage migration is introduced unless a persisted shape actually changes.

---

## Phase 2: Builder Wizard Shell

Goal: turn the existing builder panels into a guided creation flow without changing the
underlying character storage model.

Work items:

- Add a wizard overlay using the existing dialog/modal patterns.
- Reuse current builder identity, abilities, and summary behavior where practical.
- Preserve the freeform vs builder distinction: `build === null` remains manual/freeform.
- Keep builder inputs as canonical choices, not duplicated sheet data.
- Mark user-visible state changes dirty through the existing save lifecycle.
- Reuse Lore Ledger's existing custom dropdown/select pattern for wizard pickers if it is already accessible, mobile-safe, and reusable.
- Do not introduce a second custom dropdown implementation for the wizard.
- If the existing dropdown pattern is tightly coupled to another panel, extract a shared helper/component before using it in the wizard.
- Native selects are acceptable as a fallback only if reuse would expand Phase 2A beyond polish scope.
- Treat ability-score entry methods as wizard-local draft state until Finish, then persist only the canonical builder ability base scores.
- Allow the character name to be edited during final review, while preserving normal post-creation name editing in the character sheet.

Initial step order:

1. Identity — name, race, class, background, fixed starting level 1
2. Race choices — required race-specific build choices once data supports them
3. Class choices — required class/subclass/proficiency/spell choices once data supports them
4. Background choices — required background choices once data supports them
5. Ability scores — Manual, Standard Array, Point Buy, and Roll through wizard-local draft state
6. Equipment — only after the equipment slice exists
7. Summary — review before finishing

NOTE: Ability-score methods were implemented before the full choice flow as an isolated Phase 2B slice, but the final wizard order should place ability scores after identity and supported race/class/background choices so users can assign scores with better context.

Phase 2A polish scope:

- CSS-only or near-CSS-only visual polish for the existing wizard shell.
- Wizard pickers should use Lore Ledger's existing custom dropdown/select pattern when practical, so the wizard matches app-wide picker styling and behavior.
- Do not build a new wizard-only custom dropdown; reuse or extract the existing app dropdown pattern instead.
- Before reuse, verify keyboard navigation, focus behavior, screen-reader semantics, escape handling, outside-click behavior, and mobile behavior still work inside the wizard modal.
- Improve spacing, mobile layout, and review readability without changing persisted character shape.

Phase 2B ability-score method scope:

- Added a method selector for Manual, Standard Array, Point Buy, and Roll.
- Manual uses six numeric fields constrained to 1–20.
- Standard Array exposes the pool `15, 14, 13, 12, 10, 8` and prevents duplicate assignment.
- Point Buy starts all scores at 8, shows remaining points clearly, and disables invalid increases/decreases.
- Roll supports `3d6` and `4d6 drop lowest`, generates a rolled pool, and assigns rolled values to abilities.
- Kept method-specific intermediate values in wizard-local draft state; persist only the final ability base scores used by builder derivation.
- Added tests for validation, disabled states, assignment uniqueness, point-buy cost rules, and roll-pool assignment before widening the UI.

Summary review scope:

- Shows the final derived preview before Finish.
- Includes an editable character name field on Summary as a final review convenience.
- The Summary name field updates the same draft character name used by Identity, not a separate copy.
- Finishing the wizard must still produce a character whose name can be edited later through the normal character sheet flow.

Completed:

- Phase 2A established and polished the builder wizard shell using existing modal/dropdown patterns.
- Phase 2B completed all ability-score entry methods: Manual, Standard Array, Point Buy, and Roll.
- Identity now requires race, class, and background before progression.
- Builder-created characters are fixed at level 1 for this phase.
- Ability-score methods remain wizard-local draft state and persist only final `build.abilities.base` scores.
- Roll supports duplicate numeric results by tracking rolled score instances rather than score values alone.
- The final wizard order should place ability scores after supported race/class/background choices, even though ability-score methods were implemented first as an isolated slice.

---

## Phase 3: Choice Expansion

Goal: expand beyond minimal identity and abilities once Phase 1 proves the registry path.

Work items:

- Add picker UI for supported build-time choices.
- Keep choice kinds aligned with the closed set in the registry plan.
- Derive sheet-facing values from build choices and registry data.
- Avoid materializing derived fields into persisted character fields unless a later phase
  explicitly requires it.
- Add tests for derivation behavior before widening the content set.
- Add race ability bonus previews to the Ability Scores step once racial modifiers are derived.

Examples of likely choice areas:

- Languages
- Ancestry selections
- Skills
- Automatically granted cantrips or spells where greenlit

---

## Phase 4: Equipment and Inventory Integration

Goal: support starting equipment choices without destabilizing the existing equipment UI.

Work items:

- Generate the first equipment slice through adapters.
- Model starting equipment choices in data rather than hardcoding them in panels.
- Resolve equipment packs into character inventory only at the appropriate creation step.
- Preserve existing manual equipment editing for post-creation changes.
- Test import/export and saved-data behavior if any persisted inventory shape changes.

---

## Phase 5: Locking, Overrides, and Polish

Goal: make builder-owned values clear and editable through intentional override paths.

Work items:

- Define which fields are builder-owned and which remain free-editable.
- Add override UI only where the derived/manual boundary is clear.
- Keep freeform characters working exactly as they do today.
- Preserve combat embedded panel behavior by reading canonical active character data.
- Add accessibility and mobile checks for wizard and picker flows.
- Add in-app SRD attribution/credits before public release.

---

## Phase 6: Spellcasting and Rest Mechanics

Goal: derive spellcasting progression and rest-sensitive mechanics without replacing the
manual spells panel.

Work items:

- Derive spellcasting ability, caster status, spell level access, and slot counts from
  builder data.
- Surface automatically granted spells or cantrips from greenlit builtin content.
- Keep the existing spells panel as the main manual-entry UI.
- Avoid treating this phase as a full builtin spell compendium unless the greenlist and
  registry plan are intentionally expanded.
- Add short rest / long rest behavior after the relevant resources are modeled.

---

## Phase 7+: Reference and Content Expansion

Goal: widen builtin registry coverage after the vertical slices have proven the approach.

Potential work:

- Broader race/class/background/subclass coverage
- Feats within the greenlit scope
- Rules reference browser
- Monster or magic-item reference only if future scope documents allow it

Expansion rules:

- Update `docs/reference/builder-scope-greenlist.md` before changing shipped builtin scope.
- Update `docs/reference/content-registry-plan.md` before changing schema or conventions.
- Keep generated JSON adapter-owned.
- Add tests for new category relationships and derived mechanics.


## Verification Expectations

For docs-only edits to this plan, a diff and stale-phrase grep are sufficient.

For implementation work, choose verification based on risk:

- Targeted Vitest files for derivation, migration, registry, or import/export changes
- `npm run test:run` for broader behavior changes
- `npm run build` for runtime or bundling changes
- Playwright smoke coverage for wizard, navigation, modal, PWA, or mobile UI changes

Do not claim tests were run unless the commands actually ran and passed.
