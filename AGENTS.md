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
| **Snapshots / Restore Character / Edit-in-Builder retirement** | "Current Working Order" below → `docs/reference/restore-character-spec.md` → `docs/audits/edit-in-builder-retirement-audit-2026-07.md` | Implementing any of it without the working-order authorization |
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
- `docs/reference/restore-character-spec.md` — normative pre-Level-Up snapshot + Restore Character contract (**phases R1 capture, R2 restore engine, R3 restore-only Restore Character UI, and R4 backup asset completeness are implemented** (2026-07-18 / 2026-07-22 / 2026-07-22 / 2026-07-24); R5–R6 still require explicit owner authorization, and **snapshot deletion is deferred to a separately authorized future phase — not R3, not R4/R5/R6**)
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
- the `kind` vocabulary in build-time choices is a closed set (currently: `language`, `ancestry`, `skill`, `cantrip`); `cantrip` is now wired end-to-end (High Elf) via a filtered spell `from` (`{ source: "spells", filter: { classId, maxLevel } }`) and an optional `spellcastingAbility` provenance field — see `js/domain/rules/spellChoices.js`; adding a new `kind` requires updating `docs/reference/content-registry-plan.md` and the referential integrity test; class-progression choice ids (`asi-*`, `feature-*`, `class-skill-*`, `multiclass-skill-*`) are generated by `js/domain/rules/progression.js` — see the registry plan
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

> **Ratified direction (2026-07-18); retirement not yet implemented:** the general
> user-facing "Edit in Builder" action will be **retired** (spec phase R5). The Builder
> creates characters; it is not a general-purpose tool for retroactively rewriting
> race, class, subclass, background, equipment, feat, or prior progression decisions.
> Its "fix a mistake" role moves to **pre-Level-Up snapshots + Restore Character** —
> see `docs/reference/restore-character-spec.md` (normative; phase R1 snapshot capture
> shipped 2026-07-18) and `docs/audits/edit-in-builder-retirement-audit-2026-07.md`
> (dependency audit; owner decisions D1–D4 **ruled 2026-07-18** in its §3, including
> the R5 requirement that base ability-score editing lands on the existing Abilities &
> Skills editor rather than a new flow). Until R5 is authorized and shipped, Edit in
> Builder remains current behavior and everything in this section stays accurate.

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

- **Down-leveling is out of scope.** Do not build reverse level-up logic. (The ratified
  undo path is pre-Level-Up snapshots + Restore Character — restore a pre-mistake copy
  and redo the Level Up; see `docs/reference/restore-character-spec.md`.)
- Level Up **appends exactly one level** and asks only for choices that level unlocks.
- Prepared casters: Level Up reports new spell levels and prepared **capacity**; the actual
  prepared selection happens through the Long Rest flow.
- Do **not** rename the internal `used` spell slot field during Level Up work. (It stores
  *available* slots, despite the name.) Fix misleading user-facing labels instead; an
  internal rename is a separate cleanup change.

### Reference App Screenshots

`docs/reference/fifth-edition-character-sheet/` holds screenshots of the Fifth Edition
Character Sheet app. They are **product-reference material, not a visual specification.**
This section governs their use in every Builder, character-sheet, editing, and Level Up
UI decision.

Use them to understand:

- which user choices may need to be presented, and **when** those choices appear during
  character creation, editing, and Level Up
- which resulting fields may need to remain editable afterwards
- how complicated options can be grouped or explained
- interaction patterns that reduce user confusion (tap-to-edit surfaces, grouping,
  progressive disclosure)

Hard rules:

- Do **not** copy the reference app's branding, visual style, component design, wording,
  layout, or exact presentation. All resulting UI must use Lore Ledger's existing design
  system, terminology, accessibility standards, responsive behavior, and interaction
  conventions.
- SRD 5.1 rules, Lore Ledger product decisions, and the current repository architecture
  remain authoritative. Verify every screenshot-based assumption against the actual SRD
  rules and the repository data model before building on it.
- Screenshots never justify shipping unsupported non-SRD content or silently broadening
  scope.
