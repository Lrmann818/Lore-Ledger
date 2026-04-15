# CLAUDE.md — Lore Ledger / Campaign Tracker

Lore Ledger is a production-quality vanilla JavaScript PWA for tabletop RPG campaign management.

No framework. No TypeScript rewrite. No large refactors without a plan.

The goal is a stable, polished, offline-capable, installable, portfolio-grade SPA with clean architecture, safe persistence, versioned migrations, backups, support tooling, and disciplined feature growth.

---

## Commands

- `npm run dev` — Start Vite dev server
- `npm run build` — Production build to `dist/`
- `npm run test` — Run Vitest in watch mode
- `npm run test:run` — Run Vitest once
- `npm run verify` — Run the full verification gate when available
- Playwright smoke tests may run in CI and must not be bypassed casually

---

## Prime Directive

Do not break existing behavior.

Stability, consistency, backward compatibility, saved-data safety, mobile layout, and PWA behavior are non-negotiable.

Prefer minimal, targeted changes over broad refactors.

---

## Current Product Shape

Lore Ledger is now a Hub/campaign-first app, not just a single campaign page.

Major surfaces include:

- Campaign Hub
- Tracker workspace
- Character workspace
- Combat workspace
- Map workspace
- Data / Settings / Support modal
- PWA install/offline/update behavior
- Backup/import/export/debug support flows

Treat campaign data, app-level data, UI layout state, and combat/session state as separate concerns.

---

## Character Architecture

Step 1 multi-character support is complete and verified. See `MULTI-CHARACTER_DESIGN.md` in the project root before modifying character state, character panels, combat embedded character panels, backup/import/export, or campaign vault persistence.

Do not reintroduce the legacy singleton `state.character` model outside migration/backward-compatibility handling. Active character data lives in `state.characters.entries`, selected by `state.characters.activeId`; panels resolve it through `getActiveCharacter(state)` and writes go through state action helpers such as `mutateCharacter(...)` and `updateCharacterField(...)`.

Combat embedded Vitals, Spells, and Weapons / Attacks panels are live views of the canonical active character data, not snapshots or a separate sync store.

---

## Architecture

- `app.js` — Composition root. Wires dependencies and injects them downward. Nothing imports `app.js`.
- `index.html` — Static DOM shell and persistent app structure.
- `styles.css` — Single global stylesheet. Scope changes carefully.
- `js/state.js` — Single mutable state object, schema defaults, migrations, save sanitization.
- `js/domain/stateActions.js` — Centralized state mutation helpers and prototype-pollution guards.
- `js/storage/` — Persistence, backup/import/export, IndexedDB blobs/texts, save lifecycle.
- `js/pages/` — Page/workspace modules.
- `js/ui/` — Shared UI systems: dialogs, popovers, navigation, theme, topbar, modals, layout helpers.
- `js/features/` — Cross-cutting features such as autosize, cropper, portrait flow.
- `js/audio/` — App sound helpers. Must respect browser autoplay/PWA limits.
- `tests/` — Vitest unit/regression tests and Playwright smoke coverage.
- `types/` — Shared JSDoc/type boundary declarations.

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
- New fields must use defensive defaults, such as `value ?? defaultValue`.
- Migrations are append-only and versioned.
- Any storage-shape change needs migration coverage.
- Import/export must validate data before touching live state.
- Backup restore must fail soft and preserve user trust.
- Campaign-scoped data must not be silently mixed with app-level settings.
- Combat/workspace layout state must not duplicate canonical campaign data.

---

## UI Contracts

### Top Bar

- Campaign title: `#campaignTitle`
- Status text: `#statusText`
- Clock: `#topbarClock`

Use the existing status/error system. Do not replace it.

### Dropdowns

Calculator:

- `#calcBtn`
- `#calcMenu`

Dice:

- `#diceBtn`
- `#diceMenu`

These are dropdowns, not modals. Preserve `aria-expanded` and `[hidden]`.

### Data / Settings / Support Modal

- Overlay: `#dataPanelOverlay`
- Panel: `#dataPanelPanel`

Use the existing modal system. Do not add another modal framework.

### Panels

Panels use:

`<section class="panel" id="...Panel">`

Collapse buttons use:

`<button class="panelCollapseBtn" data-collapse-target="...">`

