# Step 3 Phase 3B 
Planning: Lore Ledger / Campaign Tracker  

## 1. Executive summary

Phase 3A delivered a read‑only **Builder Summary panel**, which presents derived species, class, background, level, proficiency bonus and ability totals for builder characters. The panel shows a note explaining that values are derived from builder data and are **not saved** into freeform fields【579307474528402†L154-L173】.  The current schema (`CURRENT_SCHEMA_VERSION 6`) stores builder metadata in `build` with fields `speciesId`, `classId`, `subclassId`, `backgroundId`, `level`, `abilityMethod`, `abilities.base` etc. All those fields default to `null` or safe values (`speciesId: null`, `classId: null`, `backgroundId: null`, `level: 1`)【211950611719071†L86-L101】.  The existing UI does **not** allow editing of builder fields, and no wizard, pickers, field locking or automation is implemented.

For Phase 3B we need a **small, safe implementation slice** that extends the builder feature without breaking freeform characters or future phases.  After reviewing options and the repository, the safest production‑grade next slice is to build a **minimal builder identity editor** that allows users to edit a few basic builder fields (species, class, background and level) via select controls using the existing built‑in content registry.  This avoids the complexity of a full wizard or automation and remains compatible with the existing rules engine.

## 2. Recommended Phase 3B slice

**Minimal builder identity editor panel**:

- Introduce a new panel on the Character page (e.g. “Builder Identity” panel) that appears only when a builder character is active.  The panel contains simple form controls for selecting **species**, **class**, **background**, and **level**.
- The options for species, class and background are populated from the existing built‑in content registry (`listContentByKind` and `BUILTIN_CONTENT_REGISTRY`【552102790453287†L55-L63】) which currently exposes SRD‑safe entries: human, dwarf, elf, fighter, cleric, wizard, acolyte, sage and soldier【933410215868844†L18-L93】.
- Level editing uses a number input or small picker constrained to a safe range (1‑20); it updates `build.level` without affecting HP/AC, abilities or spells.
- When a user changes a field, the panel uses `createStateActions().updateCharacterField()` to update nested fields in `build`【531862620773819†L269-L284】 and calls `notifyPanelDataChanged()` to refresh derived panels.  This ensures the mutation is localized and respects the existing state management.
- The panel does **not** lock or overwrite any freeform fields; builder summary continues to show derived values and still includes the existing “Derived from builder data” note【579307474528402†L154-L173】 to avoid user confusion.

This slice is safe because it introduces editing of only a small set of fields, leverages the existing data structures and mutation helpers, does not require schema changes, and keeps the boundary between builder and freeform characters clear.  Users will finally be able to select their character’s species, class, background and level while still having to edit flat fields manually for non‑builder characters.

## 3. Alternatives considered and why not

| Option | Why we rejected it |
| --- | --- |
| **1. Builder build editor shell only (UI skeleton without editing)** | It would show placeholder fields but not allow any real edits.  While it is safe, it provides almost no user value and could confuse users by presenting a seemingly editable panel that does nothing. |
| **3. Content registry / legal‑safe SRD planning slice** | This would only formalize what content is legal.  It does not improve the product or UI and can happen in parallel with the identity editor. |
| **4. Override/materialization strategy planning** | This is mostly design work and not visible to users.  It is important long‑term but does not deliver any interactive feature. |
| **5. Full builder wizard or ability editing** | A wizard that handles ability methods, ability scores, subclass selection, level‑up choices, spells and HP automation is far beyond the minimal safe slice.  It would introduce materialization concerns, field locking and complex flows that are not yet designed. |

## 4. Exact scope (what Phase 3B will do)

1. **New UI panel** – Add a “Builder Identity” panel to `index.html` and `styles.css` mirroring other panels.  It will be placed near the Builder Summary panel (either before or after) and visible only when the active character has a valid builder `build`.
2. **Panel initialization** – Create `initBuilderIdentityPanel` in a new file `js/pages/character/panels/builderIdentityPanel.js`.  This module will:
   - Import `createStateActions`, `getActiveCharacter`, `isBuilderCharacter`, `listContentByKind`, and `BUILTIN_CONTENT_REGISTRY`.
   - Use `requireMany` for DOM guard on elements like `#charBuilderIdentityPanel` and form controls.
   - Register listeners for ACTIVE_CHARACTER_CHANGED_EVENT and subscribe to `panelDataChanged` for its own key (e.g. `character-fields`) so it refreshes when state changes.
   - On refresh, hide the panel if the active entry is not a builder character or build data is missing. Otherwise populate selects with current selections and built‑in content names.
   - On select change, call `updateCharacterField(["build", "speciesId"], value)`, etc., and call `notifyPanelDataChanged()` to trigger re‑render of the builder summary.
