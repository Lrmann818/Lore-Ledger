# Step 3 Phase 3A 
Planning — Builder-Derived Summary

## 1. Executive summary

Step 3 Phase 3A should be a small, display-only bridge between the rules engine foundation and the visible Character page UI.

The branch already has the important foundations in place:

- Schema v6 exists.
- Characters have `build` and `overrides`.
- Override normalization is shared.
- Builder detection is strict.
- Pure derivation modules exist.
- Existing **New Character** remains freeform with `build: null`.
- **New Builder Character** creates a minimal valid build object.
- The **Builder Mode** badge is informational and accessible.
- No builder wizard exists yet.
- No derivation is wired into visible panels yet.
- No materialization occurs.
- No field locking exists.

Phase 3A should introduce **read-only builder-derived summary values** for builder characters only. It should not change persisted flat character fields. It should not lock inputs. It should not introduce picker UI, a wizard, automation, or schema changes.

The safest production-grade slice is a new **Builder Summary** panel on the Character page that appears only for builder characters and displays a small set of computed values from `deriveCharacter()`.

---

## 2. Recommended Phase 3A scope

### Smallest safe slice

Add a display-only **Builder Summary** panel for builder-mode characters.

The panel should:

- Be visible only when the active character is a real builder character.
- Use strict builder detection, not loose “has any build-ish object” detection.
- Call derivation only to compute display values.
- Render read-only text, not inputs.
- Never write derived values back to persisted character state.
- Never call materialization helpers.
- Never disable or lock existing editable fields.

### First derived values to show

Show only stable, low-risk values that are already clearly represented by the current rules engine foundation:

- Builder class / level label
- Builder race/species label
- Builder background label
- Character level
- Proficiency bonus
- Six ability totals and modifiers, if already safely produced by `deriveCharacter()`

Recommended display examples:

- `Class & Level: Fighter 1`
- `Race: Human`
- `Background: Soldier`
- `Level: 1`
- `Proficiency Bonus: +2`
- `Strength: 15 (+2)`
- `Dexterity: 14 (+2)`

### Values to deliberately exclude for now

Do **not** show these yet:

- Saving throws
- Skills
- Spell attack bonus
- Spell save DC
- Prepared/known spell automation
- HP automation
- AC automation
- Hit dice automation
- Speed automation
- Equipment-derived calculations
- Combat-facing derived values
- Linked-card derived values

Those values are more likely to create user confusion because the existing flat fields are still editable and remain the source of truth for visible panels. Saving throws, skills, spells, HP, and AC also imply deeper automation than Phase 3A should ship.

---

## 3. UI placement and behavior

### Placement

Place the **Builder Summary** panel on the Character page near the top of the sheet, directly after the existing Basics panel and before Vitals.

Recommended order:

1. Basics
2. Builder Summary
3. Vitals
4. Remaining panels as currently arranged

This keeps the computed builder identity close to character identity without invading the existing editable fields.

### UI behavior

The panel should be hidden by default.

For freeform characters:

- The panel should not be visible.
- Existing panels should look and behave exactly as they do now.
- Existing editable fields remain the only visible character fields.
- No derived-only text should appear.

For builder characters:

- The panel appears as a read-only summary.
- The existing editable Basics, Vitals, Abilities, Skills, and other panels remain editable.
- The Builder Mode badge remains informational.
- The summary should use muted text or a small caption like “Derived from builder data.”

### Recommended markup concept

```html
<section id="charBuilderSummaryPanel" class="panel builder-summary-panel" hidden aria-label="Builder-derived character summary">
  <div class="panelHeader">
    <h2>Builder Summary</h2>
    <p class="muted">Read-only values derived from builder data.</p>
  </div>
  <div id="charBuilderSummaryContent" class="builder-summary-grid"></div>
</section>
```

This can be static markup in `index.html` or dynamically created by the panel initializer. Static markup is easier to test and keeps the DOM structure explicit.

---

## 4. Derivation/data-flow plan

### Should `characterPage` call `deriveCharacter()` directly?

Prefer **no**.

`characterPage.js` is already an orchestration-heavy file. Adding rules-engine details directly to it increases coupling and makes future phases messier.

Recommended approach:

