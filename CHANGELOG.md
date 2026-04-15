# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Multi-character tracker card linking (Step 2): NPC and Party cards can be linked to a character entry via a `characterId` field. Linked cards read and write name, HP, class, status, and portrait through the canonical character entry (`js/domain/cardLinking.js`).
- Schema v5 migration: all tracker cards gain `characterId: null`; all character entries gain `status: ""`.
- Character deletion now shows a warning when linked tracker cards exist and snapshots their last known character data before unlinking.
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

[Unreleased]: https://github.com/Lrmann818/CampaignTracker/compare/v0.4.0...HEAD
[v0.4.0]: https://github.com/Lrmann818/CampaignTracker/compare/v0.3.0...v0.4.0
[v0.3.0]: https://github.com/Lrmann818/CampaignTracker/tree/v0.3.0