3. **Character page wiring** – In `characterPage.js`, import `initBuilderIdentityPanel` and call it alongside existing panels.  Ensure the destroy function is stored and called appropriately.
4. **Index markup** – Add markup for the panel including accessible labels and `role`/`aria` attributes (similar to other panels).  Provide `id="charBuilderIdentityPanel"` and content region `id="charBuilderIdentityContent"` with labels for species, class, background and level.
5. **Styles** – Update `styles.css` to style the new panel and its form elements consistent with existing UI (inputs/selects).  Provide responsive styling for mobile.
6. **No changes to data schema** – The `build` structure remains unchanged (`version`, `ruleset`, `speciesId`, `classId`, `backgroundId`, `level`, `abilityMethod`, `abilities.base`, `choicesByLevel`)【211950611719071†L86-L101】.
7. **Use only built‑in content** – Options come exclusively from `BUILTIN_CONTENT`【933410215868844†L18-L93】.  No custom content or subclass IDs are displayed.

## 5. Explicit non‑goals

Phase 3B explicitly avoids:

- **No full wizard** – It will not implement multi‑step flows or level‑up logic.
- **No field locking** – Freeform fields (`classLevel`, `race`, `background`) remain editable.  The identity editor will not enforce mutual exclusivity or lock them.
- **No materialization** – Derived values continue to live only in the UI; `materializeDerivedCharacterFields()` remains unused.
- **No schema changes or migration** – We do not change `CURRENT_SCHEMA_VERSION` and do not add migrations.
- **No HP/AC/skill/save/spell/combat automation** – Editing level or classes will update derived values in the summary but will not automatically change HP, AC, skills or spells.
- **No subclass, subclass choices or ability score editing** – Subclass selection and ability base score editing remain deferred to later phases.
- **No linked card behavior changes** – Linking characters to NPC/Party cards behaves as before and will not sync builder selections.

## 6. UI plan

- **Placement** – Place the new panel directly above the Builder Summary panel so users can edit their builder choices and immediately see the updated summary.  Keep it collapsed into the same scroll area as other panels; include an accessible heading.
- **Controls** – Use `<select>` elements for species, class and background.  The first option should be “Not selected” (value `''` or `null`) to represent no choice.  A small `<input type="number">` or `<select>` for level with allowed values 1–20.  Provide labels for each control to support screen readers.
- **State binding** – On load and whenever the active character changes, the panel reads the current `build.speciesId`, `build.classId`, `build.backgroundId` and `build.level` from the active character.  It sets the corresponding selects/inputs accordingly.
- **Interactions** – When a select or number input changes, update the builder field via `updateCharacterField`.  Do not modify freeform fields.  After updating, call `notifyPanelDataChanged('character-fields')` so that the summary panel refreshes.  Optionally call `SaveManager.markDirty()` via the mutation helper (already done by `updateCharacterField`).
- **Accessibility** – Ensure all form controls have `aria-label` or `<label>` and the panel is properly labelled.  The panel should be hidden with `aria-hidden="true"` when no builder character is active.
- **Mobile/responsive** – Use CSS classes consistent with other panels for spacing.  Avoid wide tables; each control should stack vertically on narrow screens.

## 7. Data‑flow plan

- The panel obtains `state`, `SaveManager` and `Popovers` from `initCharacterPageUI` dependencies, similar to other panels.
- It calls `createStateActions({ state, SaveManager }).updateCharacterField` to change nested builder properties (e.g., `build.speciesId`, `build.classId`, `build.backgroundId`, `build.level`).  This function updates the active character and automatically queues saves【531862620773819†L269-L284】.
- After each mutation, the panel calls `notifyPanelDataChanged('character-fields')` (or a specific panel key) so that the builder summary and other interested panels refresh.  The summary panel already subscribes to `character-fields` changes【579307474528402†L256-L257】.
- The panel subscribes to `ACTIVE_CHARACTER_CHANGED_EVENT` to hide or refresh itself when the active character changes.
- The derived values shown in the summary panel continue to be computed by `deriveCharacter()`.  The identity editor does **not** materialize them into flat fields.  This avoids duplicate sources of truth.

