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
2. Race choices — required race-specific build choices; Dragonborn routes through this step for Draconic Ancestry selection; non-Dragonborn races skip this step until their choices are implemented
3. Class choices — required class/subclass/proficiency/spell choices once data supports them
4. Background choices — required background choices once data supports them
5. Ability scores — Manual, Standard Array, Point Buy, and Roll through wizard-local draft state
6. Equipment — only after the equipment slice exists
7. Summary — review before finishing

NOTE: Ability-score methods were implemented before the full choice flow as an isolated Phase 2B slice. The intended and current final wizard order places ability scores after identity and supported race/class/background choices. As of Phase 3A, Dragonborn characters route through Race Choices before Ability Scores; other races proceed directly from Identity to Ability Scores until their choices are implemented.

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
- Ability-score methods collect base scores only. The Ability Scores step previews race bonuses and final derived totals from local rules data when available; race bonuses are derived and are not materialized into `build.abilities.base`.
- Added tests for validation, disabled states, assignment uniqueness, point-buy cost rules, and roll-pool assignment before widening the UI.

Summary review scope:

- Shows the final derived preview before Finish.
- Includes an editable character name field on Summary as a final review convenience.
- The Summary name field updates the same draft character name used by Identity, not a separate copy.
- Finishing the wizard must still produce a character whose name can be edited later through the normal character sheet flow.

Choice preview rule:

- Builder choice steps should show a read-only selected-option preview before Continue when the selected option has meaningful explanation or mechanical impact available from local SRD/generated data.
- The preview is explanatory UI only. It should come from canonical rules data and domain derivation where possible, and must not duplicate mechanics calculations in UI-only code.
- The preview must not duplicate derived values into persisted flat character fields or create a second source of truth.
- Stored choices remain normalized IDs in `build.choicesByLevel`; preview labels and mechanics are resolved from those IDs at render time.
- Dragonborn Draconic Ancestry is the first concrete example of this pattern, not a Dragonborn-only rule.

Completed:

- Phase 2A established and polished the builder wizard shell using existing modal/dropdown patterns.
- Phase 2B completed all ability-score entry methods: Manual, Standard Array, Point Buy, and Roll.
- Identity now requires race, class, and background before progression.
- Builder-created characters are fixed at level 1 for this phase.
- Ability-score methods remain wizard-local draft state and persist only final `build.abilities.base` scores.
- The Ability Scores step previews race ability bonuses and derived totals, while keeping `build.abilities.base` as base scores only.
- Roll supports duplicate numeric results by tracking rolled score instances rather than score values alone.
- The final wizard order places ability scores after identity and supported race/class/background choices. As of Phase 3A, Dragonborn characters route through Race Choices between Identity and Ability Scores; non-Dragonborn characters proceed directly from Identity to Ability Scores until their race choices are implemented.

---

## Phase 3: Choice Expansion

Goal: expand beyond minimal identity and abilities once Phase 1 proves the registry path.

### Phase 3A: Dragonborn Draconic Ancestry Choice — COMPLETE

Completed April 27, 2026.

- Added a Race Choices step to the wizard that routes between Identity and Ability Scores for races that require build-time choices.
- Dragonborn routes through Race Choices before Ability Scores. Non-Dragonborn races skip Race Choices until their choices are implemented.
- The Race Choices step presents a Draconic Ancestry picker populated from `draconic-ancestries.json` through a narrow runtime registry bridge.
- The Race Choices step previews the selected ancestry's derived breath weapon and resistance before the user continues, following the general selected-option preview rule for rules-backed choices.
- The selected ancestry persists as `build.choicesByLevel["1"]["dragonborn-ancestry"] = "<ancestry-id>"`, where the value is the bare ancestry id (e.g. `"red"`).
- Changing away from Dragonborn clears stale ancestry draft state.
- Summary displays the selected ancestry label.
- The registry bridge preserves existing saved builder ID compatibility and does not broadly convert saved IDs.
- No schema migration, adapter regeneration, or generated JSON edits were introduced.

Completed by Phase 3B:

- Breath Weapon derivation from the chosen ancestry
- Damage Resistance derivation from the chosen ancestry

### Phase 3B: Dragonborn Trait Derivation — COMPLETE

Goal: derive Breath Weapon and Damage Resistance mechanics from the chosen Draconic Ancestry.

Completed April 27, 2026.

- `deriveCharacter(...)` reads `build.choicesByLevel["1"]["dragonborn-ancestry"]` and resolves the chosen ancestry record through the builtin registry/rules data.
- Derived Dragonborn ancestry mechanics now include damage resistance, breath weapon damage type, breath weapon area/shape, save ability, save DC, and damage dice scaling.
- Breath Weapon save DC is derived as `8 + Constitution modifier + proficiency bonus`.
- Breath Weapon damage dice scale by builder level: `2d6` before level 6, `3d6` from level 6, `4d6` from level 11, and `5d6` from level 16.
- Builder Summary displays the selected ancestry mechanics as the current temporary builder-specific surface for this vertical slice.
- Derived table-use values should also surface in the practical panel where players need them, not only in Builder Summary. Dragonborn Breath Weapon DC appears in Vitals when derivable; future class-derived resources, such as Sorcery Points, should follow the same derived/read-only pattern until editable tracking is intentionally implemented.
- The persisted builder record still stores only the normalized ancestry choice ID. Derived ancestry mechanics are not copied into flat character fields or persisted as duplicate builder fields.
- Freeform characters remain unchanged.
- Derivation and Summary rendering tests cover the Dragonborn vertical slice before expanding the same pattern to other races or traits.

