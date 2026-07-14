# AGENTS.md

This file is the canonical rules document for any coding agent (Claude Code, Codex, Cursor, or other AI assistants) working in the Lore Ledger (`Lore-Ledger`) repo.

It is also the canonical rules document for human contributors making AI-assisted changes.

If you only read one file before working in this repo, read this one. `CLAUDE.md` exists as a pointer for Claude Code's auto-discovery; its content is intentionally minimal because the rules live here.

---

## Purpose

This file tells coding agents how to work safely in the Lore Ledger (`Lore-Ledger`) repo. It exists to reduce ambiguity, prevent scope drift, keep implementation aligned with the project's architecture, and protect the project's reliability and backward-compatibility commitments.

If a requested change conflicts with this file or the docs it points to, **stop and surface the conflict**. Do not silently improvise around it.

---

## Agent Doc Map

The repo has more docs than any one task needs. Read the docs for **your task**, not all of
them. Reading extra docs is not free: several of them are historical records that describe a
state of the world that no longer exists, and agents that read them tend to "helpfully"
restore obsolete behavior.

### Read for every task

| Doc | Why |
| --- | --- |
| `AGENTS.md` (this file) | The rules. Wins on all conflicts. |
| `docs/README.md` | Index of everything else, with canonical vs. historical labels. |

### Read by task type

| If your task is… | Read these, in order | Skip |
| --- | --- | --- |
| **Builder / SRD content** (registry data, wizard, rules engine) | `docs/reference/srd-licensing-notes.md` → `docs/reference/builder-scope-greenlist.md` → `docs/reference/content-registry-plan.md` → `game-data/srd/*.json` | `docs/archive/**`, `docs/design/vertical-slice-schema.md`. `character-builder-handoff.md` is an optional deep-dive, not required reading — and its §7 "next fixes" is **not** the work order. |
| **State, persistence, migration** | `docs/state-schema.md` → `js/state.js` → `docs/operations/storage-and-backups.md` | Phase-by-phase bullets at the end of the "Step 3 builder foundation" section |
| **Character architecture** (multi-character, freeform vs. builder) | "Character Architecture" below → `docs/features/multi-character-design.md` | `docs/archive/multi-character-steps-1-4.md` (historical build notes, incl. a wrong "SRD 5.1 green list") |
| **Character sheet editing surfaces** | "Editing Model" below → `docs/reference/fifth-edition-character-sheet/` (UX only) | Any doc implying builder panels are the post-creation editing surface |
| **Rest (short / long), prepared spells** | `docs/reference/rest-rules-spec.md` → `js/domain/characterRest.js` | — |
| **Architecture / module boundaries** | `docs/architecture.md` | — |
| **Release, testing, PWA** | `docs/operations/testing-guide.md` → the focused checklist it links → `docs/operations/release-process.md` | `docs/archive/**`, `docs/operations/ios-packaging.md` |
| **iOS / App Store packaging** | `docs/operations/ios-packaging.md` | The web release doc, unless you are also shipping web |
| **Levelling / level-up flow** | "Level Up Rules" below → `docs/reference/level-up-flow-spec.md` (Phases 1–3 shipped) | — |
| **Roadmap / what's next** | "Current Working Order" below → `docs/plans/new-features-roadmap.md` | `docs/archive/lore-ledger-builder-plan.md` |
| **Builder gap audit / stabilization** | "Current Working Order" below, first | `docs/audits/**` batch prompts (B1–B3 shipped 2026-07-13; the completion matrix is the live audit) |

### Canonical vs. historical

**Canonical** (describes the system as it is today; keep in sync with code):

- `AGENTS.md`, `CLAUDE.md`
- `docs/architecture.md`, `docs/state-schema.md`
- `docs/reference/srd-licensing-notes.md`, `docs/reference/attribution-requirements.md`
- `docs/reference/builder-scope-greenlist.md`, `docs/reference/content-registry-plan.md`
- `docs/reference/rest-rules-spec.md`
- `docs/reference/level-up-flow-spec.md` — canonical Level Up contract; **Phases 1–3 are implemented** (2026-07-12/13)
- `docs/operations/**`
- `docs/plans/new-features-roadmap.md`, `docs/plans/combat-workspace-plan.md`

**Historical / reference-only** (point-in-time records; do **not** treat as current state, do
not "fix" code to match them):