Panel collapse must:

- preserve `aria-expanded`
- remove vertical space naturally
- not break masonry/reflow behavior
- not remove reorder controls

Panel reordering must continue to work on all reorderable workspaces.

---

## Workspace Rules

### Campaign Hub

- Hub is the campaign-first entry surface.
- Do not treat Hub as just another tracker tab.
- Campaign selection/entry behavior must remain safe.
- Hub sounds must respect browser autoplay restrictions and user settings.

### Tracker Workspace

- Preserve column layout.
- Cards are rendered dynamically.
- Attach card listeners during element creation.
- Do not multiply event listeners on re-render.
- Do not globally style dropdowns/selects to fix one card type.

### Character Workspace

- Preserve column layout and reorderability.
- Preserve `data-persist-size` textareas.
- Ability/skill calculations must remain deterministic.
- Do not duplicate ability/spell logic.
- Adding/editing spells must update state, mark dirty, and re-render safely.

### Combat Workspace

- Combat is a dedicated workspace with its own domain state.
- Embedded panels must use canonical campaign/character data directly.
- Do not create copied panel data that needs syncing later.
- Workspace layout/configuration is UI composition state, not domain data.
- Removing an embedded panel removes the view, not the underlying data.
- Mobile layout matters heavily here: no clipping, no horizontal scroll, no cramped unusable controls.

### Map Workspace

- Preserve `#mapCanvas` and `.canvasWrap`.
- Do not recreate canvas unless required.
- Preserve undo/redo behavior.
- Preserve image upload/remove behavior.
- Be careful with memory use and large images.

---

## JavaScript Rules

- Use plain ES modules.
- Use `@ts-check` and JSDoc where the repo already expects it.
- Do not add `.ts` files.
- Do not perform a TypeScript rewrite.
- Do not change runtime behavior when the task is only type cleanup.
- Keep typedefs narrow and close to the boundary.
- Reuse existing state/domain typedefs.
- Runtime validation still matters even with JSDoc.
- Do not claim CheckJS is clean unless verified.

---

## CSS Rules

- Scope first.
- Prefer component/page selectors.
- Avoid global element rules like `select {}` unless intentionally app-wide.
- Do not dump unrelated CSS fixes at the bottom of `styles.css`.
- Avoid large CSS rewrites for cleanliness.
- Mobile must have:
  - no horizontal scrolling
  - no clipped headers
  - no hidden controls
  - usable tap targets

---

## Accessibility Rules

- Buttons must use `type="button"` unless submitting a form.
- Inputs must remain focusable.
- Do not remove focus outlines without replacement.
- `aria-expanded` must reflect real state.
- Modals/dropdowns must preserve keyboard and focus behavior.

---

## Testing and Verification

After changes, run the smallest relevant test first, then broader verification when appropriate.

Expected checks may include:

- targeted Vitest file
- `npm run test:run`
- `npm run build`
- `npm run verify`
- Playwright smoke tests when UI/navigation/PWA behavior changes

Manual verification should cover:

- existing saved data loads
- add/edit/delete still works
- refresh persists changes
- mobile has no clipping
- no horizontal scroll
- console has no errors
- no duplicate event handlers
- PWA/browser behavior still works where relevant

Do not report “fully green” unless the command actually passed.

---

## Change Discipline

For small fixes:

1. Identify the nearest existing pattern.
2. Match it.
3. Make the smallest correct change.
4. Add defensive checks.
5. Verify.

For larger changes:

- If more than about 3 files are affected, stop and explain the plan first.
- Do not refactor unrelated code.
- Do not remove features.
- Do not change storage format without migration.
- Do not introduce frameworks, new modal systems, or broad styling systems.

---

## SRD / Rules Content

Lore Ledger may include SRD-compatible/reference content only when licensing and attribution are handled correctly.

- Prefer the current green-list approach.
- If content is not confirmed as allowed SRD content, treat it as custom user-added content.
- Do not add protected/non-SRD content by default.
- Keep attribution/license text accurate when SRD material is included.

---

## Output Expectations

When reporting work, use:

1. Executive summary
2. Exact files changed
3. What changed and why
4. Verification performed
5. Remaining risks or follow-ups

Be honest about anything not verified.