## 8. Content registry / legal‑safety plan

- Phase 3B continues to use only built‑in SRD‑safe content.  The `BUILTIN_CONTENT` array exposes species (human, dwarf, elf), classes (fighter, cleric, wizard) and backgrounds (acolyte, sage, soldier)【933410215868844†L18-L93】.  These are annotated as `source: "builtin"` and `ruleset: "srd-5.2.1"`, ensuring only SRD content is exposed.
- The panel uses `listContentByKind(BUILTIN_CONTENT_REGISTRY, kind)`【552102790453287†L55-L63】 to retrieve the appropriate entries and sorts them by `name`.  Each option’s value is the `id` and the label is the `name`.
- There is no subclass or non‑SRD content available yet; user‑generated content remains out of scope.  Exposing user content requires legal and design review and should be deferred.
- As part of documentation, note that built‑in content labels are stable but may change in future SRD updates; the identity editor should not persist labels, only IDs.

## 9. Exact files likely to change

| File | Why it changes | What to add/change |
| --- | --- | --- |
| **`index.html`** | Add markup for the “Builder Identity” panel similar to existing panels.  Include a panel header, content region with selects and number input, and unique IDs (`#charBuilderIdentityPanel`, `#charBuilderIdentityContent`).  The panel should be hidden by default and only shown when builder mode is active. | Insert new `<div>` structure in the character page section.  Add new ARIA attributes and placeholders.  Ensure it is part of the DOM anchors validated by `requireMany`. |
| **`styles.css`** | Style the new panel and its controls.  Use existing panel classes for consistency, and style the `<select>` and `<input>` elements.  Provide mobile‑friendly layout. | Add CSS rules for `.builderIdentityPanel`, `.builderIdentityRow`, etc., or reuse existing classes for grid spacing. |
| **`js/pages/character/panels/builderIdentityPanel.js`** *(new)* | Contains the initialization logic for the identity editor.  Imports dependencies (`createStateActions`, `getActiveCharacter`, `isBuilderCharacter`, `listContentByKind`, `BUILTIN_CONTENT_REGISTRY`, `notifyPanelDataChanged`, `requireMany`, etc.), binds DOM, populates selects, handles changes, and cleans up listeners. | Implement `initBuilderIdentityPanel({ state, SaveManager, Popovers, setStatus })` returning a destroy API.  Use `updateCharacterField` to update builder fields and call `notifyPanelDataChanged` after changes. |
| **`js/pages/character/characterPage.js`** | Integrate the identity panel.  Import `initBuilderIdentityPanel` and call it in the page initialization.  Manage the destroy lifecycle like other panels. | Add `initBuilderIdentityPanel` import at top.  In `initCharacterPageUI`, call `initBuilderIdentityPanel` with dependencies and register its destroy function.  Ensure the panel is only initialized once per page render. |
| **`js/domain/rules/registry.js`** | No direct changes but might be referenced.  Ensure the registry exports remain unchanged. | None unless tests require exposing a helper for sorting. |
| **`tests/characterPage.test.js`** | Add tests verifying that the builder identity panel appears for builder characters and not for freeform characters, that the selects show the correct options, that selecting a value updates the builder field and triggers the summary panel to update. | Add DOM queries for the identity panel and controls.  Simulate user interactions (selecting species/class/background, changing level) and assert that `state.characters.entries[...].build` is updated and that summary labels reflect the change.  Ensure freeform fields stay unchanged. |
| **`tests/rulesEngine.test.js`** | Possibly extend tests verifying that editing builder fields updates derived values correctly (e.g., proficiency bonus for level). | Add tests that call `deriveCharacter()` after programmatically editing `build.level` and assert that the derived `level` and `proficiencyBonus` are correct.  No changes to automation. |
| **`docs/NEW-FEATURES-ROADMAP.md`** | Document the new Phase 3B feature and update progress. | Add a Phase 3B entry describing the builder identity editor and note that more advanced builder features (wizard, automation) remain future work. |
| **`docs/state-schema.md`** | Clarify that `build.speciesId`, `classId`, `backgroundId` and `level` can now be edited through the UI. | Amend the description of the builder fields to mention user‑editable status. |
| **`docs/MULTI-CHARACTER_DESIGN.md`** | Update Step 3 design section to mention the builder identity editor and its limitations. | Note that Step 3 now allows editing species/class/background/level but not ability scores, subclass or automation. |