- `docs/archive/**` — superseded plans, audits, and commit trackers
- `docs/design/vertical-slice-schema.md` — design rationale for choices already absorbed into the canonical docs
- `docs/reference/character-builder-handoff.md` — session snapshot, optional deep-dive. Accurate at time of writing; verify before relying on. Its §7 "Top 5 safest next fixes" is **not** the work order — the Current Working Order below wins.
- `docs/archive/multi-character-steps-1-4.md` — historical Step 1-4 implementation notes; its "SRD 5.1 green list" section is **wrong** and is struck through in place
- `docs/audits/**` — planning artifacts. The gap-audit batch prompts are historical (B1–B3 shipped 2026-07-13); `builder-completion-matrix.md` is the live capability audit. Never self-start feature work from these without the working order.

**When a historical doc disagrees with a canonical doc, the canonical doc wins. When a
canonical doc disagrees with the code, the code wins — and fix the doc.**

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

## Prime Directive

**Do not break existing behavior.**

Stability, consistency, backward compatibility, saved-data safety, mobile layout, and PWA behavior are non-negotiable.

This includes preserving:

- Campaign Hub entry/return behavior
- Panel collapse/expand behavior
- Panel reordering controls
- SaveManager dirty-state and persistence
- Dropdown consistency
- Modal/focus behavior
- Mobile layout (no clipping, no horizontal scroll)
- Existing saved data loading correctly
- Backup/import/export reliability
- Installed PWA/browser behavior that already works

Prefer minimal, targeted changes over broad refactors.

---

## Hard Bans

These are non-negotiable, regardless of perceived benefit:

- No frameworks (no React, Vue, Svelte, etc.)
- No TypeScript rewrite (`@ts-check` + JSDoc + `types/*.d.ts` is the typing model)
- No storage format changes without a migration
- No feature removal
- No large CSS rewrites "for cleanliness"
- No new modal frameworks
- No duplicating canonical data just to make a view easier
- No silently swallowing errors
- No bypassing the existing dialog/popover/modal patterns

If a task seems to require breaking one of these, stop and explain. Do not proceed by inferring permission.

---

## Commands

- `npm run dev` — Start Vite dev server
- `npm run build` — Production build to `dist/`
- `npm run test` — Run Vitest in watch mode
- `npm run test:run` — Run Vitest once
- `npm run verify` — Run the full verification gate when available
- Playwright smoke tests may run in CI and must not be bypassed casually

---

## Branching Model

Lore Ledger uses a Gitflow-lite layout. Branches flow downward from production:

- `main` — production. Deploys to GitHub Pages.
- `develop` — integration/staging. Fixes accumulate and get tested here before promotion to `main`.
- Feature branches (currently `builder-wizard`) — branch off `develop`, merge back into `develop` when ready.
- Hotfix branches — branch off `main`, merge back into `main`, then `main` is merged into `develop` to keep develop current.

Day-to-day, builder work happens on `builder-wizard`.

---

## Scope Discipline (Circuit Breaker)

If a change is discovered mid-task to require touching more than ~3 files (or significantly more files than the original plan anticipated), **stop and explain what was found before continuing**.

This rule is not a planning constraint. It is a circuit breaker for scope drift mid-task. The user can always say "proceed with the larger scope" — this rule exists to surface unexpected coupling, not to forbid wide-reaching work that was intentional.

For larger changes that are planned to be wide-reaching from the start (renames, multi-file conventions, terminology passes), this rule does not apply — but the plan should be stated upfront before execution.

---

## Architecture Overview

- `app.js` — Composition root. Wires dependencies and injects them downward. Nothing imports `app.js`.
- `index.html` — Static DOM shell and persistent app structure.
- `styles.css` — Single global stylesheet. Scope changes carefully.
- `js/state.js` — Single mutable state object, schema defaults, migrations, save sanitization.
- `js/domain/stateActions.js` — Centralized state mutation helpers and prototype-pollution guards.
- `js/domain/` — Domain logic, helpers, and types not tied to a specific page.
- `js/storage/` — Persistence, backup/import/export, IndexedDB blobs/texts, save lifecycle.
- `js/pages/` — Page/workspace modules.
- `js/ui/` — Shared UI systems: dialogs, popovers, navigation, theme, topbar, modals, layout helpers.
- `js/features/` — Cross-cutting features such as autosize, cropper, portrait flow.
- `js/audio/` — App sound helpers. Must respect browser autoplay/PWA limits.
- `tests/` — Vitest unit/regression tests and Playwright smoke coverage.
- `types/` — Shared JSDoc/type boundary declarations.
- `scripts/` — Development-time scripts (e.g., SRD data fetch + adapters). Not shipped to runtime.
- `game-data/` — Shipped builtin content (e.g., `game-data/srd/*.json`).
- `docs/` — Project documentation. Subdivided by purpose.

For more detail, see `docs/architecture.md`.

---

## Current Product Shape

