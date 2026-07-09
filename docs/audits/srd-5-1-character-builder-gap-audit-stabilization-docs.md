# SRD 5.1 Character Builder — Gap Audit

_Status: audit + stabilization planning artifact_  
_Last revised: 2026-07-09_  
_Branch: `builder-wizard`_  
_Original audit HEAD: `21e4264`_  
_Original audit schema reference: `v11`_

> ## ⛔ PLANNING ARTIFACT — NOT A WORK ORDER
>
> This document is a planning/reference artifact, not the canonical rules document.
> If this document conflicts with `AGENTS.md`, `docs/reference/builder-scope-greenlist.md`,
> `docs/reference/content-registry-plan.md`, `docs/reference/rest-rules-spec.md`, current
> `game-data/srd/*.json`, or current code, stop and resolve the conflict before implementation.
>
> **The prompts in this document are queued, not authorized.** Do not self-start work from
> them. In particular, **do not begin batches B1 (builder-only panel retirement), B2 (spell
> detail seeding), or B3 (feature detail seeding)** until docs cleanup, P0 stabilization,
> P0 rest correctness, and the P1 display/seeding fixes have all landed.
>
> The binding sequence lives in
> [`AGENTS.md` → Current Working Order](../../AGENTS.md#current-working-order). If this
> document's ordering ever drifts from that one, `AGENTS.md` wins.
>
> Rest expectations from §10/Prompt 2 have been promoted into the canonical
> [`docs/reference/rest-rules-spec.md`](../reference/rest-rules-spec.md). Level Up decisions
> from §12 have been promoted into
> [`docs/reference/level-up-flow-spec.md`](../reference/level-up-flow-spec.md) §10. Prefer
> those canonical docs over the prompt text here.

---

## Executive Summary

The SRD 5.1 character builder implementation is stable enough to audit, but user testing has found several stabilization bugs that should be fixed before larger audit batches or Level Up work.

The original audit found that the implementation is generally honest and test-backed, but remaining work is mostly about:

- stale documentation cleanup
- active sheet-state regressions
- richer SRD data seeding
- missing descriptions
- rest correctness
- spell and equipment behavior
- post-creation editing model alignment
- Level Up planning

Current product direction:

- **Structured build choices** should be guarded and edited through wizard-style flows.
- **Normal sheet/play-state fields** should remain quick-editable through focused popovers or modals.
- The Fifth Edition Character Sheet screenshots are **UX/reference coverage only**, not a visual design target.
- Documentation cleanup should happen before more implementation work so agents do not follow stale instructions.

---

## Current Priority Order

Recommended working order:

1. Docs cleanup / stale instruction audit
2. P0 stabilization: inventory state + Edit in Builder crash
3. P0 core rules: Short Rest / Long Rest + prepared-spell flow
4. P1 display bugs: initiative + skill/proficiency indicators
5. P1 seeding/display bugs: descriptions, spell order, inventory pocket labels
6. Revise Level Up spec
7. Implement Level Up Phase 1
8. Resume larger audit batches

Do **not** start larger audit feature work until the stabilization bugs and stale-doc issues are handled.

---

## Docs Cleanup First

Before implementation, clean up docs so agents are not following stale instructions, old product decisions, or outdated scope notes.

### Why this comes first

The audit found stale documentation risk already. For example, the builder greenlist had indicated non-SRD or currently unsupported content as expected SRD 5.1 built-in scope. That kind of stale instruction can cause agents to “fix” correct behavior or expand scope incorrectly.

### Docs cleanup checklist

#### Scope truth check

Verify docs say:

- SRD 5.1 built-in background scope is currently **Acolyte**.
- SRD 5.1 built-in feat scope is currently **Grappler**.
- Non-SRD or unapproved races/backgrounds/feats belong under custom/homebrew content unless explicitly approved later.

#### Product decision check

Docs must distinguish guarded build choices from quick-edit sheet/play-state fields.

Guarded build choices:

- race
- subrace
- class levels
- multiclass order
- subclass
- background
- ASI
- feats
- starting ability-generation method

Quick-edit sheet/play-state fields:

- HP
- temp HP
- AC bonuses
- initiative
- speed
- saves
- skills
- attacks
- spells
- equipment
- features
- resources
- notes
- manual overrides

#### Reference screenshot check

Docs should say:

- The Fifth Edition Character Sheet screenshots are UX/reference coverage only.
- Do not copy the reference app’s visual design.
- Use screenshots to identify editable surfaces, information coverage, and interaction patterns.

#### Rest rules check

Docs should cover:

- Short Rest behavior
- Long Rest behavior
- spell slot recovery
- Pact Magic recovery
- Hit Dice recovery
- prepared-spell changes after Long Rest
- resource reset timing

#### Builder/editing check

Docs should not imply builder-only panels are the preferred post-creation edit surface.

Correct model:

- Normal sheet panels are primary after creation.
- Structured build edits route through wizard-style flows.
- Play-state and sheet override fields remain quick-editable.

#### Agent instruction check

Review `AGENTS.md` and reference docs for:

- old restrictions
- deprecated batch plans
- obsolete filenames
- stale SRD scope notes
- instructions that conflict with current product decisions

### Prompt — Documentation Cleanup / Stale Instruction Audit

```text
Audit the Lore Ledger documentation before implementing new builder or character-sheet changes.

Goal:
Find and fix stale, conflicting, or misleading instructions that could cause Codex/Claude Code to implement the wrong behavior.

Do not implement app code in this batch unless a doc explicitly references a nonexistent file/path and a tiny adjacent correction is required. This is primarily a docs cleanup batch.

Docs to inspect:
- AGENTS.md
- docs/reference/builder-scope-greenlist.md
- docs/reference/content-registry-plan.md
- any builder wizard, SRD 5.1, character sheet, rest, inventory, spell, feature, or level-up reference docs
- any docs/reference/fifth-edition-character-sheet screenshot index or naming docs

Required checks:

1. SRD 5.1 scope accuracy
- Confirm docs state that SRD 5.1 includes Acolyte as the only background and Grappler as the only feat.
- Remove or correct any doc language claiming Criminal, Sage, Soldier, Goliath, Orc, or other non-SRD items are expected built-in SRD scope unless they have been explicitly approved.
- Clarify that non-SRD content belongs in custom/homebrew content.

2. Builder versus playable sheet editing
- Docs must clearly distinguish guarded structured build choices from quick-edit play-state/sheet fields.
- Guarded build choices:
  race, subrace, class levels, multiclass order, subclass, background, ASI, feats, starting ability-generation method.
- Quick-edit sheet/play-state fields:
  HP, temp HP, AC bonuses, initiative, speed, saves, skills, attacks, spells, equipment, features, resources, notes, and manual overrides.
- Remove stale language implying builder-only sheet panels are the preferred editing surface after creation.

3. Reference app screenshots
- Clarify that the Fifth Edition Character Sheet screenshots are UX/reference coverage only.
- Do not copy the reference app visual design.
- Use the screenshots to identify editable surfaces, information coverage, and interaction patterns such as tap/click/long-press to edit.

4. Rest behavior
- Add or verify docs for Short Rest and Long Rest expectations.
- Short Rest should support spending Hit Dice and restoring short-rest resources.
- Long Rest should restore HP, spell slots, pact slots, supported resources, death saves if tracked, and recover spent Hit Dice up to half total Hit Dice.
- Prepared casters should normally change prepared spells after finishing a Long Rest, not freely at any time.
- Known-spell casters generally change known spells through level-up, not Long Rest.

5. Level Up planning
- Add or verify that down-leveling is out of scope.
- Level Up should append exactly one level and ask only for choices unlocked by that level.
- Prepared caster spell capacity may increase on level-up, but prepared spell selection is handled through the Long Rest/prepared-spell flow.
- Do not rename internal spell slot fields in the Level Up batch; user-facing labels should still be clear.

6. Stale batch plans and old decisions
- Find any docs that contradict the current intended order:
  docs cleanup → stabilization bugs → rest correctness → seeded descriptions/spell ordering/skills/initiative → revised Level Up spec → Level Up implementation.
- Update docs so future agents do not start B1/B2/B3 audit work before stabilization.

Deliverables:
- List each stale/conflicting instruction found.
- Update the docs with corrected wording.
- Include exact files changed.
- Include any docs intentionally left unchanged and why.
- Run the relevant doc/lint/test command if available.
- Do not begin app-code implementation after the docs cleanup.
```

---

## Verification Performed in Original Audit

Original audit verification was green at the time it was produced.

Known original audit metadata:

| Item | Value |
|---|---|
| Branch | `builder-wizard` |
| HEAD | `21e4264` |
| Schema | `v11` |
| Date | `2026-07-08` |

Original conclusion:

- Implementation appeared stable and well-tested.
- Remaining work was mostly missing scope, product alignment, and richer data seeding.
- Later manual testing found stabilization bugs that should be fixed first.

---

## 1. SRD 5.1 Data Coverage

### General finding

The data registry work is useful and mostly moving in the right direction, but docs and data scope must stay synchronized.

### Important scope corrections

Docs must not imply non-SRD or unapproved content is expected shipped built-in content.

Current expected conservative behavior:

| Content category | Expected direction |
|---|---|
| Races | SRD-approved races only, as modeled in `game-data/srd/races.json` |
| Classes | SRD-approved classes, structured and data-driven |
| Backgrounds | Acolyte for SRD 5.1 built-in scope unless later explicitly approved |
| Feats | Grappler for SRD 5.1 built-in scope unless later explicitly approved |
| Spells | Full SRD 5.1 spell registry is now greenlit/shipped |
| Equipment packs | Current shipped pack registry with inline contents |
| Magic items | Deferred/custom |
| Monsters / NPC stat blocks | Deferred/custom |
| Standalone adventuring gear/tools/trade goods | Deferred as standalone registries; pack contents may ship inline on packs |

### Data/modeling expectations

- Use stable lowercase hyphenated IDs.
- Use `kind`.
- Use `source: "srd-5.1"`.
- Prefer structured fields over prose blobs.
- Do not hardcode registry facts in UI modules when they belong in data.
- Do not hand-edit generated `game-data/srd/*.json`; update adapters and regenerate.

---

## 2. Character Builder Flow Coverage

The builder has expanded beyond the early Dragonborn-only vertical slice. The current flow should be evaluated against full SRD 5.1 builder expectations.

Important flow areas:

- identity
- race and race choices
- class and multiclass choices
- background
- abilities
- subclass
- ASI/feat choices
- spells
- starting equipment
- summary
- finish/seeding
- edit-in-builder
- future level-up

### Product model

There are two different categories of editability.

#### Guarded structured build choices

These should be changed only through wizard-style flows with confirmation:

- race
- subrace
- class levels
- multiclass order
- subclass
- background
- ASI
- feats
- starting ability method

#### Quick-edit playable sheet fields

These should be editable from the normal sheet:

- current HP
- max HP override
- temp HP
- AC bonuses / manual override
- initiative bonus
- speed bonus/penalty
- skill/save misc bonuses
- weapons and attacks
- spells, spell notes, prepared state
- equipment, quantities, equipped state, pockets
- feature/resource uses
- notes

---

## 3. Existing App Field Integration

Builder data should flow into the normal sheet without making the sheet feel locked or unusable.

### Expected behavior

| Sheet area | Expected integration |
|---|---|
| Basics | Show derived class/level, race, background |
| Vitals | Show HP, AC, initiative, speed, proficiency, hit dice, resources |
| Abilities & Skills | Show derived ability totals, save/skill totals, proficiency/expertise/bonus indicators |
| Weapons / Attacks | Seed and/or derive attacks where appropriate; allow custom/manual attacks |
| Spells | Seed spell selections and slots; include descriptions and notes |
| Equipment | Seed starting gear into clear pockets, preserving user edits |
| Features / Traits | Seed names and descriptions; preserve user-owned edits |
| Resources | Track rest recovery rules where modeled |
| Combat embedded panels | Read/write canonical active character data, not snapshots |

---

## 4. Builder-only Panels / Scaffolding

Builder-only panels should not become the preferred long-term edit surface after character creation.

### Direction

- Normal sheet panels should be the post-creation editing surface.
- Structured build changes should route through guarded wizard flows.
- Temporary comparison/scaffolding panels should be removed or reworked once normal panels are ready.
- Play-state and sheet overrides should remain quick-editable.

### Important distinction

Do **not** broadly lock the sheet.

Only structured build decisions should be guarded. The playable sheet should remain highly editable for real table use.

---

## 4A. Reference App UX Notes

The Fifth Edition Character Sheet screenshots are useful as a coverage and interaction reference, not as a visual design target.

### Core UX pattern to adopt

A user should be able to:

1. tap/click or long-press a visible sheet field
2. open a focused edit popover/modal
3. make the change
4. return to the same sheet or combat context

### Guarded build choices

These affect downstream values and should be edited only through builder/level-up flows:

- race and subrace
- class levels and multiclass order
- subclass
- background
- ASI and feat choices
- starting ability-generation method

### Quick-edit playable sheet fields

These are normal play-state or override fields and should be editable from the sheet:

- current HP, max HP override, and temp HP
- AC temporary bonuses and manual override
- initiative, speed, saves, and skill modifiers
- weapons, attacks, ammo, and custom attack notes
- spells, preparation state, notes, and descriptions
- equipment, quantity, equipped state, and descriptions
- feature/resource uses and reset behavior

### Reference-app coverage checklist

| Surface | Reference behavior to preserve | Lore Ledger improvement |
|---|---|---|
| HP | Fast editable play-state numbers | Separate current, max, temp HP, damage/heal affordances, durable max-HP override |
| AC | Directly editable from sheet | Derived armor/shield AC plus temporary bonuses and explicit manual override |
| Ability scores | Tap/edit ability-related values | Keep base build scores guarded; allow save/skill misc bonuses and clear source breakdowns |
| Skills | Proficiency/expertise-style editing | Show derived source, manual proficiency override, expertise, half proficiency, misc bonus |
| Attacks | Editable attack rows | Derive from equipped weapons; allow custom/manual attack cards, notes, magic bonuses, ammo, descriptions |
| Spells | Selectable/editable spell list | Include full SRD spell descriptions, casting time, range, components, duration, school, concentration, ritual, source, higher-level text, user notes |
| Equipment | Editable inventory/equipment | Add item descriptions, weapon/armor properties, equipped state, quantity, custom notes, magic/homebrew support |
| Features | Accessible feature text | Structured feature cards with descriptions, usage counters, reset timing, user notes |
| Resources | Trackable counters | Derive class resource counters from class data where possible |

---

## 5. Rules Engine Coverage

Current rules engine direction is good: keep derivation pure and data-driven. But current and planned fixes need stronger coverage around:

- initiative display
- skills/proficiency/expertise/misc bonuses
- class resource counters
- rest/reset metadata
- feature descriptions
- spell slot totals
- prepared spell behavior
- level-up deltas
- multiclass behavior
- Hit Dice pools
- Pact Magic

### Known concern

Class-specific resource counters are not fully derived from `classSpecificByLevel` yet. This affects resource tracking, rest behavior, and future Level Up behavior.

---

## 6. Custom / Homebrew Support

Custom/homebrew support remains important but should not be mixed into shipped built-in SRD scope.

Expected rule:

- If not greenlit, approved, legal, and modeled, treat as custom.
- Do not silently promote custom content into built-in JSON.
- Future form-based custom content editor should exist, but not as part of the current stabilization pass.

---

## 7. Tests

The project already has useful automated coverage. For the current work, add targeted regression tests rather than relying only on manual clicking.

Important test categories:

- character switching
- equipment panel inventory state
- Edit in Builder cloneability
- Short Rest
- Long Rest
- prepared-spell Long Rest flow
- initiative display
- skill proficiency indicators
- seeded descriptions
- spell ordering
- inventory pocket labeling
- builder seeding idempotence
- Level Up planning/patching later

---

## 8. Manual UX Issues Found During Testing

User testing found these bugs:

1. Equipment panel inventory/pocket controls break across character switching.
2. Inventory controls appear stale or affect the wrong character until refresh.
3. Initiative tile not filled on builder-created character.
4. Features/traits list names like Darkvision without descriptions.
5. No Level Up menu option for builder-created characters.
6. Long Rest does not reset all required stats/resources.
7. Short Rest behavior needs a core-rules audit too.
8. Spells panel shows level 1 spells above cantrips.
9. Abilities and Skills panel does not show proficient skills or bonus indicators.
10. Builder-seeded inventory pockets have generic names instead of source names like Explorer’s Pack.
11. Edit in Builder crashes with `DataCloneError`.

---

## 9. Prioritized Gap List

### P0 — Fix before audit feature work

| Gap | Reason |
|---|---|
| Docs cleanup | Prevent agents from following stale instructions |
| Inventory/character switching state | Affects all characters and requires refresh workaround |
| Edit in Builder crash | Blocks guarded build edit path |
| Short/Long Rest correctness | Core D&D play feature |
| Prepared spell Long Rest flow | Required for SRD-accurate prepared caster workflow |

### P1 — Fix after P0

| Gap | Reason |
|---|---|
| Initiative display | Builder-created characters need correct combat tile |
| Skill/proficiency display | Abilities panel must show derived proficiency/bonus state |
| Feature/trait descriptions | Names-only entries are insufficient |
| Spell ordering | Cantrips must appear before levels 1–9 |
| Inventory pocket source labels | Starting gear pockets should be understandable |

### P2 — Planning / later implementation

| Gap | Reason |
|---|---|
| Revised Level Up spec | Needs stable builder edit/rest/sheet behavior first |
| Derived class resources | Important for full rules coverage and Level Up |
| Custom/homebrew editor | Needed but not part of stabilization |
| Builder-only panel retirement | Should wait until state bugs are fixed |

---

## 10. Stabilization Prompts Before Audit Work

### Prompt 1 — P0: Character Switching, Inventory Controls, and Edit in Builder Crash

```text
Investigate and fix the current builder-character regressions before doing any audit feature work.

Context:
This app is Lore Ledger. The current branch includes the SRD 5.1 builder wizard. After creating a character with the builder, several existing sheet panels appear to have stale state, broken active-character binding, or unsafe cloning behavior.

Do not implement new audit features in this batch. This is a stabilization/debugging batch only.

Bugs to investigate and fix:

1. Equipment / Inventory panel breaks across character switching

Observed behavior:
- After creating or selecting a builder-created character, the Equipment panel inventory area behaves incorrectly.
- Inventory pockets such as “Basic Inventory” and “Starting Gear” appear to affect every character or display stale data.
- Pocket controls become unusable: cannot click/change pockets, add another pocket, rename, delete, or search.
- Refreshing the page temporarily restores the correct inventory behavior for the currently selected character.
- Switching characters causes the issue to return.

Expected behavior:
- Inventory pocket state must be isolated per character.
- Switching active characters must fully refresh the Equipment panel for the newly active character.
- Search, pocket selection, add pocket, rename pocket, delete pocket, and inventory rows must operate only on the currently active character.
- Creating a builder character must not mutate shared inventory defaults or leak inventory state into other characters.
- No module-level cache, selected pocket state, DOM references, or event handlers should remain bound to the previous character after switching.

2. “Edit in Builder” button crashes

Observed console error:
Character action failed: DataCloneError: Failed to execute 'structuredClone' on 'Window': #<Object> could not be cloned.

Expected behavior:
- Clicking “Edit in Builder” on a builder-created character should open the builder wizard in edit mode.
- It must not pass DOM nodes, Window, Event objects, functions, class instances, or other non-cloneable objects into structuredClone.
- Only plain serializable builder character data should be cloned.
- If a non-serializable field exists on the character action payload, strip it before cloning or build a clean DTO for the wizard.

Regression tests required:
- Create or load two characters with different inventory pockets.
- Switch from character A to character B and verify the Equipment panel shows B’s pockets only.
- Verify search, add pocket, rename pocket, delete pocket, and pocket selection still work after switching.
- Create a builder character, switch to an existing non-builder/freeform character, and verify the non-builder character’s inventory controls still work.
- Switch back to the builder character and verify its inventory controls still work.
- Click “Edit in Builder” on a builder-created character and verify the wizard opens without throwing a DataCloneError.
- Add a regression test proving the builder edit flow receives only cloneable/plain data.

Acceptance criteria:
- No inventory pocket or search state leaks between characters.
- Refresh is no longer required after switching characters.
- Inventory controls work after repeated character switching.
- “Edit in Builder” opens successfully.
- npm run verify passes.
- npm run test:smoke passes, or explain any unrelated existing failure clearly.
```

---

### Prompt 2 — P0: Short Rest and Long Rest Core Rules

```text
Investigate and fix Short Rest and Long Rest behavior as a P0 core-rules bugfix batch.

Context:
The character sheet includes rest buttons, but Long Rest currently does not reset all of the things it should. Both Short Rest and Long Rest must behave correctly according to SRD 5.1 rules and the app’s modeled character resources.

This is a core D&D feature. Do not start broader audit feature work, level-up work, or builder panel refactors in this batch.

Primary goal:
Make Short Rest and Long Rest apply the correct SRD 5.1 effects to every supported app field/resource, while preserving user notes, inventory, prepared/known spells, build choices, and manual overrides.

Rule baseline:
- Short Rest:
  - A short rest is at least 1 hour.
  - At the end of a short rest, a character may spend one or more available Hit Dice to regain HP.
  - Spending a Hit Die rolls that die and adds the character’s Constitution modifier to the healing amount.
  - The character cannot spend more Hit Dice than currently available.
  - Short Rest should also reset class/features/resources that explicitly recover on a short rest.
- Long Rest:
  - A long rest is at least 8 hours.
  - At the end of a long rest, the character regains all lost HP.
  - The character regains spent Hit Dice up to half the character’s total Hit Dice.
  - The character cannot benefit from more than one long rest in a 24-hour period.
  - The character must have at least 1 HP at the start of the long rest to gain its benefits.
  - Long Rest should reset spell slot usage and class/features/resources that recover on a long rest.
  - Long Rest should reset resources that recover on any rest if the app models that distinction.

Prepared spell handling during Long Rest:
- For SRD 5.1 prepared casters, prepared spell selections should normally be changed as part of finishing a Long Rest, not freely at any time.
- Affected classes:
  Cleric, Druid, Paladin, Wizard.
- When the user clicks Long Rest on a character with prepared spellcasting, show a prompt:
  “Would you like to change your prepared spells?”
- If No:
  - Apply the Long Rest normally.
  - Preserve current prepared spell selections.
- If Yes:
  - Open a prepared-spell selection step before finalizing the Long Rest.
  - Show the class spell list/spellbook as appropriate.
  - Show current prepared count and max prepared capacity.
  - Allow deselecting/selecting prepared spells up to capacity.
  - Apply prepared spell changes and Long Rest changes together.
- If the character has multiple prepared caster classes, handle each class separately.
- For Wizards, prepared choices come from the character’s spellbook, not the entire wizard class spell list.
- For Clerics, Druids, and Paladins, prepared choices come from the class spell list plus any always-prepared subclass/oath/domain spells where applicable.
- Always-prepared/granted spells should be displayed as granted/always prepared and should not count against the prepared limit unless SRD data says otherwise.
- Prepared spell changes must not erase spell notes, custom spell notes, known spells, spellbook entries, or spell descriptions.

Known-spell caster handling:
- Bard, Ranger, Sorcerer, and Warlock do not use the Long Rest prepared-spell change flow.
- Their known-spell choices are mainly changed during level-up, not Long Rest.

Required implementation:
- Locate Short Rest and Long Rest action handlers.
- Locate HP, temp HP, hit dice, spell slot usage, pact slot usage, feature/resource counters, and death save state.
- Identify which fields are currently reset, ignored, or reset incorrectly.
- Ensure rest behavior is character-specific and safe across character switching.
- Ensure rest behavior works for builder-created and freeform/manual characters.

Short Rest expected behavior:
- User can spend available Hit Dice if missing HP.
- App shows available Hit Dice by class/hit die size when multiclassed.
- User can choose which Hit Dice to spend.
- Healing equals rolled Hit Die result + CON modifier per die, capped at max HP.
- Spending Hit Dice reduces available Hit Dice for that character.
- Short Rest resets supported short-rest resources/features.
- Short Rest does not restore all HP automatically.
- Short Rest does not restore ordinary long-rest spell slots.
- Short Rest restores Pact Magic slots if modeled.
- Do not silently clear temp HP unless the app has an explicit rule/system for doing so.

Long Rest expected behavior:
- Restore current HP to max HP.
- Reset death saves if tracked.
- Restore ordinary spell slot usage.
- Restore Pact Magic slot usage.
- Restore supported long-rest and short-rest resources/features.
- Regain spent Hit Dice up to half total Hit Dice, not exceeding total.
- Preserve notes, inventory, equipment, pockets, prepared/known spell data unless changed through the prepared-spell flow, custom attacks, personality notes, and build choices.
- Do not overwrite manual overrides such as AC override, skill/save misc bonuses, or custom HP max override.
- If tracking last long rest time exists, enforce or warn about the once-per-24-hours rule.
- If current HP is 0 at the start of the rest, warn that SRD 5.1 requires at least 1 HP to benefit from a long rest.

Resource reset model:
Each resource/feature counter should have a reset type where possible:
- shortRest
- longRest
- anyRest
- daily
- manual
- none / unknown

Apply:
- Short Rest resets shortRest and anyRest resources.
- Long Rest resets longRest, shortRest, anyRest, and daily resources where appropriate.
- Manual/unknown resources should not reset silently unless explicitly modeled as rest-resettable.

Tests required:
- Short Rest can spend Hit Dice and heal without exceeding max HP.
- Short Rest cannot spend unavailable Hit Dice.
- Short Rest does not fully heal by default.
- Short Rest restores Pact Magic slots if applicable.
- Short Rest restores modeled short-rest resources.
- Long Rest restores current HP to max HP.
- Long Rest resets death saves if tracked.
- Long Rest restores ordinary spell slots.
- Long Rest restores Pact Magic slots.
- Long Rest restores modeled long-rest/short-rest resources.
- Long Rest recovers spent Hit Dice up to half total and never above max.
- Long Rest preserves notes, inventory, prepared/known spells unless changed through the prepared-spell flow, equipment, pockets, and manual overrides.
- Long Rest prepared-spell prompt appears for Cleric, Druid, Paladin, and Wizard.
- Choosing No preserves prepared spells.
- Choosing Yes applies selected prepared spells and the rest effects together.
- Prepared spell changes preserve spell notes/descriptions.
- Rest actions are character-specific across switching.
- Builder-created and freeform/manual characters remain safe.

Acceptance criteria:
- Short Rest and Long Rest visibly do the correct thing.
- No rest action silently fails.
- No rest action affects the wrong character.
- SRD 5.1 behavior is followed for supported fields.
- Unsupported/unknown resource reset behavior is documented and left unchanged rather than guessed.
- npm run verify passes.
- npm run test:smoke passes, or any unrelated existing failure is clearly explained.
```

---

### Prompt 3 — P1: Initiative and Skill/Proficiency Display

```text
Investigate and fix missing or unclear values on builder-created characters.

Context:
The SRD 5.1 builder creates characters successfully, but several normal sheet panels are missing expected derived or seeded information. Fix these as a bug batch, not as a broader feature refactor.

Bugs to investigate and fix:

1. Initiative tile is not filled in

Observed behavior:
- A test character created with the builder does not show initiative in the initiative tile.

Expected behavior:
- A builder-created character should display the correct initiative modifier.
- If initiative is live-derived, the tile must read and render the derived initiative value after builder finish and after character switch.
- If initiative is seeded, the builder finish seeding patch must seed it without overwriting user-edited values.
- The value should update correctly when ability scores or relevant overrides change.

2. Abilities and Skills panel does not show proficient skills or bonuses

Observed behavior:
- The Abilities and Skills panel does not visibly show which skills are proficient.
- It also does not show whether a skill has expertise, half proficiency, or a misc/custom bonus.

Expected behavior:
- Skills should visibly indicate proficiency state.
- The panel should distinguish:
  - not proficient
  - proficient
  - expertise
  - half proficiency, if supported
  - misc/custom bonus, if present
- Displayed totals should match rules-engine derived values.
- If a skill has a builder-derived source, manual override, expertise, or misc bonus, the UI should make that understandable without cluttering the panel.
- Existing manual skill toggles/overrides must continue to work.

Regression tests required:
- Builder-created character with Dexterity modifier shows correct initiative.
- Initiative display survives character switching.
- Builder-created character with class/background skill proficiencies visibly shows those proficient skills.
- Expertise displays distinctly when present.
- Misc skill bonus or manual override displays distinctly and affects total.
- Non-builder/freeform character skill editing still works.

Acceptance criteria:
- Initiative tile displays correctly on builder-created characters.
- Proficient/expertise/bonus skill states are visible and accurate.
- No existing skill/manual override behavior regresses.
- npm run verify passes.
- npm run test:smoke passes, or explain unrelated existing failure clearly.
```

---

### Prompt 4 — P1: Descriptions, Spell Ordering, and Inventory Pocket Labels

```text
Investigate and fix remaining builder-created character sheet bugs and missing seeded descriptions.

Context:
This is still a bug/stabilization batch before starting the larger audit implementation plan. Do not remove builder-only panels or start full B1/B2/B3 audit batches yet. Fix the concrete bugs listed below.

Bugs and requirements:

1. Features and traits show names like “Darkvision” but not descriptions

Expected behavior:
- Builder-seeded features and racial traits should include full SRD descriptions where data exists.
- Examples: Darkvision and other race/class/background/feat traits should show readable descriptions.
- Prefer the existing structured “Abilities & Features” / feature-card surface if available.
- If current implementation still seeds to a flat textarea, improve seeded text format so each feature includes name, source, and description.
- Do not overwrite user-edited feature notes/cards on re-seed.
- Avoid duplicate feature entries on repeated builder finish/edit.

2. Spells panel ordering is wrong

Observed behavior:
- Level 1 spells display above cantrips.

Expected behavior:
- Cantrips appear first.
- Spell levels follow in ascending order: 1 through 9.
- Pact Magic, if shown separately, still preserves cantrips-first ordering for spell lists.
- Sorting is stable and does not disturb user notes/prepared state.

3. Equipment inventory pocket names are too generic

Observed behavior:
- Builder-created characters get generic pockets like “Basic Inventory” and “Starting Gear.”
- The pocket does not specify what equipment source produced the items.

Expected behavior:
- Inventory pockets created from starting equipment should be named based on the source equipment/package when possible.
- If selected equipment includes an Explorer’s Pack, the pocket should be named “Explorer’s Pack.”
- If multiple packs or sources are seeded, pocket names should clearly identify the source.
- Generic “Starting Gear” is acceptable only as a fallback when no more specific source is known.
- Existing user-created pockets must not be renamed automatically.
- Re-seeding must not duplicate pockets or overwrite user-renamed pockets.

Likely areas to inspect:
- builderSheetSeeding.js
- Feature/trait data registry
- Abilities & Features panel / manual feature cards
- Spells panel sorting/rendering
- Equipment panel inventory pocket creation
- Tests around builder seeding and character actions

Regression tests required:
- A builder-created race with Darkvision shows Darkvision description.
- Builder-seeded class/race/background features include descriptions where available.
- Re-seeding does not duplicate features or overwrite user-edited feature content.
- Spells panel renders cantrips first, then levels 1 through 9.
- Builder-seeded inventory pockets use specific pack/source names when available, such as “Explorer’s Pack.”
- User-renamed pockets are preserved after re-seed/edit.
- npm run verify passes.
- npm run test:smoke passes, or explain unrelated existing failure clearly.
```

---

## 11. Prepared Spells + Rest Flow Decision

Prepared casters should not be treated like known-spell casters. Their prepared selections are normally changed after a Long Rest, while known-spell choices are mainly changed at Level Up.

| Class | Spell model | Where choices should change |
|---|---|---|
| Cleric | Prepared caster | Prepared spell selections change through Long Rest flow |
| Druid | Prepared caster | Prepared spell selections change through Long Rest flow |
| Paladin | Prepared half-caster | Prepared spell selections change through Long Rest flow |
| Wizard | Spellbook + prepared caster | Prepared spells change through Long Rest flow; spellbook additions change through Level Up/copying spells |
| Bard | Known-spell caster | Known spells change mainly through Level Up |
| Ranger | Known-spell caster in SRD 5.1 | Known spells change mainly through Level Up |
| Sorcerer | Known-spell caster | Known spells change mainly through Level Up |
| Warlock | Known-spell caster + Pact Magic | Known spells change mainly through Level Up; Pact slots recover on Short/Long Rest |

### Product shape

Long Rest should offer a prepared-spell change step for:

- Cleric
- Druid
- Paladin
- Wizard

If user chooses **No**:

- apply Long Rest normally
- keep prepared spells unchanged

If user chooses **Yes**:

- open prepared spell selection
- apply prepared spell changes and rest effects together

---

## 12. Level Up Planning Decisions

The Level Up spec should be revised after stabilization, not implemented immediately.

### Decision summary

| Topic | Decision |
|---|---|
| Down-leveling | Out of scope |
| Prepared casters | Level Up reports capacity/new spell levels; prepared selection routes through Long Rest |
| Known-spell casters | Choose newly known spells during Level Up |
| Wizard | Choose spellbook additions during Level Up; prepare from spellbook during Long Rest |
| Cantrips | Choose new cantrips during Level Up when gained |
| Granted spells | Show/seed as granted; do not manually choose unless rules require |
| Internal spell slot field | Do not rename `used` during Level Up; fix user-facing labels if misleading |

### Prompt — Revise Level Up Spec After Stabilization

```text
Revise the Level Up Flow implementation spec using these decisions.

Do not implement yet. Update the spec only.

Decisions:

1. Down-leveling is out of scope

Lore Ledger does not need a normal gameplay flow for removing levels. Do not build reverse level-up logic in this batch.

If a user made a major mistake, they can use Edit in Builder or create a corrected character. Do not attempt to reverse HP gains, features, spells, ASIs, feats, resource counters, or multiclass progression as part of the Level Up flow.

2. Prepared caster behavior

Prepared spell lists are editable play-state, not permanent level-up build choices.

For prepared casters:
- Level Up should show newly available spell levels.
- Level Up should show prepared capacity before/after.
- Level Up should not force the user to choose a permanent prepared spell list unless the SRD rules require a fixed choice.
- Prepared selections should remain editable through the Long Rest prepared-spell flow.
- If direct prepared-spell editing exists in the Spells panel, it should route through the same prepared-spell flow or clearly mark itself as a manual/DM override.

For known-spell casters:
- Level Up should ask the user to choose newly known spells when the class gains known spells.

For Wizards:
- Level Up should ask for spellbook additions when the wizard gains new spellbook spells.
- Prepared wizard spell selection should happen through Long Rest and be limited to the spellbook.

For cantrips:
- Level Up should ask for new cantrip choices when the class gains additional cantrips.

Granted spells:
- Domain/patron/oath/subclass granted spells should be shown in the summary and seeded/displayed, but should not be manually chosen unless the data/rules specifically require a choice.

3. Spell slot field naming

Do not rename the internal `used` spell slot field during Level Up work, even though the field currently appears to mean available/remaining slots in code.

However:
- Verify the user-facing spell slot labels/examples are not misleading.
- If the UI says “Used” but the stored value represents available/remaining slots, fix the visible label/example.
- Any internal field rename should be a separate cleanup/refactor, not part of Level Up.

4. Implementation order

Do not implement Level Up until the current stabilization bugs are fixed:
- Equipment/inventory state leaking or breaking across character switching.
- Edit in Builder DataCloneError.
- Short Rest and Long Rest correctness.
- Missing feature/trait descriptions.
- Spell ordering.
- Initiative display.
- Skill proficiency/bonus display.

After revising the spec, include:
- Any changed assumptions.
- Any risks that remain.
- Any tests that should be added or changed because of these decisions.
```

---

## 13. Recommended Batch Plan

Updated recommended order:

1. Docs cleanup
2. Stabilization P0/P1 bugs
3. Revised Level Up spec
4. Original audit B0–B8 work

### B0 — Documentation correction

Fix stale scope, schema, and source-of-truth docs.

### B1 — Builder-only panel retirement / edit routing

Remove or rework builder-only sheet panels. Structured build edits go through guarded wizard flows. Play-state sheet fields remain quick-editable.

### B2 — Spell detail seeding

Seed/display full spell details:

- description
- casting time
- range
- components
- duration
- school
- ritual/concentration
- higher-level text
- notes

### B3 — Feature detail seeding

Seed/display richer feature and trait descriptions.

### B4 — Racial trait mechanics

Derive and display supported trait mechanics beyond the narrow initial slice.

### B5 — Class resource counters

Use class data to derive resource counters where possible.

### B6 — Starting gold / equipment alternatives

Implement starting-gold path and improve starting-equipment handling.

### B7 — Custom/homebrew editor

Add form-based custom content support.

### B8 — Final polish / smoke / release readiness

Tighten UX, mobile behavior, tests, and docs.

---

## 14. Implementation Note for Future Prompts

Use this wording when handing the screenshots to a coding model:

```text
Use the uploaded Fifth Edition Character Sheet screenshots as UX reference only.

Lore Ledger should support the same practical editability pattern:
- tap/click or long-press a visible sheet field
- open a focused edit popover/modal
- apply changes
- return to the same sheet/combat context

Do not copy the reference app’s visual design.
```

### Guarded through builder wizard

- race
- subrace
- class levels
- multiclass order
- subclass
- background
- ASI
- feats
- starting ability-generation method

### Quick-edit from normal sheet

- HP
- temp HP
- AC bonuses
- initiative
- speed
- saves
- skills
- attacks
- spells
- equipment
- features
- resources
- notes
- other play-state overrides

---

## Bottom Line

The builder is moving in the right direction, but the next work should be stabilization and documentation cleanup, not new feature expansion.

The most important immediate fixes are:

1. remove stale instructions from docs
2. fix character switching/inventory state
3. fix Edit in Builder crash
4. fix Short Rest and Long Rest correctness
5. add prepared-spell Long Rest flow
6. fix initiative and skill/proficiency display
7. seed/show feature and spell descriptions correctly
8. fix spell ordering and inventory pocket labels
9. revise Level Up spec only after the above are stable

After that, the larger SRD 5.1 audit batches can resume with much lower risk.