- Add a small panel module: `js/pages/character/panels/builderSummaryPanel.js`.
- The panel module calls a small adapter/helper that wraps `deriveCharacter()`.
- `characterPage.js` only initializes the panel, the same way it initializes other panels.

### Recommended helper shape

A small adapter could live in the new panel module or in a domain-adjacent rules UI helper.

Example concept:

```js
export function getBuilderSummary(character) {
  if (!isBuilderCharacter(character)) return null;

  const derived = deriveCharacter(character);
  if (!derived || derived.mode !== "builder") return null;

  return {
    classLevel: derived.labels?.classLevel || "—",
    race: derived.labels?.race || "—",
    background: derived.labels?.background || "—",
    level: derived.level,
    proficiencyBonus: derived.proficiencyBonus,
    abilities: derived.abilities,
  };
}
```

This keeps UI code from depending on registry internals or the full derived object.

### Registry creation

Use the existing default registry path if `deriveCharacter()` already defaults to built-in content.

If a registry must be provided, pass the existing built-in registry from the rules module. Do **not** construct a new registry every render.

Recommended priority:

1. Use `deriveCharacter(character)` if it already has a safe default.
2. Otherwise use a module-level imported `BUILTIN_CONTENT_REGISTRY`.
3. Do not create custom registry wiring in Phase 3A.

### Missing or malformed build data

Missing or malformed builder data should behave as freeform:

- Return `null` summary.
- Hide the panel.
- Do not throw.
- Do not mutate the character.
- Do not “repair” build data in UI code.

Strict detection is important because malformed partial data must not accidentally activate builder UI.

---

## 5. Exact files likely to change

### `index.html`

Likely change: add a static Builder Summary panel after the Basics panel and before Vitals.

Why:

- Keeps the DOM explicit.
- Makes tests easier.
- Avoids dynamic panel insertion edge cases.

Expected addition:

- `#charBuilderSummaryPanel`
- `#charBuilderSummaryContent`
- Accessible label/caption explaining the values are derived/read-only

### `styles.css`

Likely change: add small scoped styles for the summary panel.

Why:

- The panel should look intentional and separate from editable fields.
- It should not look like a form users can edit.

Expected additions:

- `.builder-summary-panel`
- `.builder-summary-grid`
- `.builder-summary-row`
- `.builder-summary-label`
- `.builder-summary-value`

Keep styling minimal and scoped.

### `js/pages/character/characterPage.js`

Likely change: import and initialize the new panel.

Why:

- This file owns Character page setup and panel initialization.
- The new panel should participate in the normal page lifecycle.

Expected additions:

- Import `initBuilderSummaryPanel`.
- Call it during `initCharacterPageUI()`.
- Add returned teardown to the existing cleanup flow.
- Ensure it updates when active character changes or page rerenders.

### `js/pages/character/panels/builderSummaryPanel.js` — new file

Likely change: new panel controller module.

Why:

- Keeps derivation display concerns isolated.
- Avoids making `characterPage.js` directly responsible for rules-engine UI.

Expected responsibilities:

- Resolve active character.
- Check `isBuilderCharacter()`.
- Call `deriveCharacter()` through a small summary adapter.
- Render summary rows.
- Hide panel for freeform or malformed builder data.
- Return a cleanup function.

### `js/domain/characterHelpers.js`

Possibly no change.

Potential change only if a small helper is useful and belongs here, such as:

- `getActiveBuilderCharacter(state)`
- or a stricter exported builder guard if one is not already exported

Avoid adding UI-specific summary logic here.

### `js/domain/rules/deriveCharacter.js`

No change recommended.

Why:

- The derivation function is already pure and should remain a domain calculation module.
- Phase 3A should consume it, not expand it unless tests reveal a missing output.

Do not add materialization or UI concepts here.

### `tests/characterPage.test.js`

Likely change: add DOM/page tests for the new panel.

Why:

- The main risk is UI behavior and freeform regression.
- DOM tests should prove builder-only visibility and no persisted field overwrites.

### `tests/rulesEngine.test.js`

Maybe no change.

Only update if the summary adapter is exported from a rules-facing module and needs direct tests.

### `docs/state-schema.md`

Small optional docs update.

Expected note:

- Schema remains v6.
- Builder-derived summary is display-only.
- No derived values are persisted.

### `docs/architecture.md`

Small optional docs update.

Expected note:

