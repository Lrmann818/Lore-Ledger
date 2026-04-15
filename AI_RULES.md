# AI_RULES.md — Lore Ledger (Codex / VS Code / AI coding assistants)

This project is a modular, UI-heavy, client-side vanilla JavaScript PWA.
Stability, consistency, and backward compatibility are non-negotiable.

All AI coding assistants MUST follow these rules.

---

## 0) Prime directive

DO NOT break existing behavior.

This includes:

- Campaign Hub entry/return behavior
- Panel collapse / expand behavior
- Panel reordering controls
- SaveManager dirty-state & persistence
- Dropdown consistency
- Modal/focus behavior
- Mobile layout (no clipping, no horizontal scroll)
- Existing saved data loading correctly
- Backup/import/export reliability
- Installed PWA/browser behavior that already works

Minimal, targeted changes are always preferred over refactors.

---

## 1) Current app reality (source of truth)

Lore Ledger is now a Hub/campaign-first vanilla JS PWA.

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

Do not assume the app is only Tracker / Character / Map anymore.

---

## Character architecture

Step 1 multi-character support is complete and verified.

Before modifying character architecture, character state, character panels, combat embedded character panels, backup/import/export, or campaign vault persistence, read `MULTI-CHARACTER_DESIGN.md` in the project root. `STEP1_TASKS.md` is now a completed implementation record, not pending work.

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

## 2) Application structure

### Pages / workspaces

Known workspaces/pages may include:

- Campaign Hub
- `#page-tracker`
- `#page-character`
- `#page-combat`
- `#page-map`

Rule:

- Never change page/workspace switching logic without confirming all relevant routes, tabs, or entry flows still work.

---

## 3) Global UI contracts (DO NOT BREAK)

### Top bar

- Campaign title: `#campaignTitle` (contenteditable)
- Status messages: `#statusText`
- Clock: `#topbarClock`

Rules:

- Errors, save status, and feedback must continue to appear in `#statusText`.
- Do not replace this messaging system.

### Calculator & Dice

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

### Data / Settings / Support modal

Modal system:

- Overlay: `#dataPanelOverlay`
- Panel: `#dataPanelPanel`

Rules:

- Use the existing modal/overlay behavior.
- Do not add new modal frameworks.
- Do not break focus or keyboard behavior.

---

## 4) Panels (critical behavior)

### Panel identity

Panels use:

`<section class="panel" id="...Panel">`

Examples may include:

- `#sessionPanel`
- `#npcPanel`
- `#locationsPanel`
- `#charVitalsPanel`
- `#charSpellsPanel`

### Panel collapse

Collapse buttons:

`<button class="panelCollapseBtn" data-collapse-target="...">`

Rules:

- Collapsing removes vertical space.
- Panels below must scoot up naturally.
- Do not hide panels via `display: none` unless existing logic does.
- Preserve `aria-expanded`.
- Do not break masonry/reflow behavior.

### Panel reordering

Rules:

- Reorder controls MUST remain available where currently supported.
- Never remove reorder buttons when touching panel markup.
- Reordering must continue to work on all reorderable workspaces.

---

## 5) Campaign Hub rules

Rules:

- Hub is a first-class entry surface, not an afterthought.
- Do not treat Hub as just another normal page tab without verifying app entry behavior.
- Hub return actions must remain context-aware.
- Campaign selection/entry/return behavior must remain safe.
- Hub sound behavior must respect user settings and real browser autoplay limits.

---

## 6) Tracker workspace rules (`#page-tracker`)

### Columns

- `#trackerColumns`
- `#trackerCol0`
- `#trackerCol1`

Rules:

- Panels must stay inside columns.
- Do not flatten or restructure layout.

### Cards

Containers may include:

- NPCs: `#npcCards`
- Party: `#partyCards`
- Locations: `#locCards`

Rules:

- Cards are rendered dynamically.
- Event listeners must not multiply on re-render.
- Attach listeners during element creation.

### Location filtering & dropdowns

- Filter select: `#locFilter`

Rules:

- Location card dropdowns must visually match other dropdowns.
- If only ONE dropdown needs styling:
  - add a modifier class or data attribute
  - scope CSS to `.locationCard`
- Never globally style `select`.

---

## 7) Character workspace rules (`#page-character`)

### Columns

- `#charColumns`
- `#charCol0`
- `#charCol1`

Rules:

- Panels must remain column-based.
- Panels must remain reorderable.

### Character basics

Key inputs may include:

