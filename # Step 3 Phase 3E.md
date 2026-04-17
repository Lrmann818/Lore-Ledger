# Step 3 Phase 3E
 – Planning to Make the Abilities & Skills Modal Builder‑Aware

1. Executive summary

The Lore Ledger / Campaign Tracker application is part‑way through a multi‑phase Step 3 refactor introducing a rules engine and a character builder.  Phases 1–3D implemented a new build structure and overrides bag, a manual builder‑mode abilities editor (builderAbilitiesPanel.js), display‑only builder summary, and integration of derived builder ability totals/modifiers into the normal Abilities & Skills panel.  So far, builder characters edit base ability scores through a temporary builder panel and view derived totals in the standard sheet; overrides are stored separately and not materialized into free‑form fields ￼.  The existing Abilities & Skills panel (in abilitiesPanel.js) still operates only on free‑form characters, using saveOptions, skills, and abilities fields and ignoring the builder overrides bag.  Step 3 Phase 3E aims to make the existing Abilities & Skills modal (save‑options dropdown and per‑skill editor) builder‑aware without changing the schema or adding new UI scaffolding.  The goal is to let builder characters adjust their derived ability totals using the existing modal controls, store those adjustments in overrides, and display the combined result on the sheet, while keeping free‑form behaviour unchanged.

This document answers key questions about the current modal, summarises current builder behaviour, proposes a source‑of‑truth model for adjustments, outlines user‑facing changes, details state‑write and validation strategies, explains how modifiers/saves/skills/initiative will be affected, and provides testing and documentation plans, risks, and non‑goals.  The recommended Phase 3E slice uses the existing modal UI but redirects its reads/writes for builder characters to the build and overrides structures exposed by deriveCharacter() ￼, ensuring that derived values remain the primary source of truth.

2. Current modal behaviour (free‑form)

Opening the modal

