# Combat Workspace Plan

## Status

- **Phase:** 3 — Combat Workspace
- **Overall status:** In progress
- **Current next slice:** Slice 8 — Styling, accessibility, and polish

---

## Purpose

Combat Workspace is a focused combat dashboard for DMs and players.

Its purpose is to reduce page-flipping during encounters by combining:

- combat participants
- turn order
- round tracking
- elapsed encounter time
- HP / temp HP tracking
- status effects
- a small set of embedded combat-relevant panels

Combat Workspace is campaign-bound and should build on Lore Ledger’s existing multi-campaign vault architecture rather than introducing a separate global combat system.

---

## Product decisions locked in

These are approved product decisions for Combat Workspace v1 and should not be changed without an explicit product decision.

### Encounter model

- One active encounter per campaign
- Workspace layout persists per campaign
- Encounter state is separate from canonical campaign data
- Clear Combat resets the encounter but keeps the workspace layout

### Core page structure

Combat Workspace will always include:

- Combat Cards panel
- Round Controls / Timer panel

### Embedded panels in v1

Supported embedded panels:

- Vitals
- Spells
- Weapons / Attacks

Not included in v1:

- Notes
- Inventory
- broader panel expansion beyond later Phase 3.2 work

Rules:

- No duplicate embedded panels in v1
- User manually chooses which supported panels appear
- No auto-suggestion logic in v1

### Turn / initiative model

- Manual participant ordering only in v1
- No initiative number field in v1
- Users arrange combat cards to set order

Next Turn will:

- advance the active participant
- add configured `secondsPerTurn`
- increment round when order wraps
- advance/decrement timed status effects

Undo will reverse the most recent turn advance.

### Writeback rules

Only these combat edits should write back to canonical campaign data:

- current HP
- temp HP
- status effects

Combat Workspace should not write back:

- notes
- names
- max HP
- section/category placement
- portraits
- spell notes
- page/layout state
- combat ordering / timer state

### HP / temp HP rules

- Damage consumes temp HP first, then current HP
- Heal affects current HP only
- Temp HP adds to existing temp HP
- Current HP, max HP, and temp HP remain separate in the data model

Combat card display rule:

- HP number is shown in normal color when no temp HP is active
- HP number is shown in blue when temp HP is active

### Status effect rules

- Status effects have a label
- Status effects may optionally have a duration
- Duration modes:
  - none
  - rounds
  - time
- Timed effects advance/decrement on Next Turn
- Undo restores them
- Expired effects do not auto-delete in v1; they remain visible and marked expired/zero

### Participant rules

- Any tracker-page card can be addable to combat
- Initial combat role is inferred from source section/category
- Combat card menu may override role for the encounter only
- Supported combat roles:
  - party
  - enemy
  - npc

Visual direction:

- party = normal
- enemy = soft red tint
- npc = soft blue or grey tint

### Duplicate rules

- Combat duplicates are allowed
- Duplicates must be encounter-local independent entries for HP/temp HP/status tracking
- Removing a combat participant removes it from the encounter only
- Removing it must not delete or remove the source tracker card

---

## Architecture rules locked in

These are implementation rules, not optional preferences.

### 1. Canonical data remains the source of truth

Combat Workspace may present and edit certain canonical values, but it must not duplicate long-lived campaign data unnecessarily.

### 2. Workspace config and encounter state are separate

Persisted Combat state must keep a clear split between:

- `combat.workspace`
- `combat.encounter`

`workspace` is long-lived per campaign.
`encounter` is disposable/resettable active combat state.

### 3. Combat is campaign-scoped

Combat state belongs inside each campaign document, not in app-global state.

### 4. Embedded panels are views, not copies

Embedded panels should operate on the same canonical data used elsewhere in the app.

### 5. Combat-specific state is explicit

Turn order, round count, elapsed time, undo history, encounter role overrides, and duplicate encounter entries belong to Combat state, not Tracker/Character page structures.

### 6. Keep v1 bounded

Do not overbuild rules automation, generalized panel systems, or future multi-encounter support in v1.

---

## Persisted state shape

Combat Workspace persistence uses schema version **3**.