Lore Ledger is a Hub/campaign-first vanilla JS PWA, not a single-page tracker.

Major surfaces include:

- Campaign Hub
- Tracker workspace
- Character workspace
- Combat workspace
- Map workspace
- Data / Settings / Support modal
- Backup/import/export flows
- PWA install/offline/update behavior
- Support/debug/report-bug flows

Treat campaign data, app-level data, UI layout state, and combat/session state as separate concerns. Do not assume the app is only Tracker / Character / Map.

---

## Character Architecture

Step 1 multi-character support is complete and verified. `STEP1_TASKS.md` is a completed implementation record, not pending work.

Before modifying character architecture, character state, character panels, combat embedded character panels, backup/import/export, or campaign vault persistence, read `docs/features/multi-character-design.md`.

Do not reintroduce the legacy singleton `state.character` model. That key is valid only in migration and backward-compatibility handling for old saves/backups. Production code must use:

```js
characters: {
  activeId: string | null,
  entries: CharacterEntry[]
}
```

Active character data lives in `state.characters.entries`, selected by `state.characters.activeId`.

Panel reads must resolve the active character via `getActiveCharacter(state)`. Character writes should use state action helpers such as `mutateCharacter(...)` and `updateCharacterField(...)`.

Combat embedded Vitals, Spells, and Weapons / Attacks panels are live alternate views of canonical active character data, not snapshots. They must not introduce duplicate character data or a sync store.

---

## Core Patterns

- Use dependency injection.
- Keep modules factory-based where the repo already does so.
- Do not introduce hidden global coupling.
- Intentional globals are limited to boot/build/version metadata and DEV-only debug escape hatches.
- Mutate state through `createStateActions()` helpers or `withAllowedStateMutation()`.
- User-visible state changes must call `SaveManager.markDirty()`.
- Persisted data changes require backward-compatible migration.
- Sanitized save output must not include ephemeral UI/runtime state.
- Re-rendering means rebuilding DOM and reattaching listeners safely.
- One user action must equal one app action.

---

## State, Persistence, and Migration Rules

- Never break existing saved data.
- New data fields must be backward compatible: `obj.newField ?? defaultValue`.
- Migration changes must be append-only, defensive, and test-backed.
- Any storage-shape change needs migration coverage.
- Import/export must validate data before mutating live state.
- Backup restore must fail soft and preserve user trust.
- Campaign-scoped data must not be silently mixed with app-level settings.
- Combat/workspace layout state must not duplicate canonical campaign data.

---

## UI Contracts (Do Not Break)

### Top Bar

- Campaign title: `#campaignTitle` (contenteditable)
- Status messages: `#statusText`
- Clock: `#topbarClock`

Errors, save status, and feedback must continue to appear in `#statusText`. Do not replace this messaging system.

### Calculator and Dice

Dropdown systems:

- Calculator
  - Button: `#calcBtn`
  - Menu: `#calcMenu`
- Dice Roller
  - Button: `#diceBtn`
  - Menu: `#diceMenu`

Rules:

- These are dropdown menus, not modals.
- Do not replace dropdown logic with a new system.
- Respect `aria-expanded` and `[hidden]` toggling.

### Data / Settings / Support Modal

Modal system:

- Overlay: `#dataPanelOverlay`
- Panel: `#dataPanelPanel`

Use the existing modal/overlay behavior. Do not add new modal frameworks. Do not break focus or keyboard behavior.

### Panels

Panel identity:

```html
<section class="panel" id="...Panel">
```

Examples may include:

- `#sessionPanel`
- `#npcPanel`
- `#locationsPanel`
- `#charVitalsPanel`
- `#charSpellsPanel`

Collapse buttons:

```html
<button class="panelCollapseBtn" data-collapse-target="...">
```

Panel collapse rules:

- Collapsing removes vertical space.
- Panels below must scoot up naturally.
- Do not hide panels via `display: none` unless existing logic does.
- Preserve `aria-expanded`.
- Do not break masonry/reflow behavior.

Panel reordering rules:

- Reorder controls MUST remain available where currently supported.
- Never remove reorder buttons when touching panel markup.
- Reordering must continue to work on all reorderable workspaces.

---

## Workspace Rules

### Campaign Hub

- Hub is a first-class entry surface, not an afterthought.
- Do not treat Hub as just another normal page tab without verifying app entry behavior.
- Hub return actions must remain context-aware.
- Campaign selection/entry/return behavior must remain safe.
- Hub sound behavior must respect user settings and real browser autoplay limits.

### Tracker Workspace (`#page-tracker`)

Columns:

- `#trackerColumns`
- `#trackerCol0`
- `#trackerCol1`