Still deferred beyond Phase 3B:

- Action tracking, uses/rest tracking, rest recharge, and combat automation for Breath Weapon.

### Phase 3C: Abilities & Features Panel Foundation — FOUNDATION COMPLETE

Goal: add the normal character-page home for special rule-backed abilities and feature actions that do not fit cleanly into Weapons, Spells, Vitals, or simple resource trackers.

Completed April 27, 2026.

Phase 3C foundation complete: derived Dragonborn Breath Weapon now renders as the first display-only Abilities & Features card. Visual polish, manual/freeform feature cards, use tracking, rest recovery, and broader feature coverage remain future work.

Shipped foundation scope:

- Added a normal character-page panel named "Abilities & Features" as the shared normal-sheet surface for special rule-backed abilities and feature actions.
- Dragonborn builder characters with a selected Draconic Ancestry now render Breath Weapon as a derived, display-only Abilities & Features card.
- The card is derived from existing builder/rules data and the persisted ancestry choice ID.
- Breath Weapon is not persisted into Weapons, Spells, Equipment, or flat character fields.
- Vitals still shows Breath Weapon DC as a derived combat stat when derivable.
- Freeform characters remain unchanged for this slice.
- No use tracking, rest buttons, reset logic, manual feature editor, custom feature cards, or broader class-feature system shipped in this foundation slice.

Long-term model:

- Builder characters can receive derived feature cards from rules/build choices.
- Freeform characters should eventually be able to create manual feature cards.
- Builder-derived and freeform/manual cards should render through the same Abilities & Features panel UI.
- Builder-derived cards should not be duplicated into manual/freeform card state unless a later explicit copy, customize, or override behavior is designed.

Surface ownership:

- Vitals owns compact derived stats and canonical resource counters. Breath Weapon DC can appear in Vitals as a derived combat stat. Sorcery Points, Luck/Inspiration points, Ki, and similar pools should be tracked once in Vitals/resource trackers when tracking exists.
- Weapons owns normal weapon/equipment attacks. Do not put Breath Weapon or similar feature actions into Weapons unless they are actually normal weapon/equipment attacks.
- Spells owns actual spells. Do not put Breath Weapon or similar feature actions into Spells just because they have DCs, damage, descriptions, or limited uses.
- Abilities & Features owns the structured "how this ability works" display: activation, source, save type, DC, area/range, damage, damage type, recovery, cost, and rules description.
- Rest buttons should live near the character page menu button as character-level actions, not inside Abilities & Features.

Resource ownership:

- Resources must not be tracked in multiple places.
- A resource has one canonical counter.
- Feature cards may reference, spend, restore, or explain that resource, but they must not duplicate resource state.
- Short Rest and Long Rest should eventually apply recovery rules across all relevant systems from the character-level action path.
- Complex features/resources may later need specialized cards or renderers. For example, Sorcery Points plus Metamagic plus Flexible Casting may need a specialized UI. Even specialized UIs must read/write the same canonical resource counter.

Future Abilities & Features work:

- Visual/card polish for Abilities & Features cards.
- Freeform/manual Abilities & Features cards.
- User-created/custom feature cards.
- Use tracking for limited-use features.
- Short Rest and Long Rest toolbar actions.
- Rest/recovery rules across resources and feature uses.
- Specialized resource-linked feature cards later, such as Sorcery Points, Metamagic, and Flexible Casting.

### Derived Resources and Derived Combat Stats Pattern

Derived table-use values should appear in the normal character sheet panel where users need them during play. Builder Summary can collect and explain builder-derived mechanics, but it must not be the only place users can find values they need at the table.

Current example:

- Dragonborn Breath Weapon DC is derivable from ancestry, Constitution modifier, and proficiency bonus, so Vitals is the appropriate normal-sheet home for that combat DC.
- Dragonborn Breath Weapon's full action-style mechanics now render as the first derived, display-only Abilities & Features card, not in Spells or Weapons.

Future examples may include class-derived resources such as Sorcery Points or similar level/class features. These values should be derived and read-only first. Do not persist them into flat/freeform fields unless a later explicit tracking or editing slice intentionally adds that behavior.

### Temporary Builder-Only Panel Retirement Direction

Builder-only panels are temporary scaffolding, not the long-term sheet model. Over time, builder and freeform characters should use the same visible character sheet panels:

- Builder characters populate normal panels through derivation and intentional overrides.
- Freeform characters continue using manual fields.
- Before any builder-only panel is removed, every useful piece of information it shows must already have a clear home in the normal panel structure.

### Remaining Phase 3 Work Items

Applicable to future choice expansion beyond Dragonborn:

- Add picker UI for supported build-time choices as races and classes gain choice data.
- Keep choice kinds aligned with the closed set in the registry plan.
- Derive sheet-facing values from build choices and registry data.
- Avoid materializing derived fields into persisted character fields unless a later phase
  explicitly requires it.
- Add tests for derivation behavior before widening the content set.
- Expand race ability bonus previews as additional race/subrace choice data becomes supported.

Examples of likely future choice areas:

- Languages
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
