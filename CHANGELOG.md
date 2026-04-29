# Changelog

All notable changes to this project will be documented in this file.

Lore Ledger was formerly developed under the working name CampaignTracker.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Step 3 rules-engine / character-builder foundation: schema v6 adds `build` and `overrides` metadata to character entries while preserving freeform characters with `build: null`.
- Pure builder derivation helpers for class/level labels, race, background, level, proficiency bonus, ability totals/modifiers, saves, skills, and initiative.
- Minimal `New Builder Character` creation path that creates a valid builder-mode character without changing the existing freeform `New Character` flow.
- Accessible informational Builder Mode badge for builder characters.
- Display-only Builder Summary panel for builder characters, shown after Basics and before Vitals, with derived class/level, race, background, level, proficiency bonus, and ability totals/modifiers.
- Dragonborn Draconic Ancestry derivation and Builder Summary display for damage resistance, breath weapon type/area, save ability, save DC, and level-scaled damage dice, while persisting only the selected ancestry ID.
- Dragonborn Race Choices wizard preview for Draconic Ancestry, sourced from local registry/rules derivation rather than UI-only mechanics lookup.
- Vitals display for derived Dragonborn Breath Weapon DC when applicable, keeping the value read-only and derived.
- Phase 3C foundation: a normal Character page Abilities & Features panel with derived, display-only Dragonborn Breath Weapon as the first feature card, without persisting it into Weapons, Spells, Equipment, or flat character fields.
- Phase 3D foundation: Character page Short Rest / Long Rest toolbar controls route through a central active-character recovery helper for explicitly tagged `character.resources[]` counters, leaving untagged/manual resources unchanged.

### Not Shipped Yet

- Class/background choice pickers, equipment, level-up flow, field locking/override UI, Abilities & Features card polish, manual/freeform feature cards, custom feature cards, feature-use tracking, manual recovery metadata UI, spell slot recovery, combat/linked-character rest behavior, specialized resource-linked feature cards, and broader HP/AC/saves/skills/spells or linked-card automation are still future Step 3 work. Derived builder values are not persisted back into flat character fields by default.

## [v0.5.0] - 2026-04-16

### Added

- Multi-character support: characters now live in `state.characters.entries` with `state.characters.activeId` selecting the active entry, and fresh campaigns can start with no character until one is created.
- Multi-character tracker card linking (Step 2): NPC and Party cards can be linked to a character entry via a `characterId` field. Linked cards read and write name, HP, class, status, and portrait through the canonical character entry (`js/domain/cardLinking.js`).
- Schema v5 migration: NPC and Party cards gain `characterId: null`; character entries gain `status: ""`.
- Character deletion now shows a warning when linked tracker cards exist, snapshots their last known character data, and unlinks those cards before deleting the character.
- Cross-campaign character import/export (Step 4): the Character page can export the active character as a `.ll-character.json` file, then import it into another campaign as a new standalone character with a fresh character ID.
- Character portability bundles portrait data and spell notes into the exported file, then restores the portrait blob and destination-campaign spell-note text records on import.
- Portrait visibility controls and image-focused actions across tracker cards.
- A manual `Check for updates` action in the Progressive Web App flow.
- Additional motion polish for weapon movement, ability/skill movement, and dice rolling, including percentile roll animation.
- Targeted Vitest coverage for `migrateState(...)`, including historical schema upgrades, already-current normalization behavior, and malformed-input cases that document current migration semantics.

### Changed

- Card and panel updates were further optimized with incremental patching, DOM reordering, and FLIP/masonry-based transition work to reduce unnecessary rerenders during reordering and portrait changes.
- Continued presentation and branding polish following the Lore Ledger rename introduced in `v0.4.0`.

### Fixed

- Manifest and asset path issues affecting packaged or deployed web assets.
- Update-banner styling regressions.
- Scroll, panel-jump, and tile-flash issues observed during layout changes and card movement.

## [v0.4.0] - 2026-02-23

### Added

- Maskable icon support and related manifest asset updates for the Progressive Web App.
- Build and CI adjustments so release version stamping can read tags and repository history in the deployment environment.

### Changed

- Rebranded the application from Campaign Tracker to Lore Ledger across the web app and release-facing assets.
- Refined release metadata and version-stamping behavior ahead of tagged releases.

## [v0.3.0] - 2026-02-23

### Added

- A Vite-based production build pipeline and GitHub Pages deployment workflow.
- Progressive Web App support, including a web manifest, offline service worker, and in-app update banner.
- A broader page-oriented front-end structure for tracker, character, and map areas, along with shared helpers for tracker card rendering.
- Release and maintenance tooling, including zip-verification scripts and release-readiness documentation for smoke testing and CSP checks.

### Changed

- Significant refactoring of map and UI modules into smaller units with more consistent module APIs and lifecycle handling.
- Broader adoption of state-action and DOM-guard patterns to make initialization, re-initialization, and error handling more predictable.
- Search/highlight behavior and general interface polish across tracker and character workflows.

### Fixed

- Import/export validation and general DOM/XSS hardening.
- Reliability issues around map history serialization, listener re-attachment, and update-banner behavior.
- Release artifact hygiene so generated zip packages exclude repository-only files such as `.git/`.

[Unreleased]: https://github.com/Lrmann818/Lore-Ledger/compare/v0.5.0...HEAD
[v0.5.0]: https://github.com/Lrmann818/Lore-Ledger/compare/v0.4.0...v0.5.0
[v0.4.0]: https://github.com/Lrmann818/Lore-Ledger/compare/v0.3.0...v0.4.0
[v0.3.0]: https://github.com/Lrmann818/Lore-Ledger/tree/v0.3.0