Rules:

- Panels must stay inside columns.
- Do not flatten or restructure layout.

Cards:

- NPCs: `#npcCards`
- Party: `#partyCards`
- Locations: `#locCards`

Rules:

- Cards are rendered dynamically.
- Event listeners must not multiply on re-render.
- Attach listeners during element creation.

Location filtering and dropdowns:

- Filter select: `#locFilter`

Rules:

- Location card dropdowns must visually match other dropdowns.
- If only ONE dropdown needs styling, add a modifier class or data attribute and scope CSS to `.locationCard`.
- Never globally style `select`.

### Character Workspace (`#page-character`)

Columns:

- `#charColumns`
- `#charCol0`
- `#charCol1`

Rules:

- Panels must remain column-based.
- Panels must remain reorderable.

Character basics:

- `#charName`
- `#charClassLevel`
- `#charRace`
- `#charBackground`

Textareas with UI persistence:

```html
<textarea data-persist-size>
```

Rule: Do not remove or bypass `data-persist-size`.

Abilities and skills:

```html
.abilityBlock[data-ability="str|dex|con|int|wis|cha"]
```

Rules:

- Calculations must remain deterministic.
- Checkbox state must not desync values.
- Do not duplicate ability logic.

Spells:

- Container: `#spellLevels`
- Levels and spells are dynamically rendered.

Rules:

- Helper functions used by the spells UI must exist before use.
- Adding spells MUST update state, call `SaveManager.markDirty()`, and re-render safely.

### Combat Workspace (`#page-combat`)

- Combat is a dedicated workspace with its own domain state.
- Combat-specific UI state must not be shoved into unrelated data structures.
- Embedded/shared panels must operate on canonical campaign/character data.
- Do not create copied panel data that later needs manual sync.
- Workspace layout/configuration is composition state, not the underlying data itself.
- Removing an embedded panel removes the view, not the underlying data.
- Mobile layout matters heavily here: no clipping, no horizontal scroll, no unusable cramped controls.

### Map Workspace (`#page-map`)

Canvas:

- Canvas: `#mapCanvas`
- Wrapper: `.canvasWrap`

Rules:

- Do not recreate canvas unless required.
- Preserve undo/redo stacks.
- Image upload/remove must continue to work.
- Respect memory/performance constraints.

---

## JavaScript Rules

### State and persistence

- User-visible changes require `SaveManager.markDirty()`.
- New data fields must be backward compatible: `obj.newField ?? defaultValue`.
- Never break existing saved data.
- Migration changes must be append-only, defensive, and test-backed.
- Import/export must validate before mutating live state.

### Vanilla JS typing and boundaries

- This repo uses `@ts-check`, JSDoc, and `types/*.d.ts`. Not a TypeScript rewrite.
- For new shared modules or edits inside already-hardened files, preserve or add `// @ts-check` where appropriate. Keep boundary typedefs narrow.
- Reuse owner-defined types from `js/state.js`, `js/domain/*`, or nearby boundary modules instead of inventing broad anonymous object shapes.
- Keep runtime validation for persisted data, imports, files, and DOM lookups. Static types support those guards; they do not replace them.
- Do not claim repo-wide CheckJS is fully clean unless that has actually been verified in the codebase.
- Do not add `.ts` files.
- Do not change runtime behavior when the task is only type cleanup.

### Rendering and events

- Re-render means rebuild DOM + reattach listeners.
- Never attach listeners inside loops without guards.
- One click must equal one action.

### Errors

- Use the existing global error/status system.
- Fail soft.
- Do not silently swallow errors.

---

## CSS Rules

### Scope first

Prefer:

- `.panel ...`
- `.locationCard ...`
- `.npcCard ...`
- page/workspace-scoped selectors where appropriate

### Targeting a single element

Add a modifier:

- `.isVariant`
- or `data-variant="x"`

Then style narrowly.

### Avoid

- Global `select {}` rules
- Deep specificity chains
- CSS fixes dumped at the bottom without context
- Large CSS rewrites "for cleanliness"

### Mobile requirements

After any UI change:

- no clipped headers
- no horizontal scrolling
- no hidden critical controls
- tap targets stay usable

---

## Accessibility Minimums

- Buttons must have `type="button"` unless submitting a form.
- Inputs must remain focusable.
- Do not remove focus outlines without replacement.
- `aria-expanded` must reflect actual state.
- Modals/dropdowns must preserve keyboard and focus behavior.

---

## SRD / Builder Content Rules

This section governs all work on the SRD-backed character builder, the content registry, and the `game-data/srd/*.json` files.

### Current Builder Source of Truth