Approved persisted shape:

```js
state.combat = {
  workspace: {
    panelOrder: [],
    embeddedPanels: [],
    panelCollapsed: {}
  },
  encounter: {
    id: null,
    createdAt: null,
    updatedAt: null,
    round: 1,
    activeParticipantId: null,
    elapsedSeconds: 0,
    secondsPerTurn: 6,
    participants: [],
    undoStack: []
  }
};
```

Field names may evolve slightly to fit repo conventions, but the explicit `workspace` + `encounter` split must remain.

---

## Slice plan

### Slice 1 — State and persistence foundation

**Status:** Done

#### Scope

- add combat to persisted campaign state
- bump schema from 2 to 3
- add safe defaults for `combat.workspace` and `combat.encounter`
- migrate older saves/campaign docs defensively
- preserve combat through sanitize/save
- keep combat isolated per campaign in vault projection/switching
- update storage/schema docs
- add migration/persistence tests

#### Completed notes

- `CURRENT_SCHEMA_VERSION` bumped from 2 to 3
- added Combat typedefs and default combat bucket
- added defensive migration/repair for missing or malformed combat buckets
- wired combat through campaign vault load/save/projection/switching
- ensured backup restore retains combat
- updated docs for schema/storage/architecture
- added/updated migration, sanitize, and persistence isolation tests

#### Files changed in Slice 1

- `js/state.js`
- `js/storage/campaignVault.js`
- `js/storage/backup.js`
- `tests/state.migrate.test.js`
- `tests/state.sanitize.test.js`
- `tests/storage.persistence.test.js`
- `docs/state-schema.md`
- `docs/storage-and-backups.md`
- `docs/architecture.md`

#### Verification completed for Slice 1

- targeted tests passed
- full test suite passed
- typecheck passed
- build passed

---

### Slice 2 — Pure combat domain helpers

**Status:** Done

#### Scope

- participant/source helper foundations
- role inference helpers
- HP / temp HP math helpers
- status effect factories and timing helpers
- turn advance helpers
- undo entry creation/apply helpers
- clear encounter helper
- unit tests only

#### Constraints

- no UI
- no page shell
- no route wiring
- no tracker footer integration
- no embedded panels
- no CSS

#### Completed notes

- added pure combat participant/source helper foundations
- added encounter-local participant factory with role inference from source type, section/category/group, and encounter-only override support
- added HP, healing, damage, and temp HP math helpers
- added status effect factories, legacy text parsing, normalization, expiration, and turn timing helpers
- added turn advance helpers with elapsed time, round wrapping, timed status advancement, and undo entry creation
- added undo apply helpers that restore turn timing/status state without reverting unrelated HP/temp HP edits
- added clear encounter/default encounter helpers
- kept implementation bounded to pure combat domain helpers and unit tests

#### Files changed in Slice 2

- `js/domain/combat.js`
- `tests/combatDomain.test.js`
- `docs/combat-workspace-plan.md`

#### Verification completed for Slice 2

- targeted combat helper tests passed
- full unit test suite passed
- typecheck passed
- build passed

---

### Slice 3 — Combat page shell

**Status:** Done

#### Scope

- Combat top-level page/tab shell
- app init/destroy wiring
- empty state
- always-present Combat Cards panel shell
- always-present Round Controls / Timer panel shell
- workspace layout persistence hooks

#### Completed notes

- added the Combat top-level campaign tab and page shell
- wired Combat page init/destroy through the app composition root alongside campaign modules
- added the always-present Combat Cards and Round Controls / Timer panel shells
- rendered the empty combat state and inert placeholder controls without future combat behavior
- added Combat-only workspace layout hooks for panel order and collapsed state under `combat.workspace`
- kept Combat shell wiring isolated from Character-page selectors and global UI collapse state

#### Files changed in Slice 3

- `app.js`
- `index.html`
- `styles.css`
- `js/pages/combat/combatPage.js`
- `js/pages/combat/combatSectionReorder.js`
- `tests/combatPage.test.js`
- `tests/smoke/combatShell.smoke.js`
- `docs/combat-workspace-plan.md`

