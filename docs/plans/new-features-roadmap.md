# Lore Ledger — Feature Roadmap

**Status legend:** `[x]` Done · `[~]` In progress · `[ ]` Planned · `[!]` Ongoing

---

## Phase 0 — Foundation

**Status:** [x] Complete  
**Priority:** Shipped

### Objectives

- [x] Production SPA deployed and installable as a PWA
- [x] Offline support via service worker caching
- [x] Build/version stamping (version + build id surfaced in UI)
- [x] Vite-based build and packaging pipeline
- [x] Deployment pipeline configured
- [x] State migration system (versioned, append-only, defensive defaults)
- [x] Backup / import / export (campaign-scoped, validates before touching live state)
- [x] Campaign-hub-first product direction established

### Acceptance goals

App installs, loads offline, preserves saved data across versions, and ships a clean production build.

### Why this phase matters

Without a stable foundation — installability, offline resilience, a migration system that never breaks saved data, and a real deployment pipeline — nothing built on top stays standing. Phase 0 is not "setup"; it is the product's trust contract with users.

---

## Phase 1 — Support and Diagnostics Hardening

**Status:** [x] Complete  
**Priority:** Shipped

### Objectives

- [x] Report Bug flow (builds mailto URL with structured debug payload)
- [x] Copy Debug Info (clipboard copy of full diagnostics text)
- [x] Version and build ID displayed in Data / Settings / Support modal
- [x] Campaign-aware debug payload (active campaign, character count, state shape)
- [x] `buildDebugInfoText`, `buildBugReportBody`, and `buildBugReportMailtoUrl` in `js/ui/support.js`
- [x] PWA update check / apply wired into data panel (`js/ui/dataPanel.js`)

### Acceptance goals

Any bug report submitted by a user carries enough context to diagnose the issue without a back-and-forth. Version and build are always visible. PWA updates can be checked and applied from within the app.

### Why this phase matters

Supportability is a feature. A portfolio app that cannot self-report its own state is incomplete. This phase also validates that the app's own internals are observable, which pays dividends during development.

---

## Phase 2 — Multi-Campaign Architecture

**Status:** [x] Complete  
**Priority:** Shipped

### Objectives

- [x] Campaign hub as the app's primary entry surface (`js/pages/hub/campaignHubPage.js`)
- [x] Create, rename, delete, and switch campaigns (`js/storage/campaignVault.js`)
- [x] App shell state isolated from campaign-scoped data
- [x] Campaign-aware backup / import / export
- [x] Legacy migration chain: v1 → v5 (state schema versioning in `js/state.js`)
- [x] Multi-character collection — schema v4 (`state.characters.entries`, `activeId`)
- [x] Character ↔ tracker card linking — schema v5 (`js/domain/cardLinking.js`)

### Acceptance goals

Multiple campaigns coexist in the vault without data bleed. Switching campaigns loads the correct state. Legacy single-campaign saves migrate forward without data loss. Characters are first-class entities linked to tracker cards.

### Why this phase matters

A tracker that only supports one campaign is a prototype, not a tool. The vault architecture and migration chain are what make this a real product — one that users can trust with months of campaign history across multiple games.

---

## Phase 3 — Combat Workspace

**Status:** [x] Complete  
**Priority:** High (active)

### Objectives

- [x] Dedicated combat workspace page (`js/pages/combat/combatPage.js`)
- [x] Battle state domain: participants, rounds, turns, elapsed timer
- [x] Participant management (add, remove, reorder, turn advancement)
- [x] Embedded panel host system (`js/pages/combat/combatEmbeddedPanels.js`)
- [x] Embedded Vitals panel (HP, AC, initiative, speed, proficiency, spell attack/DC, hit dice, resources, status effects)
- [x] Embedded Spells panel (spell levels, spell slots, add spell)
- [x] Embedded Weapons / Attacks panel (attack list, add attack)
- [x] Panel picker UI and reorder support (`js/pages/combat/combatSectionReorder.js`)
- [x] Embedded Equipment panel
- [x] Embedded Abilities / Skills panel

