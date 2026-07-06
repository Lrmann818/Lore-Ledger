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
- Phase 3E foundation: Vitals resource tiles can open Resource Settings through press-and-hold or keyboard activation, without visible tile settings buttons; the dialog writes only `resource.recovery` and leaves untagged/manual resources untouched until assigned.
- Phase 3F foundation and polish: character-owned manual/freeform/custom Abilities & Features cards can be created, edited, deleted, reordered, collapsed, persisted separately from derived cards, and rendered in the same panel while derived cards remain read-only; manual-card management actions live behind the gear/settings menu, notes/descriptions can collapse independently, and optional plain-text attack, damage, and effect fields are supported while preserving legacy `damageEffect`.
- Phase 3G foundation: manual/custom Abilities & Features cards can optionally track feature-specific limited uses with a label, current/max uses, recovery metadata, Use/Regain/Reset controls, defensive clamping, and Short Rest / Long Rest recovery through the existing active-character rest helper; derived/read-only cards and broad shared resource pools remain out of scope.
- Phase 3H foundation: derived Dragonborn Breath Weapon cards now track uses through character-owned `featureUses["dragonborn-breath-weapon"].current`, default missing state to full uses, clamp Use/Regain/Reset controls, and recover on Short Rest or Long Rest without storing the derived card in `manualFeatureCards[]` or `character.resources[]`.
- Phase 3I: Dragonborn builder wizard Finish now seeds editable passive trait text into Features / Traits and fixed Dragonborn languages into Languages while keeping Breath Weapon derived and preserving user-owned text.
- Phase 3J: Builder Summary and Builder Abilities copy now clarifies that Builder Summary remains temporary review/scaffolding, normal panels are the play surface, live-derived values stay synchronized, and seeded text is user-owned after creation.
- Combat card vitals polish: combat participant cards now show compact HP and manually editable AC beside each other; AC follows the existing linked-card source pattern without adding AC derivation, armor/equipment automation, or builder AC automation.

### Fixed

- Restored mobile usability of the number spinner/stepper controls. On touch/coarse-pointer devices the ▲▼ steppers were hidden and non-interactive until the input was focused, so the first tap fell through to the field (popping the keyboard) instead of stepping; they are now always visible and tappable there with slightly larger hit targets, while desktop keeps the hover/focus reveal.
- Fixed the per-level spell "Reset" button so it refills slots — copying each level's max ("total") into current ("used") — in addition to clearing the per-spell cast flags. Blank/zero max values are mirrored safely (blank clears current, `0` stays `0`); slot-less cantrip levels keep their cast-flag reset only.
- Restored the previous stable splash-to-app timing by removing the pre-app intro-audio attempt and keeping intro music on the established Hub-open flow.
- Added an app-layer splash handoff for native launches so the installed iOS app holds the branded splash until both app restore and a controlled minimum duration are complete, instead of depending on Xcode/debugger startup slowness.
- Simplified the native iOS launch screen to a plain warm/dark bridge background so the branded Lore Ledger splash artwork appears only once in the managed web splash.
- Kept the earliest native, bridge, and source-HTML backgrounds aligned to the managed splash background to reduce black seams during iPhone native-to-web handoff.
- Hardened backup export for iOS/native contexts by preferring the system share sheet when direct blob downloads are unreliable.
- Unified the desktop/native topbar control height so Tracker, Character, Map, combat, calculator, dice, and settings buttons share the same visual height through a topbar-scoped CSS token.
- Lowered the Ability card `Mod` / `Save` row so the save proficiency bubble no longer crowds the move controls at the narrow two-column Character layout.
- Promoted the Map workspace title to a proper panel heading so it matches the rest of the app without tightening the toolbar controls.
- Aligned compact collapse/expand controls with the app’s shared button surface tokens and made touch pill-row reordering require a short intentional hold so iPhone horizontal scrolling still works when a swipe starts directly on a pill.

### Testing

- Captured redacted real save fixtures (`tests/fixtures/saves/`: v5 live site, v7 mobile app, v10 merged) with a fixture-driven `saveCompatibility.test.js` contract suite: any save any shipped build has ever written must migrate to the current schema, round-trip idempotently, materialize the builder fields, and keep freeform characters untouched.
- Builder wizard Playwright smoke (`tests/smoke/builderWizard.smoke.js`): Dragonborn happy path through all wizard steps, finish-time sheet seeding, derived Breath Weapon card, Builder Summary, and reload persistence.

### Changed

- Merged the mobile (`develop`) branch into the character-builder branch, unifying the save schema into a single lineage: develop's v6 (stable session ids) and v7 (stable inventory ids) keep their numbers, the builder migrations were renumbered 6/7/8 -> 8/9/10, and `CURRENT_SCHEMA_VERSION` is now 10.
- Combat participant cards keep the editable AC input (writing back to the linked character/tracker card) inside the mobile card body alongside death saves and the Stabilize flow.

### Not Shipped Yet

- Class/background choice pickers, generalized wizard seeding beyond the narrow Dragonborn passive-traits/languages proof, equipment, level-up flow, field locking/override UI, fuller Abilities & Features menu keyboard accessibility, possible `damageEffect` / `effectText` cleanup, partial regain behavior, shared resource pool automation such as Sorcery Points/Ki/Metamagic/Flexible Casting, attack/damage calculation, spell slot recovery, combat/linked-character rest behavior, specialized shared-resource-linked feature cards, AC derivation or equipment-based AC automation, broad derived feature-use automation, and broader HP/AC/saves/skills/spells or linked-card automation are still future Step 3 work. Derived builder values are not persisted back into flat character fields by default.

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