The Abilities & Skills panel is rendered by abilitiesPanel.js.  It exposes two popover‑based “modal” interactions:
	•	Save‑options dropdown: Clicking the cog button (#saveOptionsBtn) opens a dropdown menu (#saveOptionsMenu).  Inside this menu, numeric inputs (#miscSave_str, etc.) edit per‑ability save misc bonuses, and a select box (#saveModToAllSelect) chooses one ability modifier to apply to all saves ￼.  The dropdown is registered with the Popovers API so that it behaves like a modal overlay (closes on outside click, ESC, etc.).
	•	Per‑skill editor: Each skill row has a button created by ensureSkillMenuButton().  Clicking it opens a popover menu built by buildSkillMenu(), allowing the user to toggle half/proficient/expert levels and to adjust a misc bonus via a numeric input ￼.

There is no separate large modal for abilities; the “modal” language refers to these popovers that handle misc adjustments and proficiency levels.

Data edited and state paths written

For free‑form characters (no build), the modal reads and writes the following fields:
	•	Ability score and save proficiency: Each ability block contains a numeric input for score and a checkbox for saveProf.  When the user types in scoreInput, createAbilityRecalc() writes the number to character.abilities[key].score and recalculates the modifier and save ￼.  Toggling saveProfInput writes to character.abilities[key].saveProf ￼.
	•	Save misc and mod‑to‑all: The save‑options dropdown reads/writes character.saveOptions.misc[ability] and character.saveOptions.modToAll.  Editing an input sets the misc value and recalculates saves ￼.
	•	Skill proficiency and misc: The per‑skill menu ensures a persistent skillState record.  Toggling half/prof/expert updates skillState.level, and typing in the misc input updates skillState.misc ￼.  The recalculation writes the computed total to skillState.value ￼.

Effects on displayed values
	•	Displayed ability score: For free‑form characters, the scoreInput.value is the canonical score.  Changing it immediately affects the displayed modifier and save totals via createAbilityRecalc() ￼.
	•	Displayed ability modifier: Calculated directly from the ability score using computeAbilityMod(score) ￼.
	•	Save totals: Computed as abilityMod + profBonus (if proficient) + misc, where misc comes from character.saveOptions.misc and modToAll adds another ability’s modifier ￼.
	•	Skill totals: Computed as abilityMod + proficiencyAddForSkillLevel(level, profBonus) + misc.  misc comes from skillState.misc and level from skillState.level ￼.
	•	Ranges and resets: The modal does not impose a 1–20 cap.  Users can enter values beyond 20 and negative misc bonuses.  Inputs can be cleared or set to zero to remove the effect.

3. Current Phase 3D builder behaviour
	•	Displaying derived abilities: When a character has a build object (builder mode), the Abilities & Skills panel uses getBuilderAbilityDisplayForKey() and getBuilderDerivedAbilityDisplay() to fetch derived ability totals and modifiers from deriveCharacter() and displays them in place of free‑form scoreInput and mod values ￼.  The input is disabled and marked as read‑only with a tooltip “Controlled by Builder Abilities” ￼.
	•	Editable controls: Save proficiency checkboxes remain enabled.  Skill proficiency and misc controls remain available.  Save‑options dropdown still shows misc and mod‑to‑all fields.
	•	Outcome of opening the modal: When a builder character opens the save‑options dropdown or a skill menu, the modal reads the existing character.saveOptions and skills fields rather than derived values.  However, deriveCharacter() ignores saveOptions and skills.misc for builder characters and instead uses overrides.saves and overrides.skills to compute totals ￼.  As a result, adjusting save misc or skill misc in the modal currently has no effect on builder characters’ displayed totals, and editing scoreInput is disabled.  Changes still mutate free‑form saveOptions or skills, which is undesirable because builder characters should not rely on those fields.

4. Recommended Phase 3E source‑of‑truth model

Phase 3E should treat the builder engine’s derived values and overrides as the authoritative source for the modal.  The recommended model is:
	•	Base ability score: Read from deriveCharacter(character).abilities[key].base.  This comes from build.abilities.base for builder characters ￼.
	•	Total ability score: The number typed in the modal should represent the desired final ability score (base + adjustment).  The panel must compute the delta between the typed value and the derived base and store it in character.overrides.abilities[key].  If the delta is 0, the override should be deleted or set to 0 (normalisation will treat 0 as absent) ￼.
	•	Save misc and global mod: For builder characters, the modal should ignore character.saveOptions.  Instead, numeric inputs represent overrides.saves[key], and the “mod‑to‑all” select should be disabled or hidden because builder saves should not apply a different ability’s modifier to all saves (unless future rules require it).  Each save override adds directly to total in deriveCharacter() ￼.
	•	Skill misc and proficiency: The per‑skill menu should treat the misc input as overrides.skills[skillKey] rather than skillState.misc.  When the user selects half/prof/expert, the modal should continue to write to skills[skillKey].level for now.  deriveCharacter() will read the proficiency level from skills and the override from overrides.skills ￼.  Existing misc stored in skills[skillKey].misc should be ignored for builder characters.
	•	State shape: The existing build and overrides structures are sufficient; no new schema fields are needed.  Avoid writing to flat abilities, saveOptions, or skills.misc for builder characters.  Use updateCharacterField() to write overrides.abilities, overrides.saves, and overrides.skills to ensure nested state paths are created safely.

5. User‑facing modal behaviour for builder characters

The modal should remain unchanged for free‑form characters.  For builder characters:
	•	Opening the modal: The same UI is used, but it should display builder‑derived values.  The ability scoreInput shows the current total (base + override) and is editable.  A note or tooltip is optional; product direction discourages new indicators, so reuse existing accessibility attributes where possible.
	•	Editing ability totals: Typing a value in scoreInput for a builder character adjusts the final ability score.  The underlying base (from the builder panel) is not mutated.  Instead, the system computes override = typedValue – derivedBase and writes it to overrides.abilities[key].  Displayed modifier and save totals update immediately via deriveCharacter().
	•	Resetting ability adjustments: Setting the total equal to the derived base (e.g., typing “15” when base is 15) should remove the override (store 0 or delete).  Clearing the input or leaving it blank should also reset to base.
	•	Save misc and mod‑to‑all: The save‑options dropdown should treat each misc input as overrides.saves[key].  The “mod‑to‑all” select should either be hidden or kept visible but disabled for builder mode.  Setting a value to 0 resets the override.
	•	Skill misc: In the per‑skill menu, the misc input should map to overrides.skills[skillKey].  Changing the proficiency level still writes to skills[skillKey].level.  Resetting the input (empty or “0”) removes the override.
	•	No new UI or badges: Do not add new override buttons, modals, or “overridden” indicators.  The final displayed score should simply be the combination of builder base and the override.  Users can open the modal to inspect or change adjustments.

6. State write strategy
	•	Free‑form characters: Continue writing to character.abilities[key].score, character.abilities[key].saveProf, character.saveOptions.misc, character.saveOptions.modToAll, character.skills[skillKey].misc, and character.skills[skillKey].level.  Do not modify overrides or build.
	•	Builder characters:
	•	Ability overrides: On modal save/input, call updateCharacterField(characterId, ["overrides", "abilities", key], delta) where delta = typedScore – derivedBase.  If delta =0, call updateCharacterField to write 0 or delete the property (depending on normalisation strategy).  Do not write to character.abilities[key].score.
	•	Save overrides: For each ability key, map the misc input to updateCharacterField(characterId, ["overrides", "saves", key], miscValue).  Do not write to saveOptions.misc.  Disable or ignore modToAll for builder mode.
	•	Skill overrides: When editing a skill misc bonus, compute the override as typedMisc and store it in overrides.skills[skillKey] using updateCharacterField.  Continue writing proficiency level to skills[skillKey].level.  Do not write to skills[skillKey].misc.
	•	Initiative overrides: The modal does not currently expose initiative adjustments.  If the ability override indirectly changes initiative (via Dexterity modifier), deriveCharacter() will handle it by combining the Dex modifier with overrides.initiative ￼.

7. Validation and range strategy
	•	Numeric validation: Reuse existing input handling.  scoreInput accepts any numeric value; for builder characters, treat it as total.  Do not enforce a 1–20 cap.  If the existing free‑form modal allowed values above 20, builder adjustments should allow totals above 20 as well.  Negative overrides (penalties) should be allowed by allowing typed values below the base.
	•	Misc inputs: Accept any finite number (positive or negative).  Coerce non‑numeric or empty input to 0.  Clearing an input resets the override.
	•	Consistency with existing modal: Preserve placeholder text, CSS classes, and ARIA attributes.  For builder characters, set aria-readonly on fields that are truly read‑only (e.g., free‑form base ability) but allow editing on the combined total field.

8. Impact on modifiers, saves, skills, and initiative

deriveCharacter() already combines base values and overrides:
	•	Ability totals and modifiers: For each ability, total = base + override and modifier = floor((total – 10)/2) ￼.  Updating overrides.abilities will automatically change the displayed modifier.
	•	Saves: For builder characters, deriveCharacter() calculates saves[key].total using the ability modifier, proficiency bonus (from class), and overrides.saves[key] ￼.  Because freeformSaveOptionsBonus() is bypassed for builder characters ￼, removing saveOptions in favour of overrides ensures that changes through the modal now affect save totals.
	•	Skills: Each skill’s total is abilityMod + proficiencyAddForSkillLevel(level, profBonus) + misc + override ￼.  For builder mode, the modal should set override equal to the typed misc value and ignore skills[skillKey].misc.  Changing the ability override automatically updates skill totals because the ability modifier flows through.
	•	Initiative: Initiative is computed as Dexterity modifier plus overrides.initiative ￼.  Changing a builder ability override on Dexterity will automatically adjust initiative.  The modal does not need a separate initiative control.

9. Testing plan

Tests should cover both free‑form and builder cases using vitest.  Suggested cases:
	1.	Free‑form baseline: Verify that opening the save‑options dropdown and skill menu behaves exactly as before for a character without build: editing ability score updates character.abilities[key].score, editing misc save writes to saveOptions.misc, and editing skill misc writes to skills[skillKey].misc.  Confirm totals update and resets set values to zero.  These tests assert unchanged behaviour.
	2.	Builder modal read behaviour: For a builder character with base ability 15 and no overrides, open the modal and assert that scoreInput.value shows 15.  Ensure that no flat abilities[key].score is mutated when the modal opens.
	3.	Builder ability adjustment: For the same character, type 18 in the ability score field and close/save.  Assert that character.overrides.abilities[key] becomes 3 and that character.abilities[key].score remains unset.  Confirm that deriveCharacter() returns a total of 18 and the modifier reflects the change.
	4.	Builder ability reset: Change the ability back to 15 and verify that the override is removed or set to 0.  Confirm deriveCharacter() returns a total equal to the base and there is no lingering override.
	5.	Builder save adjustment: In the save‑options dropdown, set the Strength save misc to 2.  Assert that overrides.saves.str is 2 and that saveOptions.misc.str remains unchanged.  Confirm that the displayed save total increases by 2 in the panel.
	6.	Builder skill misc adjustment: In a skill menu (e.g., athletics), set misc to +1 and verify that overrides.skills.athletics is 1.  Confirm that skills.athletics.misc is unchanged and deriveCharacter() computes the total using the ability modifier plus proficiency plus the override.
	7.	Switching between characters: Switch from a builder character to a free‑form character and back.  Ensure that overrides persist and that the free‑form modal still writes to flat fields.
	8.	Malformed builder data: Test that missing build.abilities.base values default to 0.  Setting an override in the modal still produces the correct total.
	9.	Combat embedded panel: If the combat view reuses the same Abilities & Skills UI, verify that builder overrides propagate correctly in the embedded context.
	10.	No materializeDerivedCharacterFields() usage: Ensure that the tests never call materializeDerivedCharacterFields().  All adjustments should be purely within build and overrides.

10. Documentation plan

Documentation updates should accompany this phase:
	•	docs/state-schema.md: Clarify that for builder characters, the Abilities & Skills modal writes ability adjustments to overrides.abilities, save misc bonuses to overrides.saves, and skill misc bonuses to overrides.skills.  Note that saveOptions and skills[skillKey].misc remain free‑form constructs and are ignored during builder derivation ￼.
	•	docs/architecture.md: Update the description of Phase 3D/E to state that the normal sheet now fully consumes builder overrides via the existing modal.  Mention that base scores remain editable only through the temporary builder panel and that the normal modal now represents adjustments on top of the base ￼.
	•	NEW-FEATURES-ROADMAP.md: Add a line under Step 3 Phase 3E describing that the Abilities & Skills modal has been made builder‑aware and that future phases will retire temporary builder panels when the normal sheet becomes fully builder‑powered.
	•	User‑facing help or tooltips: If any tooltips or inline help exist for the save‑options dropdown, add a note that builder mode uses these fields to apply adjustments rather than editing base values.

11. Risks and tradeoffs
	•	Duplicate sources of truth: If Phase 3E accidentally writes builder adjustments into both overrides and flat fields, it may create conflicting totals.  Clear separation—overrides for builder, flat fields for free‑form—is essential.
	•	Misinterpreting base vs adjustment: Users may not realise that typing in the ability field for a builder character is adjusting the total, not changing the base.  Without a new indicator this could cause confusion.  A tooltip or placeholder text may mitigate this while respecting product direction to avoid new visible indicators.
	•	Reusing saveOptions shape: The existing saveOptions object is not used by the rules engine for builder characters ￼.  Writing builder adjustments into saveOptions would have no effect.  The plan requires writing into overrides.saves instead.
	•	Validation conflicts: The builder abilities panel enforces a 1–20 base score, but the modal will allow totals beyond 20.  This could result in unrealistic scores.  However, the rules engine already allows totals above 20 if overrides exist and does not clamp them; preserving this flexibility avoids data loss.
	•	Combat embedded panel: If the combat panel reuses saveOptions or skill misc values, it must be updated to read overrides for builder characters.  Failure to do so could lead to inconsistent combat values.
	•	Legacy code assumptions: Parts of abilitiesPanel.js assume that ability score inputs directly reflect character.abilities[key].score.  Adapting this for builder mode must ensure that free‑form code paths are not accidentally triggered.  Thorough testing is required.

12. Explicit non‑goals
	•	No new schema or UI: Phase 3E does not introduce new fields or user‑visible controls.  It reuses the existing modal UI to handle builder adjustments and stores them in overrides.
	•	No full builder wizard: The builder character wizard (species/class/background selection, subclass choices, auto‑selected feats, etc.) remains future work.  Phase 3E focuses only on making the existing modal builder‑aware.
	•	No automatic upgrade of existing characters: Migrated free‑form characters remain in free‑form mode unless explicitly converted to builder mode through the existing “New Builder Character” path.
	•	No materialization of derived values: The work does not call materializeDerivedCharacterFields().  Derived totals remain unpersisted and are computed on the fly ￼.
	•	No changes to proficiency bonus, spells, attacks, or other panels: Only the Abilities & Skills modal is affected.

13. Implementation‑ready checklist

The following tasks outline the concrete steps for implementing Phase 3E.  Each item is non‑invasive and follows the product direction and current architecture:
	1.	Refactor abilitiesPanel.js modal logic to be builder‑aware:
	•	When building the ability block for a builder character, treat scoreInput as the final total rather than the base.  On input, compute the delta between the typed value and the derived base (via deriveCharacter()) and call updateCharacterField() to write to overrides.abilities[key].  For free‑form characters, maintain existing behaviour of writing to abilities[key].score ￼.
	•	When recalc is triggered for a builder ability, display derivedTotal (base + override) in the input and compute the modifier accordingly.  Avoid writing to abilityState.score or skillState.value when builderOwned is true ￼.
	2.	Modify save‑options dropdown:
	•	Detect builder mode.  If builder, call readSaveOptionsShape() only to read shape for free‑form characters; for builder characters, read overrides.saves for initial values.  On input, write values to overrides.saves instead of saveOptions.misc.  Consider disabling the “mod‑to‑all” select or ensure it writes only to free‑form saveOptions.modToAll and does not affect builder totals ￼.
	3.	Update per‑skill menu:
	•	When opening a skill menu, read the existing misc override from overrides.skills[skillKey] and display it in the input.  On change, write the value to overrides.skills[skillKey].  Continue using skills[skillKey].level for proficiency.  Do not write to skills[skillKey].misc for builder characters.
	4.	Update recalc functions:
	•	In createAbilityRecalc(), ensure that for builder characters the recalc function reads the derived base and override from deriveCharacter() and uses them to compute totals.  When marking dirty, write only saveProf to abilities[key] and avoid updating score or skillState.value when builderOwned is true ￼.
	5.	Ensure normalization:
	•	Update characterHelpers.js or normalizeCharacterOverrides() to treat zero overrides as equivalent to missing entries to avoid persisting extraneous 0 properties.  Ensure updateCharacterField() can delete keys when writing undefined or null.
	6.	Add builder checks in combat embedded panels:
	•	If the combat UI reuses saveOptions and skill misc values, update it to read overrides when isBuilderCharacter() is true.  This ensures consistency between the character sheet and combat view.
	7.	Write comprehensive tests:
	•	Implement the testing plan described above using vitest with builder and free‑form characters.
	8.	Update documentation:
	•	Revise docs/state-schema.md, docs/architecture.md, and NEW-FEATURES-ROADMAP.md as described in the documentation plan.
	9.	Code review and iterative refinement:
	•	Seek feedback on the new builder‑aware modal to ensure usability.  Address edge cases such as negative overrides, missing base scores, and switching between builder and free‑form characters.  Avoid introducing new UI or schema changes.

By following this plan, Phase 3E will allow users to adjust builder characters’ ability totals, save misc bonuses, and skill misc bonuses through the existing Abilities & Skills modal, storing those adjustments in the rules‑engine–friendly overrides structure while leaving free‑form functionality untouched.