### Acceptance goals

All five embedded character panels are available in the combat workspace. Every panel reads and writes canonical character state directly — no copied data, no sync layers.

### Why this phase matters

Combat is the highest-frequency interaction in a tabletop session. A dedicated workspace with character data in reach removes the need to switch between views mid-fight. With the vitals, spells, weapons, equipment, and abilities/skills panels all shipping, players have comprehensive control over their characters without ever leaving the combat page.

---

## Phase 4 — Map Tool Enhancement

**Status:** [~] Mostly complete — stamp tool remains  
**Priority:** Medium

**Note (2026-04-16):** Step 4 character import/export is shipped; Phase 4 still has only the map stamp tool outstanding.

### Objectives

- [x] Map workspace with canvas, drawing history, and persistence (`js/pages/map/`)
- [x] Brush and eraser tools
- [x] Color picker and brush size controls
- [x] Undo/redo
- [x] Background image upload and remove
- [x] Map list and per-campaign map persistence
- [ ] Stamp tool (place reusable icons or tokens onto the map canvas)

### Acceptance goals

Users can place named or iconographic stamps (creatures, locations, markers) onto the map canvas. Stamps persist with the map. Existing draw/erase/undo behavior is unaffected.

### Why this phase matters

Drawing tools are expressive but imprecise for structured campaign content. Stamps let GMs mark encounters, points of interest, and party position quickly and repeatably without artistic skill.

---

## Phase 5 — Quality Hardening

**Status:** [!] Ongoing  
**Priority:** Always relevant

### Objectives

- [!] Vitest unit and regression suite (56 test files, 957 tests — all passing as of 2026-07-12)
- [!] Playwright smoke tests for UI / navigation / PWA behavior
- [!] Architecture documentation in `docs/`
- [!] `../features/multi-character-design.md` kept current with schema and panel decisions
- [!] No broken saved data across migrations
- [!] No multiply-registered event listeners on re-render
- [!] No horizontal scroll or clipped controls on mobile
- [!] Console clean (no unhandled errors in normal flows)

### Acceptance goals

The test suite stays green. New features ship with regression coverage. The architecture docs reflect what was actually built. Mobile layouts remain usable.

### Why this phase matters

A portfolio project that accumulates silent regressions is not a portfolio project — it is a demo that works until it does not. Hardening is not a cleanup phase; it is the discipline that makes every other phase's work trustworthy.

---

## Remaining Multi-Character Work

*These items are tracked separately in `../features/multi-character-design.md` and are not part of the phase numbering above.*

### Step 3 — Rules Engine and Character Builder

**Status:** [x] Shipped — SRD 5.1 builder, multi-step wizard, rules engine, custom content, sheet seeding, and P0/P1 stabilization (schema v12)