## 10. Tests to add/update

1. **Builder identity panel visibility** – In `characterPage.test.js`, assert that the identity panel is hidden for freeform characters and visible for builder characters.  After creating a new builder character via the action menu, the panel should become visible.  When switching back to a freeform character, it should hide.
2. **Option population** – Verify that the species, class and background selects contain options corresponding to `BUILTIN_CONTENT` entries (IDs and names)【933410215868844†L18-L93】 and a “Not selected” option at the top.
3. **Initial value binding** – When a new builder character is created, all selects should default to “Not selected” and level should be `1` (reflecting the default build shape【211950611719071†L86-L101】).  If the build contains existing IDs, the selects should show those values.
4. **Field edits** – Simulate user changes to species/class/background/level using DOM events.  Assert that `state.characters.entries[activeIndex].build.speciesId` (etc.) is updated, and that `updateCharacterField` returns true.  After editing, the builder summary panel should display updated labels (e.g., when selecting “Elf” the summary shows “Elf” instead of “Not selected”).
5. **No flat‑field overwrite** – After edits, assert that freeform fields such as `classLevel`, `race`, `background` remain unchanged.  This prevents duplicate sources of truth.
6. **Derived values** – In `rulesEngine.test.js`, after editing `build.level` to e.g. 5, call `deriveCharacter()` and assert that `level` is 5 and `proficiencyBonus` is computed correctly (in 5e it should be +3).  Changing species or class should update labels but not cause errors.
7. **Active character switching** – When switching between characters, the identity panel should refresh correctly.  Tests should ensure no stale selections remain and that events do not leak (no double listeners).  Also test that closing and reopening the panel via UI toggles does not crash.
8. **Accessibility attributes** – Optionally test that the new panel and controls have `aria-label`/`aria-labelledby` attributes and that the panel hides with `aria-hidden="true"` when not applicable.
9. **Freeform preservation** – Add test verifying that editing builder fields does not break editing of freeform fields in other panels (e.g., editing the `Race` text field in the Basics panel remains independent of builder species selection).

## 11. Docs to update

- **NEW‑FEATURES‑ROADMAP.md** – Append a Phase 3B entry describing the builder identity editor, its purpose, and listing the fields it covers (species, class, background, level).  Note that it is intentionally limited and that further builder wizard work (ability scores, subclass, automation) will be handled in later phases.
- **MULTI‑CHARACTER_DESIGN.md** – Update Step 3 to mention that builder metadata can now be edited for identity fields.  Clarify that this does not materialize values into flat fields and that freeform fields remain editable.  Provide guidelines on using updateCharacterField() for nested builder mutations.
- **state‑schema.md** – Indicate that `build.speciesId`, `classId`, `backgroundId` and `level` are editable UI fields and describe their default `null`/`1` values【211950611719071†L86-L101】.  Mention that `subclassId`, `abilityMethod`, `abilities.base`, `choicesByLevel` remain unused in the UI at this stage.
- **builder-summary documentation** – Ensure that docs still emphasize that the builder summary panel is display‑only and that freeform fields are not updated【579307474528402†L154-L173】.

## 12. Risks and mitigations

1. **Duplicate sources of truth** – Editing builder fields while freeform fields remain editable can create conflicting data (e.g., freeform “Class/Level” field says “Cleric 5” but builder class is “Fighter”).  Mitigation: the summary panel already displays a note explaining that derived values are separate【579307474528402†L154-L173】.  Phase 3B should add a similar note near the identity panel or reference the summary note.  Field locking and materialization will be tackled in later phases.