#### Verification completed for Slice 3

- targeted Combat page unit tests passed
- targeted Combat shell smoke test passed
- full unit test suite passed
- full browser smoke suite passed
- typecheck passed
- build passed

---

### Slice 4 — Tracker add-to-combat flow

**Status:** Done

#### Scope

- add Combat action into existing tracker card footer dropdown pattern
- allow add to combat without deleting/moving source cards
- support duplicate adds

#### Completed notes

- added a Combat footer action for NPC, Party, and Location tracker cards
- appended tracker sources into campaign-scoped `combat.encounter.participants`
- kept source tracker cards in place and unchanged
- allowed duplicate adds as independent encounter-local participants
- reused Slice 2 combat participant helpers for source lookup, role inference, HP/temp HP/status initialization, and encounter normalization
- repaired missing/malformed combat buckets defensively during valid add-to-combat writes
- refreshed the existing Combat shell count after successful add-to-combat without adding future combat card controls

#### Files changed in Slice 4

- `js/domain/combatTrackerActions.js`
- `js/pages/combat/combatEvents.js`
- `js/pages/combat/combatPage.js`
- `js/pages/tracker/panels/cards/shared/cardFooterShared.js`
- `js/pages/tracker/panels/npcCards.js`
- `js/pages/tracker/panels/partyCards.js`
- `js/pages/tracker/panels/locationCards.js`
- `tests/combatTrackerActions.test.js`
- `tests/smoke/combatShell.smoke.js`
- `docs/combat-workspace-plan.md`

#### Verification completed for Slice 4

- targeted add-to-combat unit tests passed
- targeted Combat domain/page/add-flow unit tests passed
- targeted Combat shell smoke tests passed
- full unit test suite passed
- full browser smoke suite passed
- typecheck passed
- build passed

---

### Slice 5 — Combat cards and round controls

**Status:** Done

#### Scope

- combat card rendering
- manual order controls
- active participant marker
- role menu / override
- remove action
- HP/temp HP interactions
- round/timer controls
- Next Turn / Undo / Clear Combat

#### Completed notes

- rendered encounter-local combat cards from `combat.encounter.participants`
- added simple up/down manual ordering without introducing drag/drop systems
- added active participant marker and per-card Make Active control
- added encounter-only role override menu without mutating tracker section/category placement
- added encounter-only remove action for combat participants
- added damage/heal/temp HP controls using Slice 2 HP math helpers
- kept HP/temp HP canonical writeback explicit and limited to direct combat-card HP edits
- preserved duplicate participant independence inside the encounter
- added seconds-per-turn control plus Next Turn / Undo / Clear Combat behavior through Slice 2 turn helpers
- kept Clear Combat scoped to disposable encounter state while preserving workspace layout
- refreshed hidden tracker card panels only after canonical HP/temp HP writeback so tracker UI stays in sync

#### Files changed in Slice 5

- `app.js`
- `index.html`
- `styles.css`
- `js/domain/combatEncounterActions.js`
- `js/pages/combat/combatPage.js`
- `js/pages/tracker/trackerPage.js`
- `tests/combatEncounterActions.test.js`
- `tests/combatPage.test.js`
- `tests/smoke/combatShell.smoke.js`
- `docs/combat-workspace-plan.md`

#### Verification completed for Slice 5

- targeted Combat unit tests passed
- targeted Combat smoke tests passed
- full unit test suite passed
- full browser smoke suite passed
- typecheck passed
- build passed

---

### Slice 6 — Status effects UI

**Status:** Done

#### Scope

- status effect add/remove/edit UI
- duration gear/settings UI
- expired styling
- hook status timing into turn controls

#### Completed notes

- added explicit combat-card status effect add, edit, and remove controls
- added duration settings controls for the locked `none`, `rounds`, and `time` modes
- kept status effects label-required and defensively normalized
- rendered expired timed effects as visible zero-duration effects instead of auto-removing them
- reused Slice 2 timing helpers through existing Next Turn / Undo flows so timed status state advances and restores with turn history
- kept canonical status writeback narrow by mirroring direct combat status edits to existing tracker status text only
- preserved duplicate participant independence inside the encounter

