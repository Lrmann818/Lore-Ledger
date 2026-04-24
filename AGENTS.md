# AGENTS.md

This file is the canonical rules document for any coding agent (Claude Code, Codex, Cursor, or other AI assistants) working in the Lore Ledger (`Lore-Ledger`) repo.

It is also the canonical rules document for human contributors making AI-assisted changes.

If you only read one file before working in this repo, read this one. `CLAUDE.md` exists as a pointer for Claude Code's auto-discovery; its content is intentionally minimal because the rules live here.

---

## Purpose

This file tells coding agents how to work safely in the Lore Ledger (`Lore-Ledger`) repo. It exists to reduce ambiguity, prevent scope drift, keep implementation aligned with the project's architecture, and protect the project's reliability and backward-compatibility commitments.

If a requested change conflicts with this file or the docs it points to, **stop and surface the conflict**. Do not silently improvise around it.

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

### Content Registry Rules

When working with `game-data/srd/*.json`:

- use stable lowercase underscore-separated IDs
- use explicit `kind` fields
- use explicit `source` fields (`"srd-5.1"` for current shipped builtin SRD data)
- prefer structured fields over prose blobs
- do not hardcode registry facts in UI modules when they belong in data files
- keep record shapes aligned with `docs/reference/content-registry-plan.md`

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

### SRD Data Fetch Pipeline

`game-data/srd/*.json` files are produced by running adapter scripts — they are **not hand-edited**.

The pipeline is:

```
scripts/fetch-srd-data.js    — orchestrator
scripts/adapters/
  racesAdapter.js            — produces races.json
  classesAdapter.js          — produces classes.json
  backgroundsAdapter.js
  equipmentAdapter.js
  spellsAdapter.js
  ... etc
```

These scripts fetch from `dnd5eapi.co` during development and transform the results into the repo's structured JSON format. The JSON files are then committed and shipped with the app — there are no runtime API calls.

**Rule:** If the content in a `game-data/srd/*.json` file needs to change, edit the relevant adapter script in `scripts/adapters/` and re-run it. Do not edit the JSON files directly. Direct edits will be overwritten the next time the adapter runs.

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