2. **Exposing content before legal review** – The built‑in content is minimal SRD‑safe and is annotated as such【933410215868844†L18-L93】.  We should not import external content or user content yet.  Mitigation: restrict options to `BUILTIN_CONTENT_REGISTRY` only and document this decision.  Further expansion requires legal and design review.

3. **Editing level without automation** – Changing level will update proficiency bonus and derived ability totals but will **not** adjust HP, spells or other resources.  Users may be confused that some values update while others do not.  Mitigation: clearly state in the identity panel that only summary values update, and encourage users to adjust other fields manually in the appropriate panels.

4. **Rendering / event leakage** – The new panel will subscribe to active character change and panel data change events.  If not carefully destroyed, multiple listeners could accumulate.  Mitigation: follow existing patterns for `init*Panel` destroy functions and ensure each initialization returns a `destroy()` method that removes listeners.

5. **Mobile layout** – Additional fields could clutter the character page on small screens.  Mitigation: design the panel with responsive CSS, stacking controls vertically and using space efficiently.  Only essential fields are included; ability editing is deferred.

6. **Scope creep towards a wizard** – Users may expect the identity panel to handle subclass, ability scores, spells or HP.  Mitigation: clearly document and communicate that Phase 3B covers only species/class/background/level and that other features remain future work.

## 13. Recommended Codex implementation prompt

You are working in the Lore Ledger / CampaignTracker repo on the Refactoring branch.

Repository:
Lrmann818/CampaignTracker

Branch:
Refactoring

Use the latest local Refactoring branch state as source of truth.

Goal:
Implement Step 3 Phase 3B only: a minimal Builder Identity editor for builder characters.

This is a bounded UI/editing slice.
Do not implement a full builder wizard.
Do not implement ability editing.
Do not implement subclass editing.
Do not implement field locking.
Do not implement persisted materialization.
Do not implement HP, AC, saves, skills, spells, combat, or linked-card automation.
Do not change schema version.
Do not add migrations.
Do not refactor unrelated code.

Context:
Completed Step 3 work so far:
- Phase 1: schema v6 + pure rules-engine foundation
- Phase 1.1: shared override normalization + stricter builder detection
- Phase 2: minimal “New Builder Character” creation path
- Phase 2 polish: accessible informational Builder Mode badge
- Phase 3A: display-only Builder Summary panel

Current implementation facts:
- `CURRENT_SCHEMA_VERSION` is 6.
- Character entries have `build` and `overrides`.
- Freeform characters use `build: null`.
- Existing “New Character” remains freeform.
- “New Builder Character” creates a minimal valid builder build.
- Builder Summary panel is display-only.
- Builder Summary does not persist derived values.
- `deriveCharacter()` is pure.
- `materializeDerivedCharacterFields()` exists but must remain unused.
- Builtin content registry currently contains the only allowed content for this slice.

Important first step:
Before coding, inspect:
- the actual signature and usage pattern of `createStateActions().updateCharacterField`
- existing character panel lifecycle patterns
- existing panel invalidation/subscription patterns
- existing builtin registry exports and helper names
- existing `builderSummaryPanel.js` refresh behavior

Do not invent new state mutation APIs.
Use the repo’s actual existing nested-field update pattern.

Implementation requirements:

1. Add a Builder Identity panel to the Character page.
   - Add static markup in `index.html`.
   - Suggested IDs:
     - `charBuilderIdentityPanel`
     - `charBuilderIdentityContent`
     - `charBuilderSpeciesSelect`
     - `charBuilderClassSelect`
     - `charBuilderBackgroundSelect`
     - `charBuilderLevelInput` or `charBuilderLevelSelect`
   - Place it near the Builder Summary panel, preferably directly before Builder Summary so edits appear above the derived read-only output.
   - Hidden by default with `hidden` and appropriate `aria-hidden` behavior.
   - Include a short explanatory note:
     “These builder choices update the read-only Builder Summary only. Existing sheet fields remain editable.”

2. Add a new panel module:
   - `js/pages/character/panels/builderIdentityPanel.js`
   - Export `initBuilderIdentityPanel(deps)`.
   - Follow existing character panel lifecycle conventions.
   - Resolve the active character safely.
   - Use `isBuilderCharacter(activeCharacter)` to decide visibility.
   - Hide the panel for freeform characters or malformed build data.
   - Return a cleanup/destroy function if listeners are registered.