- `#charName`
- `#charClassLevel`
- `#charRace`
- `#charBackground`

Textareas with UI persistence:

`<textarea data-persist-size>`

Rule:

- Do not remove or bypass `data-persist-size`.

### Abilities & skills

Ability blocks:

`.abilityBlock[data-ability="str|dex|con|int|wis|cha"]`

Rules:

- Calculations must remain deterministic.
- Checkbox state must not desync values.
- Do not duplicate ability logic.

### Spells

- Container: `#spellLevels`
- Levels and spells are dynamically rendered.

Rules:

- Helper functions used by the spells UI must exist before use.
- Adding spells MUST:
  - update state
  - call `SaveManager.markDirty()`
  - re-render safely

---

## 8) Combat workspace rules (`#page-combat`)

Rules:

- Combat is a dedicated workspace with its own domain state.
- Combat-specific UI state must not be shoved into unrelated data structures.
- Embedded/shared panels must operate on canonical campaign/character data.
- Do not create copied panel data that later needs manual sync.
- Workspace layout/configuration is composition state, not the underlying data itself.
- Mobile layout matters heavily here: no clipping, no horizontal scroll, no unusable cramped controls.

---

## 9) Map workspace rules (`#page-map`)

### Canvas

- Canvas: `#mapCanvas`
- Wrapper: `.canvasWrap`

Rules:

- Do not recreate canvas unless required.
- Preserve undo/redo stacks.
- Image upload/remove must continue to work.
- Respect memory/performance constraints.

---

## 10) JavaScript rules (non-negotiable)

### State & persistence

- User-visible changes require `SaveManager.markDirty()`.
- New data fields must be backward compatible:

`obj.newField ?? defaultValue`

- Never break existing saved data.
- Migration changes must be append-only, defensive, and test-backed.
- Import/export must validate before mutating live state.

### Vanilla JS typing & boundaries

- This repo uses `@ts-check`, JSDoc, and `types/*.d.ts`, not a TypeScript rewrite.
- For new shared modules or edits inside already-hardened files, preserve or add `// @ts-check` where appropriate and keep boundary typedefs narrow.
- Reuse owner-defined types from `js/state.js`, `js/domain/*`, or nearby boundary modules instead of inventing broad anonymous object shapes.
- Keep runtime validation for persisted data, imports, files, and DOM lookups. Static types support those guards; they do not replace them.
- Do not claim repo-wide CheckJS is fully clean unless that has actually been verified in the codebase.

### Rendering & events

- Re-render means rebuild DOM + reattach listeners.
- Never attach listeners inside loops without guards.
- One click must equal one action.

### Errors

- Use the existing global error/status system.
- Fail soft.
- Do not silently swallow errors.

---

## 11) CSS rules (prevent self-overwriting)

### Scope first

Prefer:

- `.panel ...`
- `.locationCard ...`
- `.npcCard ...`
- page/workspace-scoped selectors where appropriate

### Targeting a single element

Add:

- `.isVariant`
or
- `data-variant="x"`

Then style narrowly.

### Avoid

- Global `select {}` rules
- Deep specificity chains
- CSS fixes dumped at the bottom without context
- Large CSS rewrites “for cleanliness”

### Mobile requirements

After any UI change:

- no clipped headers
- no horizontal scrolling
- no hidden critical controls
- tap targets stay usable

---

## 12) Accessibility minimums

- Buttons must have `type="button"` unless submitting a form.
- Inputs must remain focusable.
- Do not remove focus outlines without replacement.
- `aria-expanded` must reflect actual state.
- Do not break modal/dropdown keyboard behavior.

---

## 13) Hard bans

- No frameworks
- No TypeScript rewrite
- No storage format changes without migration
- No feature removal
- No large CSS rewrites “for cleanliness”
- No new modal framework
- No duplicating canonical data just to make a view easier

---

## 14) Required verification checklist

After any change, verify as applicable:

- Existing saved data loads
- Add/edit/delete still works
- Refresh persists changes
- Backup/import/export still works
- Mobile has no clipped headers
- No horizontal scrolling
- Console has no errors
- No duplicate event handlers
- PWA/browser behavior still works where relevant
- Related tests pass

When a change touches navigation, lifecycle, install/offline/update behavior, or major UI flows, also run the relevant broader verification path when available.

---

## 15) If uncertain

When in doubt:

1. Find the closest existing pattern
2. Match it exactly
3. Make the smallest possible change
4. Add defensive checks
5. Document assumptions

End of rules.