- Character page now has a read-only builder summary panel.
- The panel consumes pure derivation and does not mutate state.
- Existing freeform panels remain editable and canonical for flat fields.

---

## 6. Tests to add/update

### DOM test: builder summary appears for builder characters

Suggested name:

```js
it("shows builder summary for builder characters", () => { ... })
```

Assertions:

- Active character has a valid `build` object.
- `#charBuilderSummaryPanel.hidden` is `false`.
- Panel text includes expected class/level label.
- Panel text includes expected race/species label.
- Panel text includes expected background label.
- Panel text includes expected proficiency bonus.

### DOM test: builder summary hidden for freeform characters

Suggested name:

```js
it("hides builder summary for freeform characters", () => { ... })
```

Assertions:

- Active character has `build: null`.
- `#charBuilderSummaryPanel.hidden` is `true`.
- No builder-derived summary text appears.

### DOM test: malformed build does not activate summary

Suggested name:

```js
it("does not show builder summary for malformed build data", () => { ... })
```

Assertions:

- Active character has malformed/empty build data.
- Strict builder detection rejects it.
- Summary panel remains hidden.

### DOM test: existing flat fields are not overwritten

Suggested name:

```js
it("does not overwrite persisted flat fields with derived summary values", () => { ... })
```

Setup:

- Builder character has a build class/level of something like `Fighter 1`.
- Persisted flat field `classLevel` contains a different user-entered value.

Assertions:

- `#charClassLevel.value` still equals the persisted flat value.
- Builder Summary displays the derived builder value separately.
- The input is not disabled or read-only.

### DOM test: summary updates when active character changes

Suggested name:

```js
it("updates builder summary when active character changes", () => { ... })
```

Assertions:

- Builder character selected: panel visible.
- Freeform character selected: panel hidden.
- Different builder character selected: panel text updates.

### Unit test: summary adapter returns null for freeform

If an adapter is exported:

```js
it("returns null summary for freeform characters", () => { ... })
```

### Unit test: summary adapter extracts only safe fields

If an adapter is exported:

```js
it("extracts only display-safe builder summary fields", () => { ... })
```

Assertions:

- Includes labels, level, proficiency, abilities.
- Does not expose saves, skills, spell automation, HP automation, AC automation, or materialized flat fields.

---

## 7. Explicit non-goals

Phase 3A must explicitly avoid:

- No field locking.
- No persisted materialization.
- No builder wizard.
- No class/race/background pickers.
- No level-up flow.
- No spell automation.
- No HP automation.
- No AC automation.
- No hit dice automation.
- No saving throw automation in visible panels.
- No skill automation in visible panels.
- No linked card behavior changes.
- No combat behavior changes.
- No import/export behavior changes.
- No schema change unless truly unavoidable.
- No migration.
- No hidden mutation of existing flat fields.
- No broad refactor of Character page panels.
- No changes to New Character freeform behavior.

---

## 8. Risks and mitigations

### Risk: accidental duplicate sources of truth

Displaying computed values beside editable flat values can confuse users.

Mitigation:

- Label panel clearly as “Builder Summary.”
- Add caption: “Read-only values derived from builder data.”
- Never place derived values inside existing editable inputs.

### Risk: computed values being mistaken for saved values

Users may expect the summary to update saved fields automatically.

Mitigation:

- Keep summary read-only.
- Keep existing fields editable.
- Use docs and UI caption to explain the separation.

### Risk: freeform regressions

Freeform characters are still core to the app and must not be disrupted.

Mitigation:

- Guard with `isBuilderCharacter()`.
- Hide the panel for `build: null`.
- Add tests for freeform and malformed builds.

### Risk: coupling UI panels directly to registry internals

The UI should not know how content registries store classes/races/backgrounds.

Mitigation:

- UI calls a summary adapter.
- Adapter calls `deriveCharacter()`.
- UI consumes only normalized summary fields.

### Risk: overbuilding Phase 3A into a hidden wizard

Adding derived display can tempt adding pickers, corrections, or auto-fill.

Mitigation:

- Keep the panel read-only.
- Do not add buttons beyond maybe informational help text.
- No inputs, no dropdowns, no mutation.

### Risk: materialization sneaks in

Someone may try to use `materializeDerivedCharacterFields()` to make display easier.