3. Controls:
   - Species select
   - Class select
   - Background select
   - Level control constrained to 1–20

Selection rules:
   - First option should be “Not selected” with empty value.
   - Selecting “Not selected” should store `null` in the relevant build field.
   - Non-empty selections should store the selected builtin content ID.
   - Level should store a number from 1 to 20.
   - Invalid level input should be clamped or rejected safely according to existing repo style.

4. Content source:
   - Use only the existing builtin content registry.
   - Use the existing registry/list helper names exactly as implemented.
   - Do not add new SRD content in this slice.
   - Do not copy SRD descriptive text into the UI.
   - Do not add custom content support.
   - Do not expose subclass choices.

5. State updates:
   - Use `createStateActions({ state, SaveManager })` or the existing character-page state action pattern.
   - Use the actual existing `updateCharacterField` API shape from the repo.
   - Update only:
     - `build.speciesId`
     - `build.classId`
     - `build.backgroundId`
     - `build.level`
   - Do not update:
     - `classLevel`
     - `race`
     - `background`
     - `proficiency`
     - ability fields
     - HP fields
     - AC fields
     - spell fields
     - tracker cards
     - combat state
   - Do not call `materializeDerivedCharacterFields()`.
   - Do not call mutation helpers during render/refresh; only mutate in response to user input.

6. Refresh behavior:
   - The panel should refresh when the active character changes.
   - After a successful builder field edit, notify the existing panel invalidation system so Builder Summary updates.
   - Use the existing notification key/pattern already used by Builder Summary or character panels.
   - Avoid duplicate event listeners across re-initialization.
   - Cleanup listeners in destroy.

7. Styles:
   - Add minimal scoped CSS in `styles.css`.
   - Keep visual style consistent with existing panels.
   - Avoid global input/select style changes.
   - Ensure mobile controls stack cleanly.

8. Tests:
   Add/update tests, preferably in `tests/characterPage.test.js`, covering:

   - Builder Identity panel is visible for builder characters.
   - Builder Identity panel is hidden for freeform characters.
   - Builder Identity panel is hidden or safely inert for malformed builder data.
   - Species/class/background options are populated from builtin registry IDs and labels.
   - New builder characters start with “Not selected” species/class/background and level 1.
   - Existing build values are reflected in the controls.
   - Editing species updates only `build.speciesId`.
   - Editing class updates only `build.classId`.
   - Editing background updates only `build.backgroundId`.
   - Editing level updates only `build.level`.
   - Selecting “Not selected” stores `null`.
   - Level cannot persist outside 1–20.
   - Builder Summary refreshes after builder identity edits.
   - Flat fields such as `race`, `classLevel`, `background`, `proficiency`, abilities, HP, and AC are not overwritten.
   - Existing fields remain editable and are not disabled/readonly.
   - Switching active characters refreshes/hides the identity panel without stale values.

   Add `tests/rulesEngine.test.js` coverage only if needed:
   - Programmatically changing `build.level` affects derived `level` and `proficiencyBonus`.
   - Changing species/class/background IDs changes derived labels without mutating the character.

9. Docs:
   Update only docs that actually need this Phase 3B status.
   Likely candidates:
   - `NEW-FEATURES-ROADMAP.md`
   - `MULTI-CHARACTER_DESIGN.md`
   - `docs/state-schema.md`
   - `docs/architecture.md`

   Documentation must clearly state:
   - Builder Identity editor can edit only species/class/background/level.
   - It uses builtin SRD-safe content IDs only.
   - It does not persist derived values into flat fields.
   - Existing freeform fields remain editable.
   - Full builder wizard, ability editing, subclass choices, field locking, HP/AC/spell automation, and custom content remain future work.
   - No schema change was made.

Verification:
Run:
- npm run typecheck
- npm run test:run
- npm run build

Also run a focused test if relevant:
- npx vitest run tests/characterPage.test.js
- npx vitest run tests/rulesEngine.test.js

Final output format:
1. Executive summary
2. Exact files changed
3. Builder Identity UI added
4. State update API/pattern actually used
5. Builtin content/registry behavior
6. How freeform behavior was preserved
7. How persisted flat fields were protected
8. Tests added/updated
9. Docs updated
10. Verification results
11. Risks/notes