> The phase checklist below is a **historical record of how it was built**, and its schema
> version numbers are frozen at the time each line was written (e.g. "Schema v6 builder
> foundation" — the current version is v12). The detailed sequencing doc it referenced is
> archived at `docs/archive/lore-ledger-builder-plan.md`. For current builder state read
> `docs/reference/builder-scope-greenlist.md` and `docs/state-schema.md`.

- [x] Schema v6 builder foundation (`build` and `overrides` on character entries)
- [x] Pure derivation foundation for first-slice builder values
- [x] Minimal `New Builder Character` creation path
- [x] Accessible informational Builder Mode badge
- [x] Display-only Builder Summary panel for builder characters
- [x] Minimal Builder Identity editor for builtin race, class, background, and level
- [x] Phase 3C: Manual Builder Abilities editor for builder characters
- [x] Phase 3D: Initial builder-owned sheet integration for ability score/modifier display only
- [x] Phase 3E: Existing Abilities & Skills adjustment controls write builder ability adjustments only
- [x] Phase 3F: Display-only builder-derived Basics identity integration
- [x] Phase 3G: Display-only builder-derived Vitals proficiency and builder-only Abilities/Skills proficiency scalar
- [x] Phase 3H: No-schema-change builder-derived Vitals speed and hit-dice display in normal and embedded Vitals
- [x] Abilities & Features panel foundation: derived Dragonborn Breath Weapon renders as the first display-only feature card
- [x] Rest/resource Phase 3D foundation: active-character Short Rest / Long Rest toolbar actions recover explicitly tagged `character.resources[]` counters only
- [x] Rest/resource Phase 3E foundation: Vitals resource recovery metadata can be configured from resource tiles through press-and-hold or keyboard activation, with no visible tile settings buttons
- [x] Abilities & Features Phase 3F: manual/freeform and custom feature cards foundation plus first polish pass
- [x] Combat card vitals polish: compact HP and manually editable AC that follows the existing linked-card source pattern
- [x] Abilities & Features Phase 3G: manual/custom limited-use feature tracking foundation for feature-specific counters
- [x] Abilities & Features Phase 3H: derived Dragonborn Breath Weapon use tracking through character-owned `featureUses`
- [x] Phase 3I wizard seeding proof: Dragonborn passive trait text seeds into Features / Traits and fixed Dragonborn languages seed into Languages at builder Finish
- [x] Phase 3J Builder Summary status cleanup: copy now frames Summary as temporary review/scaffolding while normal panels remain the play surface
- [x] Full character creation wizard (8-step create/edit wizard across the full SRD 5.1 registry)
- [x] Generalized wizard-created character seeding beyond the narrow Dragonborn proof (features, languages, proficiencies, attacks, spells, slot totals, and inventory pockets seed additively at Finish), with freeform/no-wizard characters allowed to start blank or minimally populated
- [x] Content pickers beyond the minimal identity/abilities editors (race/subrace/class/background, subclass, skills, expertise, fighting styles, ASI/feat, spells, and equipment pickers in the wizard)
- [x] **Level Up Phase 1** (shipped 2026-07-12): guided one-level append for builder characters — subclass/feature/expertise/ASI-or-feat/cantrip/known-spell/spellbook choices newly unlocked by the level, Max/Average/Roll/Manual HP, atomic apply with accumulate HP/slot deltas and recompute-if-untouched AC/DC/attack, duplicate-aware additive seeding, active-character isolation, and double-submit protection. Class-resource automation is **not** included (Level Up Phases 2/3, blocked)
- [ ] Field locking and override UI for computed fields
- [ ] Required builder-card edit, reorder, and customization support for builder-created characters, with an explicit ownership model for cards that mix live-derived mechanics with user-owned content
- [ ] Abilities & Features follow-ups: fuller menu keyboard accessibility pass, possible `damageEffect` / `effectText` cleanup, partial regain behavior, broader rest/resource automation, and specialized shared-resource-linked cards
- [ ] Broad derived feature-use automation beyond Dragonborn Breath Weapon
- [ ] Shared resource pools such as Sorcery Points, Ki, Bardic Inspiration, Rage uses, and Channel Divinity stay canonical Vitals/resource counters and are not part of Phase 3G
- [ ] Spell slot recovery later
- [ ] Combat/linked-character rest behavior later, if desired
- [ ] HP, AC derivation/equipment-based AC automation, saves, skills, spells, combat, and linked-card automation beyond the current manual AC linked-card source pattern
- [x] Custom content persistence (campaign-scoped `content.custom`, schema v11)
- [x] Prove the first vertical SRD registry slice end-to-end before widening content coverage
- [x] Expand builtin registry coverage incrementally after the first slice is proven
- [ ] Custom content export/import story
- [ ] Content registry licensing attribution
- [x] **P0 — rest correctness:** Short Rest Hit Dice spending; Long Rest HP, Hit Dice recovery, death saves; Long Rest prepared-spell flow; and an active-character submission guard (see `docs/reference/rest-rules-spec.md`)
- [x] **P1 — display stabilization:** builder-derived initiative and skill/proficiency indicators
- [x] **P1 — seeding/display stabilization:** feature descriptions, canonical spell ordering, and inventory pocket labels
- [x] **Level Up spec revision** — complete 2026-07-09 (see `docs/reference/level-up-flow-spec.md`)
- [x] **Level Up Phase 1 implementation** — authorized and shipped 2026-07-12 (flow only; no class-resource automation)
- [~] **Current authorized work (2026-07-12, second session) —** Level Up Phase 2 (generalized class-resource derivation and seeding), then the next coherent builder batches per `docs/audits/builder-completion-matrix.md`; audit batches B1/B2/B3 are authorized in sequence
- [ ] **Still blocked / out of scope —** down-leveling and builtin content expansion beyond the SRD 5.1 greenlist

Still-open design constraints carried forward from the original Step 3 notes:

- **Builder-created characters must remain editable after creation.** The builder guards
  structural choices; it does not own the sheet.
- **Level-up may add rules-backed content additively**, duplicate-aware, without
  overwriting user-owned edits.
- **Cards that mix live-derived mechanics with user-owned content still need an explicit
  ownership model** before builder-card edit/reorder/customization can ship.

Not shipped yet: AC/HP derivation and equipment-based AC automation, save/skill automation,
spell and combat automation, shared resource pools (Sorcery Points, Ki, Metamagic, Flexible
Casting), broad derived feature-use automation, and custom content import/export.

The phase-by-phase record of how the builder reached its current state is archived in
[`../archive/builder-phase-history.md`](../archive/builder-phase-history.md) and
[`../archive/lore-ledger-builder-plan.md`](../archive/lore-ledger-builder-plan.md).

The registry expansion strategy was vertical-slice-first: prove one complete SRD data path
before widening. **That slice is complete and the registry is fully expanded.** Design
rationale is preserved in `docs/design/vertical-slice-schema.md` (historical).

### Step 4 — Cross-Campaign Character Import / Export

**Status:** [x] Complete

- [x] Export a single character (plus portrait) as a portable `.ll-character.json` file
- [x] Import that file into a different campaign
- [x] Validate on import before touching live state
- [x] Portrait blob and spell notes handled safely across campaign boundaries

Players can now share characters between campaigns or back up a single character independently of a full campaign. The app bundles portrait data and spell notes into the exported file, validates the format before import, stores any imported assets in the destination campaign, and assigns a fresh character ID to avoid collisions.

---

## Near-Term Recommended Order

1. [~] Step 3 — Rules engine and character builder
2. [ ] Phase 4 — Map stamp tool
3. [!] Ongoing quality hardening (continuous, not gated on the above)

---

## Guiding Architecture Rules

1. **Canonical data has one source of truth.** No duplicate copies that require syncing. Embedded panels read and write `state.characters.entries` directly.
2. **UI composition state is not domain data.** Which panels are visible, their order, and workspace layout live in UI/workspace state — not campaign state.
3. **Battle state is its own domain.** Combat encounter state (participants, rounds, turns, timer) is separate from the character data it references.
4. **Migration safety is mandatory.** Every storage-shape change ships with a versioned, tested, defensive migration. No saved data is ever silently discarded or corrupted.
5. **Supportability is a feature.** Debug info, version display, bug report tooling, and PWA update flows are not polish — they are part of the product.
6. **Polish must not come at the cost of reliability.** Mobile layout, no horizontal scroll, accessible controls, and clean re-renders are non-negotiable constraints on every feature, not aspirational nice-to-haves.

---

## Definition of Success

When someone asks “What have you built?” the answer should be: a production-quality, offline-capable, installable app with clean architecture, versioned migrations, campaign-scoped backups, thoughtful UX, and stable feature growth — built without frameworks, without tech debt shortcuts, and without ever breaking a user’s saved data.