For builder-related builtin content:

- **Active source:** `SRD 5.1`
- **Retired:** `SRD 5.2.1` (data deleted from `game-data/srd/`)

Use SRD 5.1 terminology and content policy for all builder implementation work.

Do not use SRD 5.2.1 as a source for any builtin content. It has been retired.

### Authoritative Builder Files

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

### Builtin vs Custom Content Rule

Lore Ledger uses a strict separation between:

- **builtin content**: content that ships with the app
- **custom content**: user-created or user-added content

Default rule:

> If content is not explicitly greenlit and modeled in project data, treat it as custom content.

Do not silently promote custom or unclear content into shipped builtin data.

### Current Greenlit Builtin Builder Scope

Greenlit: races (and subraces), classes, subclasses, backgrounds, feats, armor, weapons,
equipment packs, the full SRD 5.1 spell registry, and the supporting languages / skills /
features registries.

Deferred: magic items, monster data, and standalone adventuring gear / tools / trade goods
(pack contents ship inline on the pack record instead).

**The exact shipped contents are enumerated once, in the "Shipped Scope at a Glance" table
of [`docs/reference/builder-scope-greenlist.md`](docs/reference/builder-scope-greenlist.md).
Do not restate them here or anywhere else — check that table.**

The three that agents get wrong most often: **Acolyte is the only SRD 5.1 background**,
**Grappler is the only SRD 5.1 feat**, and **Goliath and Orc are not SRD 5.1 races** (they
are 5.2.1, which is retired). Everything outside the greenlist is custom/homebrew content.

Important spell rule:

- the existing spells panel remains the manual-entry and at-the-table UI for user-managed spells
- the builder derives spellcasting progression data (caster status, ability, DCs, slot counts including multiclass and pact magic)
- the builder offers class-list spell selection and seeds selections and slot totals into the spells panel additively at Finish; user edits are never overwritten

### Content Registry Rules

When working with `game-data/srd/*.json`:

- use stable lowercase hyphen-separated IDs (lowercase ASCII letters, digits, hyphens)
- use explicit `kind` fields
- use explicit `source` fields (`"srd-5.1"` for current shipped builtin SRD data)
- prefer structured fields over prose blobs
- do not hardcode registry facts in UI modules when they belong in data files
- keep record shapes aligned with `docs/reference/content-registry-plan.md`
- traits in `traits.json` are purely descriptive — they never carry a `choiceRef` field; the relationship between a trait and a build-time choice flows through the parent race/class/background/subclass entry's `choices` array
- the `kind` vocabulary in build-time choices is a closed set (currently: `language`, `ancestry`, `skill`, `cantrip`); adding a new `kind` requires updating `docs/reference/content-registry-plan.md` and the referential integrity test; class-progression choice ids (`asi-*`, `feature-*`, `class-skill-*`, `multiclass-skill-*`) are generated by `js/domain/rules/progression.js` — see the registry plan
- IDs are unique per kind across `game-data/srd/*.json` (no namespace prefixes); a few ids repeat across kinds (e.g. armor `shield` vs spell `shield`), so lookups are kind-aware
- the referential integrity test at `tests/data/referential-integrity.test.js` is a quality gate for content changes — it must pass before any SRD content change is considered complete
- anchor tests cover mechanics, not text — assert structured fields (size, speed, damage type, breath weapon shape/save, choice shape) but never assert exact description or flavor text

If you introduce a new category shape or cross-record convention, update the registry plan doc too.

### Character Builder Architecture Rules

The builder must remain compatible with the project's existing architecture.

**1. Freeform and builder modes must remain distinct.**

If `build` is null, the character remains freeform/manual.

If `build` is present, builder-derived logic applies.

Do not collapse freeform and builder modes together.

**2. Canonical data must have one source of truth.**

Do not introduce duplicate sync stores for character data.

Builder panels, character panels, and combat embedded panels must continue reading canonical character state rather than maintaining parallel copies.

**3. Do not materialize derived data casually.**

Do not persist derived fields back into flat character fields unless the current phase explicitly calls for it.

Prefer derivation from build choices and registry data over writing computed values into storage prematurely.

**4. Keep UI state out of domain data.**

Do not store modal-open flags, picker expansion state, or similar UI-only state inside builder domain records.

**5. Migrations are mandatory for storage shape changes.**

Any persisted shape change must be handled through the existing versioned migration system and be covered by tests.

### Editing Model: Guarded Build Choices vs. Quick-Edit Sheet Fields

There are **two** categories of editability, and they must not be collapsed.

**Guarded structured build choices** — changed only through wizard-style flows with
confirmation (the builder wizard, Edit in Builder, or the Level Up flow):