- Stable IDs and structured semantics take precedence over surface similarities seen in
  screenshots.

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
16. [x] **Unified calculation contract + High Elf choice work — shipped 2026-07-15** (owner-authorized): (a) calculation-architecture audit (`docs/audits/character-calculation-audit-2026-07.md`) + the input/derived/adjustment/fixed-override contract (`docs/reference/character-calculation-contract.md`); (b) the snapshot attack model was replaced with **structured, live-deriving attacks** through one canonical calculator (`js/domain/attackCalculation.js`) — automatic updates on ability/proficiency change, explicit `attackAdjustment`/`damageAdjustment`, intentional `calc.mode: "fixed"`, marker-based provenance + re-seed dedup, safe legacy conversion in a per-row editor; the broken "Recalculate from Build" dialog and `attackRecalculation.js` were removed; (c) reusable choice-based granted spells (`js/domain/rules/spellChoices.js`) + the **High Elf wizard-cantrip** choice (filtered spell picker, Finish gating, INT provenance, non-caster seeding); (d) choice-completeness report (audit §"Choice completeness"); (e) docs updated. **Deferred (need new owner scope):** AC/spellDC/spellAttack/HP snapshot→derived (audit F2); Half-Elf ability/skill choices, Tiefling cantrip grant, race-trait fixed proficiencies (F3), Dwarf tools.
17. [x] **Audit F2 — AC / max HP / spell save DC / spell attack snapshot→derived: shipped 2026-07-16/17** (owner-authorized 2026-07-15). All four fields follow the calculation contract through optional per-field calc blocks on the open entry shape (`spellcastingCalc` per-source profiles, `acCalc`, `hpMaxCalc` — no schema migration): derived by default for new builder characters with live updates, explicit adjustments, intentional fixed overrides, and verbatim legacy snapshots with editor-based adoption (a re-seed stamps a derived block only when it cannot change the displayed value). The engine gained the Defense fighting style (+1 while armored) and structured Dwarven Toughness (`hpPerLevelBonus` on race records). Level Up/rest/tracker/combat are calc-aware; combat AC edits on calc-managed characters are participant-local temporaries; freeform casters declare DC/attack profiles while freeform AC/max HP stay manual inputs by contract. See `docs/reference/character-calculation-contract.md` → "Structured Vitals ownership" and `docs/audits/character-calculation-audit-2026-07.md` → Phase B. A production-preview smoke gate exists (`playwright.preview.config.js`); **the 7 dev-only smoke harnesses were reworked for preview compatibility on 2026-07-18** — the full 61-test suite now passes under both configs, smoke harnesses must never `import()` source modules into the page, and the rework surfaced + fixed a real teardown leak (the character page controller created by `rerender()` escaped `destroyCampaignModules()`; `destroyActiveCharacterPageUI()` now resolves the live controller at destroy time). See `docs/operations/browser-smoke-status.md` → "Preview-safe harness rules".
18. [x] **Restore Character / snapshot specification batch (2026-07-18, owner-directed):** the owner ratified the product model — the Builder is for initial creation; general user-facing **Edit in Builder will be retired**; Lore Ledger saves a complete character snapshot immediately before every successful Level Up commit (one safe transaction); a **Restore Character** flow restores any snapshot as a **separate playable copy** (new stable ID, never overwrites or mutates the current or source character, repeatable, snapshots retained until individually deleted). The binding design is `docs/reference/restore-character-spec.md`; the dependency audit and open owner decisions (D1 B1-panel disposition, D2 base-ability correction path, D3 incomplete-choice completion, D4 delete-time snapshot offer) are in `docs/audits/edit-in-builder-retirement-audit-2026-07.md`. **Specification only — no runtime change shipped.**
19. [x] **Restore Character phase R1 — schema v13 + transactional pre-Level-Up snapshot capture: shipped 2026-07-18 (owner-authorized).** `state.characters.snapshots` (campaign-scoped, schema v13, normalized by `js/domain/characterSnapshots.js` — the single normalization source of truth); every successful Level Up apply captures one complete deep-cloned pre-Level-Up snapshot **inside the same `mutateCharacter` mutation** as the commit (validation and record construction precede all writes; open/cancel/invalid/failed applies capture nothing; replace-append on `(kind, sourceCharacterId, fromLevel)` guards duplicates); records ride through sanitize, the campaign vault, and full backups, and survive source-character deletion — all pinned by `tests/characterSnapshots.test.js`, the "level up flow" capture tests, a real-`importBackup` retention test, and levelUp smoke assertions. **The same session ruled owner decisions D1–D4** (B1 panels retire in R5; base ability scores stay on the existing Abilities & Skills editor — builder base-score inputs are currently disabled and R5 must enable them, no new flow; incomplete required choices get a future contextual banner + narrow Complete Choices flow; character deletion keeps snapshots, no v1 checkbox) — see the retirement audit §3. **R1 ships no user-facing Restore UI; snapshot history is created and preserved only.**
20. [x] **Restore Character phase R2 — the non-UI restore engine: shipped 2026-07-22 (owner-authorized).** `js/domain/characterSnapshots.js` gained snapshot resolution (`getCharacterSnapshotById`), pure preparation (`prepareRestoredCharacter` — deep-cloned payload migrate-through the canonical `migrateState` pipeline, new collision-checked `char_…` id, spell-row id regeneration with an old→new note-copy map while every other character-local id is preserved verbatim, provenance stamps `restoredFromSnapshotId`/`restoredFromCharacterId`/`restoredAt`, deterministic `<name> — Restored Level <N>` naming with ` (2)`-style collision suffixes), and a staged commit (`commitRestoredCharacter` — portrait duplicate and spell-note copies staged **before** the single state mutation, rollback deletes staged records on any failure, double-commit latch + in-mutation id guard, `activate` defaults to false so a domain restore never changes the active character) plus the `restoreCharacterFromSnapshot` orchestrator for R3. Pinned by `tests/characterSnapshots.restore.test.js` (40 tests). **R2 ships no UI — nothing calls the engine in production yet; restoring is not user-visible.** See spec §3.2–§3.4/§8 as-built notes.
21. [x] **Restore Character phase R3 — the user-facing, restore-only Restore Character UI: shipped 2026-07-22 (owner-authorized).** `Restore Character` sits directly after Level Up in the character action menu and always opens (empty state teaches the feature). The dialog (`js/pages/character/restoreCharacterDialog.js`, `#restoreCharacterOverlay` in `index.html`, additive `styles.css`, wired in `characterPage.js`; `migrateState` + `deleteText` threaded through `trackerPage.js`/`app.js`) lists pre-Level-Up snapshots grouped by source character (newest-first groups and rows, deleted sources labeled), confirms non-destructively, and calls the R2 `restoreCharacterFromSnapshot` engine with `activate: true` — **no restoration logic is reproduced in the UI.** Owner-ratified persistence contract: after the engine resolves in memory, R3 confirms the save via `SaveManager.flush()`; an unconfirmed save (a real error **or** a save in progress — never treated as data loss) locks the dialog open in a pending-save state with `Retry Save` (which retries **only** flush, never the engine) and blocks close/Escape/overlay/further restore; only a confirmed save finalizes once (notify active-character change → rerender → `Restored "<name>"` status). **R3 is restore-only: no delete button/confirmation/retention control ships.** Pinned by `tests/restoreCharacterDialog.test.js` (25), `tests/restoreCharacterWiring.test.js` (2), the menu-order pin in `tests/characterPage.test.js`, and `tests/smoke/restoreCharacter.smoke.js`. Verified: typecheck clean, 1329/1329 unit, build clean, both smoke gates 64/64.
22. [x] **Restore Character phase R4 — backup asset completeness: shipped 2026-07-24 (owner-authorized).** `js/storage/backup.js` only. `collectReferencedBlobIds`, `collectReferencedTextIds`, `collectSpellIds` (hence `remapIncomingSpellNoteTextIds`), and `remapBlobIds` now walk retained `characters.snapshots[].payload` records through two shared private helpers (`getSnapshotPayloads()`, `getSpellRowIds()`), so a portrait blob or spell-note text owned only by a retained snapshot is bundled into a full backup, survives the post-import cleanup pass, and remaps to the destination campaign — including after the source playable character has been deleted. Malformed optional snapshot data fails soft; duplicates stay `Set`-deduplicated. **No schema, migration, runtime state-shape, UI, or Restore Character behavior change; `.ll-character.json` still excludes snapshots.** Pinned by 9 new tests in `tests/storage.backup.test.js` (30 → 39). See spec §6 as-built notes.
23. [x] **R5-A — builder base ability scores editable from the sheet: shipped 2026-07-24 (owner-authorized).** Owner decision D2 delivered without a new flow: the existing Abilities & Skills `⋯` menu carries four builder groups (Ability Scores → `build.abilities.base`, Ability Adjustments → `overrides.abilities`, Misc Save Bonus, Ability Mod To All Saves); every dependent value recalculates through the shared engine and `build.abilities.method` is left untouched. A same-day follow-up (`643df64`) scoped the Character-page Abilities panel to the `#page-character` root so the Combat workspace's embedded copy can no longer capture the menu on rerender.
24. [x] **R5-B1 — structured required choices, the incomplete-choices banner, and the Complete Choices flow: shipped 2026-07-25 (owner-authorized).** Owner decision D3's replacement for Edit in Builder's "fix a skipped choice" role. New pure `js/domain/rules/choiceCompletion.js` owns the single traversal of `(build, registry)` and classifies every build-time choice as **required** (fixed legal count) or permitted **under-cap** (class cantrips, known spells, wizard spellbook); `getIncompleteChoiceSummaries()` in `builderWizardSteps.js` became a thin formatter over it, so no second traversal exists. **Owner ruling: fixed-count language choices (`human-language`, `half-elf-language`, `acolyte-language`) are required** — previously reported nowhere, they are now the only intentional new Summary rows (every pre-existing non-language row and its ordering is byte-identical, pinned by a frozen-baseline suite). The creation Summary now renders required work and permitted under-cap counts as two distinct blocks. A contextual banner (`#charIncompleteChoices`, directly above `#charColumns`, outside every panel, derived from build data with no persisted UI flag) offers `Complete Choices`, which opens a focused dialog (`js/pages/character/completeChoicesFlow.js`, `#completeChoicesOverlay`) rendering **only** unresolved required choices through the shared wizard primitives, recomputing live so a resolved choice disappears and one it unlocks appears. Apply commits the draft build plus the additive `getBuilderFinishSheetSeedPatch` in one `mutateCharacter` (one dirty mark; a no-op Apply mutates nothing); under-cap categories never raise the banner or appear in the dialog, and prepared spells stay Long-Rest owned. Missing subclasses remain non-blocking at creation by ruling. Pinned by `tests/choiceCompletion.test.js` (22), `tests/completeChoicesFlow.test.js` (31), the extended `tests/incompleteChoices.test.js` (23, incl. the compatibility baseline) and `tests/characterPage.test.js`, and `tests/smoke/completeChoices.smoke.js` (4). Verified: typecheck clean, 1421/1421 unit, build clean, both smoke gates 70/70. **No new persisted field, no schema change, and no under-cap acknowledgement — that is R5-B2.**
25. [x] **Prepared Correctness C1 — the Long Rest prepared-spell correctness foundation: shipped 2026-07-27 (owner-authorized).** New pure `js/domain/rules/preparedSpells.js` owns every prepared-spell rule through one registry-injected `getPreparedSpellPlan(character, registry)`; `getBuilderPreparedSpellOptions()` is its accessor and `validateBuilderPreparedSpellSelections()` its commit guard, so no UI module holds a capacity, class-list, spellbook, grant-exclusion, or multiclass spell-level formula. Fixes three defects against the canonical rest spec §4: the Long Rest heading rendered `0 / capacity` regardless of the real selection, every count was hidden until the player chose "Yes", and granted/always-prepared spells were ordinary picks that consumed capacity. **Two capacities are now kept separate** — `formulaCapacity` (stays `null` when unknown, never coerced to `0`) and `effectiveCapacity = min(formula, ordinary candidates)` with a `limitedBy` reason (`formula` / `candidates` / `unknown`) that the dialog explains in plain language. **Multiclass rule: each caster's candidate spell levels come from its own class table at its own class level; combined slots never widen them.** Prepared commits **merge** — only actively-changed classes are submitted, "No" and a no-edit "Yes" rewrite nothing, untouched classes (including unresolvable ones and legacy/redundant granted ids) are carried through verbatim, and a redundant granted id falls away only when that class is actively recommitted. **No schema change, no migration, no load-time cleanup, no new persisted field**; granted spell access keeps flowing from `derived.grantedSpells` through Finish seeding. Tests: `tests/preparedSpells.test.js` (28), `tests/restFlow.test.js` (15), extended `tests/characterRest.test.js` and `tests/builderSheetSeeding.test.js`, plus `tests/smoke/characterRest.smoke.js`. Verified: typecheck clean, 1475/1475 unit, build clean, both smoke gates 70/70, and a real 380px keyboard/focus pass. **Explicitly not in C1:** creation prepared caps, any underfill confirmation, Summary prepared rows, persisted acknowledgement / `underCapAckLevels`, the Level Up capacity-formula divergence, and `builderGranted` Spells-panel presentation.
26. [x] **Prepared Sheet Synchronization C1.1 — the sheet catches up with the authoritative prepared list, and Long Rest stops re-seeding unrelated content: shipped 2026-07-28 (owner-authorized).** Two production files. C1 left `rest.preparedByClass` correct but sheet seeding additive-only, so a **deselected ordinary spell kept `prepared: true`** on the Character sheet, the Combat embedded Spells panel, and on disk — reproduced against the published C1 build. The defect **predates C1**, which only made deselection a routine action; Wizards were accidentally exempt because every spellbook entry is re-seeded at `prepared: false`. New `getLongRestPreparedSheetPatch()` in `js/domain/builderSheetSeeding.js` projects the plan onto rows for the **actively recommitted classes only**: a row is prepared when **any** prepared caster prepares that spell (so shared multiclass spells survive), granted (`builderGranted`) and manual (no `builderSpellId`) rows are never eligible, **only the `prepared` boolean is written**, and the sync creates and deletes nothing. Every rule still comes from `getPreparedSpellPlan()` — no second owner. **The Long Rest commit now applies a spells-only patch** instead of the full Finish seed, so a prepared change can no longer restore features, languages, proficiencies, attacks, inventory pockets, resources, or vitals the player deleted; creation Finish, Edit in Builder, Complete Choices, and Level Up keep full seeding byte-identical. **No schema change, no migration, no load-time repair, no new persisted field, and no second dirty mark**; rows left stale by an earlier build self-correct on the next active recommit of that class. Tests: new `tests/preparedSheetSync.test.js` (24), a page-wiring test in `tests/characterPage.test.js`, and two new `tests/smoke/characterRest.smoke.js` cases (both Spells surfaces + reload; keyboard-operable 380px no-overflow — the reviewer's N2 gap). Verified: typecheck clean, 1500/1500 unit, build clean, both smoke gates 72/72, and a real 380px keyboard/focus pass on `npm run preview`. **Deferred:** `builderGranted` presentation in the Spells panel, `aria-live` count announcements, and removing the dead `getPreparedSpellCapacity()`.
27. [x] **Creation Prepared Correctness C2-A — character creation consumes the shared prepared-spell plan: shipped 2026-07-28 (owner-authorized).** Three production files. Creation was the last module holding a second prepared implementation: `renderSpellsStep()` filtered the whole class spell list without excluding grants, took its spell-level ceiling from the **combined multiclass slot array**, displayed `formulaCapacity` instead of `effectiveCapacity`, and enforced no upper limit at all — and `adoptInitialBuilderPreparedSelections()` copied the result into `rest.preparedByClass` verbatim. A Cleric 3 / Wizard 3 could prepare 3rd-level cleric spells that Long Rest then filtered out while their sheet rows stayed permanently `prepared: true`; all four Life Domain grants were simultaneously offered as ordinary picks. The creation picker now reads `getPreparedSpellPlan()` through `getDraftPreparedSpellPlan()`, a **non-persisted** `{ build, overrides: null }` view of the wizard draft (no `rest`, so the plan reports the draft's own `preparedIds` as `selectedIds`) — no canonical state, no saved field, no second prepared store. Candidates, grants, the class's own ceiling, capacity, and the limitation wording all come from the plan; selection is **hard-blocked at `effectiveCapacity`** (unchosen candidates disabled at the cap, chosen ones still deselectable), unknown capacity locks the picker and never renders `0`, and a spellbook change recomputes the plan and rebuilds only the prepared group so focus stays on the spellbook control. New `getDraftPreparedValidationMessage()` gates Finish in `builderWizard.js` and repeats defensively in `characterPage.js` before any mutation: redundant granted ids, above-ceiling ids, off-list ids, over-cap lists, and non-empty lists under unknown capacity are **reported, never truncated or repaired**, producing no mutation, no seeding, no adoption, no dirty mark, and no save. Adoption stores the plan's validated `selectedIds`, so granted ids no longer enter `rest.preparedByClass`; the established-runtime-key rule (Edit in Builder cannot overwrite play-state) and unresolvable-class fail-soft are both preserved. Cantrip/known/spellbook groups are byte-identical and **pinned**, including their permissive over-cap handling (recorded for R5-B2, not fixed here). Tests: new `tests/preparedCreation.test.js` (19) plus 5 real-wizard-Finish cases in `tests/characterPage.test.js`, every negative case carrying a positive control. Verified: typecheck clean, 1524/1524 unit, build clean, both smoke gates 72/72, and a real 380px production-preview pass. **No schema change, no migration, no new persisted field, no persisted acknowledgement.** **Not in C2-A:** underfill confirmation, Summary prepared rows, prepared-count `aria-live` (all C2-B); Level Up capacity correctness; `builderGranted` Spells-panel presentation. **Correction (2026-07-28, independent review):** the Finish gate rejected ids the redesigned picker does not render — granted, above-ceiling, off-list, out-of-spellbook, unresolvable, and any id under unknown capacity — so an Edit-in-Builder session on a character the *shipped* builder produced could never Finish and had no control capable of clearing the id (SRD 5.1 ships one cleric subclass, so even changing subclass was no escape). The prepared group now renders each such stored id as a checked, enabled, **removal-only remediation row** (named with a raw-id fallback and a reason), unknown capacity locks only *unchosen* candidates so a selected list can always be cleared, the change handler defends the cap against synthetic events, and the cap-disabled state is visibly muted with `cursor: not-allowed` via a narrowly scoped `.builderSpellCheckItem.isDisabled`. Removal is explicit user action only: **no load-time repair, no cleanup, no migration**, and cancel leaves the stored build byte-identical. Tests: `tests/preparedCreation.test.js` (33) plus 2 real-wizard cases in `tests/characterPage.test.js` and the new `tests/smoke/preparedCreation.smoke.js` (2).
28. [x] **Prepared Correctness C2-B — prepared underfill is visible and requires a transient confirmation: shipped 2026-07-28 (owner-authorized).** New pure `getPreparedSpellUnderfillShortfalls()` in `js/domain/rules/preparedSpells.js` evaluates the **resulting ordinary prepared list** against the shared plan's `effectiveCapacity`; full lists, zero capacity, and unknown capacity require no confirmation. Creation Summary now has a separate neutral **Prepared for play** row with per-class `selected / capacity` counts and a keyboard-operable **Review prepared spells** return to the Spells step. On creation Finish, and on every Long Rest prepared path (preselected No, edited Yes, and no-edit Yes), the first underfilled submission focuses an inline alert and changes the action to **Finish Anyway** / **Take Long Rest Anyway**; only a second submission of the exact unchanged result proceeds. Changing the relevant selection clears that transient confirmation. Edit in Builder is intentionally excluded because prepared lists are Long-Rest-owned play state. Prepared counts are polite atomic live regions in creation and Long Rest. **No new modal, persisted field, acknowledgement record, schema change, migration, or required-choice/banner coupling.** Pinned by `tests/preparedSpells.test.js`, `tests/restFlow.test.js`, `tests/characterPage.test.js`, and the prepared creation/rest smoke coverage. Verified: typecheck clean, 1550/1550 unit, build clean, both smoke gates 74/74, plus a real 380px production-preview keyboard/focus/no-overflow/zero-console-error pass.
29. [x] **Prepared Correctness C2-C — Level Up reports the prepared capacity a Long Rest will actually enforce: shipped 2026-07-29 (owner-authorized).** Three production files. Level Up was the last surface holding its own capacity formula: `getLevelUpPlan()` derived it from `getBuildAbilityTotals()`, so it **ignored `overrides.abilities`**, **excluded the ASI or ability-granting feat being chosen in that very flow**, showed the raw `formulaCapacity` instead of the candidate-bounded `effectiveCapacity`, **never saw a Wizard's real spellbook**, and could not notice a capacity change to a prepared class the appended level does not belong to. A Level Up could therefore promise a capacity the following Long Rest refused. New pure `getPreparedSpellCapacityChanges(before, after, registry)` in `js/domain/rules/preparedSpells.js` calls `getPreparedSpellPlan()` on two **character-shaped views** — the real current character, and that same shell carrying Level Up's isolated draft build — and diffs their `effectiveCapacity` per prepared caster, so per-class levels/progression, each class's own spell-level ceiling, granted-spell exclusion, spellbook bounds, and `null`-means-unknown all come from the one owner. `levelUpWizard.js` reproduces no arithmetic: it renders the existing **Prepared capacity** row and the existing Long-Rest explanation from that comparison (`before → after` only when it moves, `unknown` never `0`, no misleading "before" for a class only now becoming a prepared caster), recomputes rather than caches so a pending Wizard spellbook pick updates the value in place bounded by the class formula, and makes the informational Spells step available whenever **any** prepared caster's capacity moves — including a multiclass ASI on a non-spellcasting appended level, which produces no `spellcastingDelta` at all. The plan's `preparedCapacityBefore`/`preparedCapacityAfter` fields and their local formula are **removed** rather than left to disagree, so a prepared caster whose only change would be capacity no longer produces a delta entry. Level Up stays informational: no prepared picker, no Long Rest selector, no legacy `preparedIds` write, and `rest.preparedByClass` byte-identical on open, navigation, cancel, and a successful Apply (still one mutation, one dirty mark, one rerender). Tests: new `tests/levelUpPreparedCapacity.test.js` (17, every negative case with a positive control), the plan contract re-pinned in `tests/progression.levelUp.test.js`, a real-Apply prepared byte-identity case in `tests/characterPage.test.js`, and two new `tests/smoke/levelUp.smoke.js` cases (adjustment-aware capacity with a capacity-only Spells step; keyboard-driven spellbook additions moving the value live at 380px). Verified: typecheck clean, 1572/1572 unit, build clean, both smoke gates 76/76, plus a real 380 × 820 production-preview pass. **No schema change, no migration, no new persisted field, and no acknowledgement.** **Not in C2-C:** C2-D `builderGranted` Spells-panel presentation, prepared selection during Level Up, R5-B2, the level-20 Wizard correction, and removing the dead `getPreparedSpellCapacity()`.
30. [x] **Prepared Correctness C2-D — the Spells panel stops offering a manual `Prepared` override on granted spells: shipped 2026-07-30 (owner-authorized).** Two production files (`js/pages/character/panels/spellsPanel.js`, `styles.css`). The sheet was the last surface contradicting the prepared model: a `builderGranted` row carried the same interactive `Prepared` toggle as any other row, titled "Manual/DM prepared override" — implying a grant is an ordinary preparation the player chose, may unchoose, and that it occupies one of the `effectiveCapacity` slots C1 reserves for ordinary candidates. None of that is true (grants reach the sheet through `derived.grantedSpells`, are excluded from `ordinaryCandidateIds`, consume no capacity, and are never eligible for C1.1's projection), so the toggle also had no authoritative meaning to write back to. A row with `builderGranted === true` now renders **no** `Prepared` control and instead carries a non-interactive `Always Prepared` marker — the wizard's own wording — plus a **visible** sentence stating the grant does not use the character's ordinary prepared spell capacity. The explanation is rendered text on its own wrapping line, not a `title` tooltip and not behind the notes disclosure, so a collapsed granted row still shows it; dropping the third toggle also gives the row's name input *more* width at 380px rather than less. **The presentation is decided by `builderGranted` alone, never by the stored `prepared` boolean**, so a legacy or malformed granted row at `prepared: false` — including a granted cantrip, which seeding deliberately writes that way — still reads as always prepared, and render **repairs nothing**: no row is normalized, no persisted field is touched to support the display, and rendering marks nothing dirty. `Known` and `Cast` keep their existing `mutateSpellEntry()` path, one dirty mark per user action, and full keyboard operation. Manual rows and ordinary builder-managed rows are byte-identical: same toggle, same title, same `Prepared — manual or DM override` label, same mutation, same dirty behavior. Both surfaces get it through the one shared `initSpellsPanel()` — the Combat embedded panel is not a second renderer. Tests: new `tests/spellsPanel.grantedPresentation.test.js` (9, every negative case with a positive control) and `tests/smoke/grantedSpellPresentation.smoke.js` (2, a real Life Domain cleric built through the wizard, both Spells surfaces, Combat→Character synchronization, reload, 380px). Both new files were run against the reverted `cf446df` production files first: 6 of 9 unit cases and both smoke cases failed there (the 3 that passed are the manual/ordinary-row pins, which must pass on both sides). Verified: typecheck clean, 1581/1581 unit, build clean, both smoke gates 78/78, plus a real 380 × 820 production-preview pass on the current `dist/` bundle with the service worker unregistered and caches cleared (zero console/page errors, zero page or panel horizontal overflow). **Presentation only: no prepared picker, no Long Rest mutation, no new prepared state, no schema change, no migration, no persisted field, no acknowledgement, no load-time cleanup.** `rest.preparedByClass` stays authoritative and the shared-spell provenance limitation is unchanged. **Not in C2-D:** R5-B2, the cantrip/known/spellbook under-cap acknowledgement, the level-20 Wizard correction path, R5-C, R6, snapshot deletion, per-row spell provenance, the dead `getPreparedSpellCapacity()` accessor, and the duplicate Long Rest `deriveCharacter()` call.
31. [ ] **Restore Character phases R5-B2, R5-C, R6 (spec §8) + snapshot deletion + the max-level spell-choice correction path: each still requires explicit owner authorization before code changes.** R5-B2 non-prepared creation/Level Up under-cap opportunity + persisted acknowledgement → R5-C Edit-in-Builder retirement (bound by the D1–D4 rulings) → R6 shipped-behavior doc close-out. **A separately scoped, non-banner correction path for a permanently stranded level-20 Wizard spellbook shortfall must be designed and placement-confirmed before R5-C retires Edit in Builder** (owner ruling 2026-07-25). **Snapshot deletion remains a separately authorized future phase — NOT part of R3/R4/R5/R6 (spec §5).** Do not self-start any phase from this list.
32. [ ] **Still open after F2 (needs new owner scope):** the remaining P2 backlog in `docs/audits/builder-completion-matrix.md` §3 (feature-action counters, partial-regain recovery, prepared-formula overrides, equipment depth, keyboard a11y pass), the deferred choice work above (Half-Elf ability/skill choices, Tiefling cantrip grant, race-trait fixed proficiencies, Dwarf tools), and freeform initiative (audit F1). (Preview-compatibility for the dev-only smoke harnesses was completed 2026-07-18 — see step 17.)
33. [ ] **Still blocked / out of scope:** down-leveling (ratified out of scope; the undo path is Restore Character per step 18), builtin content expansion beyond the SRD 5.1 greenlist, and any work outside the character-builder system

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
scripts/adapters/racesAdapter.js — produces races.json, including the inline choices array on parent race entries (e.g. Dragonborn's draconic ancestry choice; Human's bonus language choice) and on subrace entries (e.g. High Elf's wizard-cantrip choice)
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
