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

- [!] Vitest unit and regression suite (30 test files, 417 tests — all passing)
- [!] Playwright smoke tests for UI / navigation / PWA behavior
- [!] Architecture documentation in `docs/`
- [!] `MULTI-CHARACTER_DESIGN.md` kept current with schema and panel decisions
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

*These items are tracked separately in `MULTI-CHARACTER_DESIGN.md` and are not part of the phase numbering above.*

### Step 3 — Rules Engine and Character Builder

**Status:** [~] In progress

- [x] Schema v6 builder foundation (`build` and `overrides` on character entries)
- [x] Pure derivation foundation for first-slice builder values
- [x] Minimal `New Builder Character` creation path
- [x] Accessible informational Builder Mode badge
- [x] Display-only Builder Summary panel for builder characters
- [ ] Full character creation wizard
- [ ] Content pickers for species/race, class, background, abilities, and later choices
- [ ] Level-up flow
- [ ] Field locking and override UI for computed fields
- [ ] HP, AC, saves, skills, spells, combat, and linked-card automation
- [ ] Custom content persistence and export/import story
- [ ] SRD data registry expansion beyond the first builtin foundation
- [ ] Content registry licensing attribution
- [ ] Short rest / long rest mechanics

This remains the largest active feature in the product. The foundation is now in place, but the shipped Step 3 UI is intentionally limited to minimal builder-character creation, an informational badge, and a display-only summary. The full builder wizard and automation are not shipped yet.

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