Mitigation:

- Explicitly ban materialization in the implementation prompt.
- Add tests that flat fields remain unchanged.

---

## 9. Implementation prompt for Codex

```text
You are working in the Lore Ledger / CampaignTracker repo on the Refactoring branch.

Use the latest pushed Refactoring branch as source of truth.

Goal:
Implement Step 3 Phase 3A only: a display-only Builder Summary panel for builder characters.

This is a small UI slice. Do not implement a builder wizard, pickers, field locking, persisted materialization, spell automation, HP automation, AC automation, linked card behavior changes, combat changes, schema changes, migrations, or broad refactors.

Context:
- schema v6 already exists
- characters have build and overrides
- strict builder detection exists
- deriveCharacter exists as a pure rules-engine function
- New Character remains freeform with build: null
- New Builder Character creates a minimal valid build object
- Builder Mode badge is informational and accessible
- existing verification has passed: npm run typecheck, npm run test:run, npm run build

Important first step:
Before coding, inspect the actual current shape returned by `deriveCharacter()` and the existing panel lifecycle patterns. Do not assume field names like `derived.labels`, `derived.mode`, or `derived.abilities` unless they actually exist. Build the summary from the real current derived object shape.

Implementation requirements:

1. Add a read-only Builder Summary panel on the Character page.
   - Place it after the Basics panel and before the Vitals panel.
   - Use a static `section` in index.html unless there is a strong repo-specific reason to inject it dynamically.
   - Suggested IDs:
     - `charBuilderSummaryPanel`
     - `charBuilderSummaryContent`
   - The panel must be hidden by default.
   - Add accessible text/label indicating the values are derived from builder data.

2. Create a new panel module:
   - `js/pages/character/panels/builderSummaryPanel.js`
   - Export `initBuilderSummaryPanel(deps)`.
   - Follow existing panel lifecycle patterns.
   - Resolve the active character safely.
   - Use `isBuilderCharacter(activeCharacter)` to decide whether to show the panel.
   - Call `deriveCharacter()` only for valid builder characters.
   - If derivation cannot produce a safe display summary, hide the panel.
   - Render read-only text rows only.
   - Return a cleanup/destroy function if listeners are registered.
   - Keep any summary adapter local to this module unless there is a clear testability reason to export it.

3. Display only these derived values, but only if they are already safely available from the current derivation result:
   - class/level label
   - race/species label
   - background label
   - level
   - proficiency bonus
   - ability totals/modifiers

If a label is unavailable because the build has null content IDs, show a clear placeholder like “Not selected” or “—”. Do not add picker UI to fix it.

4. Explicitly exclude:
   - saves
   - skills
   - spells
   - HP
   - AC
   - hit dice
   - combat values
   - linked card values

5. Do not mutate persisted character state.
   - Do not call materialization helpers.
   - Do not call state mutation helpers from the summary panel.
   - Do not write derived values into `classLevel`, `race`, `background`, `proficiency`, ability fields, or any other flat fields.
   - Do not disable, lock, or mark existing inputs readonly.

6. Update `js/pages/character/characterPage.js`.
   - Import and initialize `initBuilderSummaryPanel` with the other character panels.
   - Ensure it updates correctly when active character changes/rerenders.
   - Preserve existing freeform behavior.

7. Add minimal scoped CSS in `styles.css`.
   - Make the panel visually consistent with existing panels.
   - Use muted/read-only styling.
   - Avoid global style changes.

8. Add/update tests in `tests/characterPage.test.js`.

Required tests:
   - builder summary appears for builder characters
   - builder summary is hidden for freeform characters
   - malformed build data does not show the summary
   - summary does not overwrite existing persisted flat fields
   - existing editable fields remain editable and are not disabled/readonly
   - summary updates/hides when active character changes

9. Only update docs if needed:
   - `docs/architecture.md`: mention display-only Builder Summary panel
   - `docs/state-schema.md`: mention no schema change and no persisted derived fields

Verification:
Run and report results:
- npm run typecheck
- npm run test:run
- npm run build

Output format:
1. Executive summary
2. Exact files changed
3. What was added
4. Actual deriveCharacter shape used
5. How freeform behavior was preserved
6. How persisted fields were protected
7. Tests added/updated
8. Verification results
9. Risks/notes
```