#### Files changed in Slice 6

- `js/domain/combatEncounterActions.js`
- `js/pages/combat/combatPage.js`
- `styles.css`
- `tests/combatEncounterActions.test.js`
- `tests/combatPage.test.js`
- `tests/smoke/combatShell.smoke.js`
- `docs/combat-workspace-plan.md`

#### Verification completed for Slice 6

- targeted Combat unit tests passed
- targeted Combat smoke tests passed
- full unit test suite passed
- full browser smoke suite passed
- typecheck passed
- build passed

---

### Slice 7 — Embedded panels

**Status:** Done

#### Scope

- panel picker
- Vitals embedded panel
- Spells embedded panel
- Weapons / Attacks embedded panel
- prevent duplicate embedded panel selection

#### Completed notes

- added panel picker in `#combatEmbeddedPanels` container, which stays in the non-Combat Cards column after the Round Controls panel
- picker renders add-buttons only for panels not yet active; disappears when all three are added
- added collapsible embedded panel sections for Vitals, Spells, and Weapons / Attacks
- each embedded panel hosts the scoped Character-page source panel behavior against the canonical active character in `state.characters.entries` — no copied data, no sync layers
- active-character changes are handled through active-character change events and embedded panel invalidation/rebinding rather than a duplicate state or sync store
- Vitals resource tracking, Spells editing/toggles/notes, and Weapons / Attacks editing remain usable and source-faithful inside Combat Workspace
- panel selection persists in `combat.workspace.embeddedPanels`; collapse state persists in `combat.workspace.panelCollapsed` under the `combatEmbeddedPanel_*` id prefix
- duplicate panel prevention is enforced by `addEmbeddedPanel()` which rejects unknown and duplicate ids
- embedded panel reorder persists in `combat.workspace.embeddedPanels` and keeps FLIP swap animation behavior
- embedded panel module (`combatEmbeddedPanels.js`) owns the Combat host chrome and initializes the scoped Character-page panel modules for source-faithful behavior

#### Files changed in Slice 7

- `js/pages/combat/combatEmbeddedPanels.js` (new)
- `js/pages/combat/combatPage.js`
- `index.html`
- `styles.css`
- `tests/combatEmbeddedPanels.test.js` (new)
- `tests/smoke/combatShell.smoke.js`
- `docs/combat-workspace-plan.md`

#### Verification completed for Slice 7

- targeted Combat/embedded panel unit tests passed (66/66)
- targeted Combat shell smoke tests passed (9/9)
- full unit test suite passed (223/223)
- full browser smoke suite passed (33/33)
- build passed
- typecheck passed

---

### Slice 8 — Styling, accessibility, and polish

**Status:** Planned

#### Scope

- role tint styling
- blue temp HP state styling
- responsive layout tuning
- keyboard/accessibility checks
- browser smoke coverage
- docs follow-up

---

## Current implementation notes

### What already exists in repo

- multi-campaign vault architecture
- campaign-scoped persistence
- migration-aware state handling
- campaign-level backup/import/export behavior
- support/debug hardening
- Tracker / Character / Map page architecture to build alongside

### What Combat v1 should reuse

- existing page/panel styling where safe
- existing panel collapse behavior where safe
- existing panel move/reorder patterns where safe
- tracker card footer dropdown pattern for future add-to-combat action

### What Combat v1 should not reuse directly

- Character page modules that assume fixed DOM IDs or page-wide selectors
- any UI code that would couple Combat Workspace too tightly to Character page rendering internals

---

## Known deferred items

These are intentionally out of scope for Combat Workspace v1 unless explicitly re-approved.

- initiative number fields
- multiple simultaneous encounters per campaign
- duplicate embedded panels
- notes panel
- inventory panel
- generalized rules engine
- auto-removal of expired statuses
- per-encounter workspace layouts
- cross-campaign encounter state
- broader panel expansion beyond Vitals / Spells / Weapons in v1

---

## UI note to revisit later

Before the main Combat card UI implementation/styling pass:

- ask Willow for the combat card sketch/reference

This is intentionally deferred until the UI slices.