- race, subrace
- class levels, multiclass order
- subclass
- background
- ASI
- feats
- starting ability-generation method (manual / standard array / point buy / roll)

**Quick-edit playable sheet fields** — editable directly from the normal character sheet
through a focused popover or modal:

- current HP, max HP override, temp HP
- AC bonuses, initiative, speed
- saves, skills
- attacks, spells, equipment, inventory
- features, resources, notes
- manual overrides generally

The practical pattern: tap/click or long-press a visible sheet field, open a focused edit
popover/modal, apply, and return to the same sheet or combat context.

**Builder-only sheet panels are read-only routing surfaces** (B1, shipped 2026-07-13):
the Builder Identity and Builder Abilities panels display the guarded choices and route
edits through "Edit in Builder" — they never write build data directly. After a character
exists, the normal sheet is the primary editing surface for play-state. Builder flows
exist to guard *structural* choices, not to be the everyday way a player edits HP or adds
a weapon.

Prepared spell lists are **play-state**, not build choices. See rest rules below.

### Rest Rules

Canonical: [`docs/reference/rest-rules-spec.md`](docs/reference/rest-rules-spec.md). Summary:

- **Short Rest** — spend available Hit Dice to regain HP (die roll + CON modifier per die,
  capped at max HP); reset short-rest resources/features; Warlock Pact Magic slots recover.
  Short Rest does **not** auto-restore HP and does **not** restore ordinary spell slots.
- **Long Rest** — regain all lost HP; regain spent Hit Dice **up to half the character's
  total Hit Dice** (not "reset", not "half of level"); reset spell slots, pact slots,
  long-rest resources, and death saves if tracked.
- **Prepared casters** (Cleric, Druid, Paladin, Wizard) normally change prepared spells
  **when finishing a Long Rest**, not freely at any time.
- **Known-spell casters** (Bard, Ranger, Sorcerer, Warlock) change known spells at
  **Level Up**, not at rest.

P0 rest correctness is complete. The implemented rest flow handles tracked HP, Hit Dice,
death saves, tagged recovery, normal/Pact slots, and builder prepared-spell changes at Long
Rest. Rest submission is also guarded against active-character changes: if the active
character changes while the dialog is open, the pending rest is canceled without mutating
either character. Consult the canonical rest spec for the exact rules.

### Level Up Rules

Canonical: [`docs/reference/level-up-flow-spec.md`](docs/reference/level-up-flow-spec.md).
**Phase 1 is implemented and shipped** (2026-07-12): the Level Up action on the character
menu appends exactly one level through `js/pages/character/levelUpWizard.js`, planned by
`getLevelUpPlan()` (progression.js) and applied via `getLevelUpSheetSeedPatch()`
(builderSheetSeeding.js). **Phase 2 (generalized derived class resources) is implemented**
(2026-07-12): `js/domain/rules/classResources.js` derives shared pools, Finish seeds them
into `character.resources[]`, and Level Up grows them by delta — covering Phase 3's
resource deltas. Down-leveling remains ratified out of scope. Ratified decisions:

- **Down-leveling is out of scope.** Do not build reverse level-up logic.
- Level Up **appends exactly one level** and asks only for choices that level unlocks.
- Prepared casters: Level Up reports new spell levels and prepared **capacity**; the actual
  prepared selection happens through the Long Rest flow.
- Do **not** rename the internal `used` spell slot field during Level Up work. (It stores
  *available* slots, despite the name.) Fix misleading user-facing labels instead; an
  internal rename is a separate cleanup change.

### Reference App Screenshots

`docs/reference/fifth-edition-character-sheet/` holds screenshots of the Fifth Edition
Character Sheet app.

- They are **UX/reference coverage only** — used to identify editable surfaces,
  information coverage, and tap/click/long-press edit patterns.
- They are **not a visual-design target**. Do not copy the reference app's visual design,
  colors, spacing, or component styling.

Note: that directory is gitignored, so it may be absent in a fresh clone. Its absence does
not relax any rule in this section.

### Current Working Order

Work proceeds in this order. **Do not skip ahead.** Completed stabilization steps stay
listed so agents do not repeat them:

1. [x] Docs cleanup / stale-instruction audit
2. [x] P0 stabilization bugs (inventory state, Edit in Builder crash, character switching)
3. [x] P0 core rules: Short Rest / Long Rest + prepared-spell flow, including active-character isolation
4. [x] P1 display bugs: initiative, skill/proficiency indicators
5. [x] P1 seeding/display: descriptions, spell ordering, inventory pocket labels
6. [x] Revise the Level Up spec (completed 2026-07-09; the spec is now the canonical Phase 1 contract)
7. [x] Level Up **Phase 1** implemented per the revised spec (authorized and completed 2026-07-12; see `docs/reference/level-up-flow-spec.md` and `js/pages/character/levelUpWizard.js`)
8. [x] Level Up **Phase 2** implemented (2026-07-12): generalized class-resource derivation (`js/domain/rules/classResources.js`, `deriveCharacter().derivedResources`), duplicate-aware seeding into `character.resources[]`, Level Up growth deltas with spent-use preservation, and the custom-class `resources` schema (see `docs/reference/content-registry-plan.md` → Class Resources)
9. [x] **B1** implemented (2026-07-13): Builder Identity / Builder Abilities panels are read-only routing surfaces; structural edits route through the guarded wizard only
10. [x] **B2** implemented (2026-07-13): builder-managed spell rows show live-derived SRD detail blocks (spellsPanel.js); user notes stay purely user-owned
11. [x] **B3** implemented (2026-07-13): display-only rules-reference cards for class/subclass features, feats, and race traits with full SRD descriptions (abilitiesFeaturesPanel.js)
12. [x] Attribution release gate verified (2026-07-13): the CC-BY-4.0 statement already ships in-app (Data & Settings → About); `tests/attribution.test.js` now pins it against LEGAL.md
13. [x] **Custom-content authoring UX (matrix #15) implemented** (2026-07-13/14, owner-authorized session): the Manage Custom Content dialog (`js/ui/customContentManager.js` + `js/domain/customContentAuthoring.js`) authors custom spells, feats, races (inline trait sub-records), and classes (inline feature sub-records, standard-SRD-table spellcasting, `resources[]`, `grantedSpells`) through forms sharing the JSON-import validation. The same session fixed the campaign vault silently dropping `state.content` on reload. **This closed the last P1 — the completion matrix's remaining open items are all P2.**
14. [x] **Matrix #15 integration checkpoint passed** (2026-07-14, owner-authorized): the authored-content system verified through real application paths — browser smoke authors a full custom class (feature sub-record, `resources[]` pool, granted spell), builds a character with it, Finishes (marker-seeded Vitals pool, rules-reference card, always-prepared grant), edits the class in place, and reloads through the campaign vault (`tests/smoke/customContent.smoke.js`); export/reimport, destination-wins, and reference-disclosure remain pinned by unit tests; 380px + keyboard-trap checks green.
15. [x] **Matrix #9 — attack "Recalculate from Build" — implemented** (2026-07-14, owner-authorized): pure proposal engine in `js/domain/attackRecalculation.js` sharing the canonical weapon→attack calculator with Finish seeding; seeded attacks carry the stable `builderSeed: "weapon:<id>"` marker; the Attacks-panel action previews old→proposed values with per-field acceptance, keeps `name`/`notes` user-owned, links legacy rows only through an explicit weapon picker, and applies atomically. **Superseded the same day by step 16:** manual acceptance failed (Apply did not work in `npm run preview`) and the owner ratified that routine manual recalculation is not the intended product behavior.
16. [ ] **Unified calculation contract + High Elf choice work (2026-07-14, owner-authorized, in progress this session):** Builder-created and manually entered characters share one rules engine; sheet values follow the input / derived / adjustment / explicit-fixed-override contract in `docs/reference/character-calculation-contract.md`. Authorized scope: (a) the calculation-architecture audit (`docs/audits/character-calculation-audit-2026-07.md`); (b) replacing the snapshot attack model with structured attacks that derive automatically through one canonical calculator (`js/domain/attackCalculation.js`), with explicit adjustments, intentional fixed mode, safe legacy conversion, and disposition of the broken Recalc dialog; (c) the reusable choice-based granted-spell mechanism and the missing High Elf wizard-cantrip choice; (d) the broader choice-completeness audit; (e) documentation updates. Matrix #13 and unrelated P2 work stay out of scope. Do not push; commit batches locally.
17. [ ] **Next work after step 16 requires new owner scope:** the remaining P2 backlog in `docs/audits/builder-completion-matrix.md` §3 (feature-action counters, partial-regain recovery, prepared-formula overrides, equipment depth, keyboard a11y pass)
18. [ ] **Still blocked / out of scope:** down-leveling (ratified out of scope), builtin content expansion beyond the SRD 5.1 greenlist, and any work outside the character-builder system

`docs/audits/srd-5-1-character-builder-gap-audit-stabilization-docs.md` is a **planning
artifact, not a work order**. Steps 1-7 above are complete. Its batches **B1
(builder-only panel retirement), B2 (spell detail seeding), and B3 (feature detail
seeding) were explicitly authorized on 2026-07-12** to run in sequence after Level Up
Phase 2 (one batch at a time, each fully verified and committed before the next). The
current capability audit is `docs/audits/builder-completion-matrix.md`.

### SRD Data Fetch Pipeline

`game-data/srd/*.json` files are produced by running adapter scripts — they are **not hand-edited**.

The pipeline is:

```psudocode
scripts/fetch-srd-data.js.       — orchestrator
scripts/adapters/racesAdapter.js — produces races.json, including the inline choices array on parent race entries (e.g. Dragonborn's draconic ancestry choice; Human's bonus language choice)
classesAdapter.js                — produces classes.json
backgroundsAdapter.js            — produces backgrounds.json
draconicAncestriesAdapter.js     — produces draconic-ancestries.json
traitsAdapter.js                 — produces traits.json, including derivedFrom on traits whose mechanics depend on a build-time choice (e.g. Breath Weapon, Damage Resistance)
equipmentAdapter.js              — produces equipment.armor.json and equipment.weapons.json
equipmentPacksAdapter.js         — produces equipment.packs.json (SRD packs with inline contents)
spellsAdapter.js                 — produces spells.json (full SRD 5.1 spell registry)
subclassesAdapter.js             — produces subclasses.json (incl. granted domain spells)
featuresAdapter.js               — produces features.json (feature text + subfeature options)
featsAdapter.js                  — produces feats.json
languagesAdapter.js / skillsAdapter.js — produce languages.json / skills.json
```

These scripts fetch from `dnd5eapi.co` during development and transform the results into the repo's structured JSON format. The JSON files are then committed and shipped with the app — there are no runtime API calls.

**Rule:** If the content in a `game-data/srd/*.json` file needs to change, edit the relevant adapter script in `scripts/adapters/` and re-run it. Do not edit the JSON files directly. Direct edits will be overwritten the next time the adapter runs.

**Choices field rule:** When a race, class, background, or subclass grants a build-time choice (pick a language, pick an ancestry, pick a fighting style, etc.), that choice lives **inline on the parent entry** as a `choices: []` array, not in a separate file. The corresponding adapter is responsible for emitting it. See `docs/reference/content-registry-plan.md` "Build-Time Choices Schema" for the choice shape.

### Practical Working Rule

For Lore Ledger builder work:

> Use SRD 5.1 as the active builtin source. SRD 5.2.1 is retired. Content kind for race is "race" not "species". Source field value is "srd-5.1". Treat ungreenlit content as custom. Keep implementation data-driven, migration-safe, and architecture-aligned.

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

## Implementation Style

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

## Testing and Verification

Builder-related and other behavior-affecting changes should preserve the project's quality bar.

When relevant, update or add:

- unit tests
- migration tests
- derivation tests
- panel behavior tests

Do not rely on manual clicking alone for logic changes.

After any change, verify as applicable:

- existing saved data loads
- add/edit/delete still works
- refresh persists changes
- backup/import/export still works
- mobile has no clipped headers
- no horizontal scrolling
- console has no errors
- no duplicate event handlers
- PWA/browser behavior still works where relevant
- related tests pass

When a change touches navigation, lifecycle, install/offline/update behavior, or major UI flows, also run the relevant broader verification path when available.

Expected commands:

- targeted Vitest file
- `npm run test:run`
- `npm run build`
- `npm run verify`
- Playwright smoke tests when UI/navigation/PWA behavior changes

Do not report "fully green" unless the command actually passed.

---

## Output Expectations

When reporting work, use this five-part structure:

1. **Executive summary** — one or two sentences describing what was done
2. **Exact files changed** — full paths, no abbreviations
3. **What changed and why** — section-by-section if appropriate
4. **Verification performed** — list of commands run and their results, plus any manual checks
5. **Remaining risks or follow-ups** — known gaps, deferred work, anything you noticed but didn't address

Be honest about anything not verified. Do not claim "fully green" or "all tests pass" without having actually run the tests.

---

## When Unsure

For content uncertainty (is this allowed, modeled correctly, in current scope?):

1. check `docs/reference/srd-licensing-notes.md`
2. check `docs/reference/builder-scope-greenlist.md`
3. check `docs/reference/content-registry-plan.md`
4. prefer the conservative interpretation

When in doubt, do not ship it as builtin.

For code-change uncertainty (how should this be structured?):

1. find the closest existing pattern
2. match it exactly
3. make the smallest possible change
4. add defensive checks
5. document assumptions

If neither path resolves the uncertainty, stop and ask before proceeding.

---

End of rules.
