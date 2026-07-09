# Lore Ledger Multi-Branch Architecture and Sync Review

> ## ⚠️ ARCHIVED — POINT-IN-TIME AUDIT
>
> **Archived 2026-07-09. Every commit hash, branch tip, test count, and conflict count
> below was measured on 2026-07-02 and is now stale.**
>
> The branch topology this audit describes no longer exists. The three-way divergence
> between `main`, `develop`, and `builder-wizard` has since been resolved: the schema was
> unified into a single lineage and `develop` was fast-forwarded to `builder-wizard`. The
> 18 merge conflicts, the "48 / 86 commits apart" figures, and the phased migration plan
> at the end were all executed or superseded.
>
> Do not run the migration plan in this document. Do not use its commit hashes.
>
> For current state, read `AGENTS.md` and `docs/state-schema.md`.
>
> Kept for provenance: it records the reasoning behind the branch-unification work.

**Date:** 2026-07-02
**Reviewer:** Claude Code (senior staff-level architecture, test, security, and release-readiness audit)
**Status:** Archived audit — no source files were modified as part of this review.

---

## Scope of Review

A read-only audit of three checkouts of the Lore Ledger repository covering: branch divergence, feature parity, duplicated vs. shared code, data-model compatibility, character-builder readiness, web/mobile sync strategy, security and privacy, data integrity, performance, test quality, dead code, and a phased migration plan.

## Branches / Checkouts Reviewed

| Role | Branch | Path | Tip commit at review time |
|---|---|---|---|
| Live website | `main` | `LoreLedger-worktrees/lore-ledger-live` | `1314add` |
| Mobile app (iOS/Capacitor) | `develop` | `LoreLedger` (original repo folder) | `7b66d0d` |
| Character builder | `builder-wizard` | `LoreLedger-worktrees/lore-ledger-character-builder` | `8bb5e5c` |

**Git topology (measured):**

- `main` is a **strict ancestor** of `develop` — develop = main + 44 commits; main has **zero** commits develop lacks.
- `builder-wizard` forked at `44b0122`, 4 commits behind main's tip (those 4 are docs + `robots.txt` + untracking personal notes), and carries **86 commits** of its own.
- `develop` vs `builder-wizard`: 48 / 86 commits apart respectively (merge-base `44b0122`).

## Commands Run

| Branch / Checkout | Command | Result | Notes |
|---|---|---|---|
| all (shared repo) | `git log` / `git merge-base` / `git rev-list --count` | Pass | Topology above |
| all | `git diff --stat / --name-status` between branches | Pass | develop: 101 files / +10,277 lines; builder: 109 files / +71,154 (incl. SRD license PDF) |
| all | `git merge-tree --write-tree develop builder-wizard` | Pass (18 conflicts) | 13 code/test conflict files + 5 docs/config |
| main / live | `npm ci` | Pass | |
| main / live | `npm run verify` (test:run + typecheck + build) | **Pass** | 380 tests / 29 files; JS 401 kB min / 113 kB gz |
| develop / mobile | `npm ci` | Pass | |
| develop / mobile | `npm run verify` | **Pass** | 454 tests / 40 files; JS 432 kB / 122 kB gz; 2 benign splash-asset resolve warnings |
| builder-wizard | `npm ci` | Pass | |
| builder-wizard | `npm run verify` | **Pass** | 665 tests / 37 files; JS 506 kB / 144 kB gz — **Vite chunk-size warning** |
| all | grep for `fetch(` / `XMLHttpRequest` / `WebSocket` / `sendBeacon` in app JS | Pass | **Zero runtime network calls on any branch** |
| all | CSP inspection in `index.html` | Pass | `default-src 'self'; script-src 'self'` on all three |
| — | `npm run test:smoke` (Playwright) | **Not run** | Requires Chromium install + preview server per checkout; `tests/smoke/` inspected statically instead |
| — | iOS build (`cap sync` / Xcode archive) | **Not run** | Requires Xcode/CocoaPods toolchain; out of scope for a read-only audit |

## Executive Summary

The single most important finding reframes the whole question: **this is not a web codebase and a mobile codebase — it is one codebase on three branches of one repo.** The "mobile app" is the same vanilla-JS + Vite PWA wrapped in Capacitor. The drift problem is a *branching-cadence* problem, not an architecture problem, which means no monorepo, no package extraction, and no rewrite is needed.

| Branch | Rating |
|---|---|
| Live website (`main`) | **Ready** — all gates green; simply stale (schema v5, no themes/reorder/builder) |
| Mobile app (`develop`) | **Mostly ready with minor issues** — gates green, clean native isolation; iOS repo-hygiene items and party to the schema collision |
| Character builder (`builder-wizard`) | **Usable but needs targeted fixes** — gates green, best test suite, pure rules engine; schema collision, 48 commits behind develop, bundle growth |

- **Are web and mobile drifting?** No — mobile is a strict superset of web. The real drift is **develop ↔ builder-wizard**, which evolved the save schema independently.
- **Is builder-wizard suitable as shared foundation?** Yes. Its domain layer (`js/domain/rules/`, `builderSheetSeeding`, `featureUses`, `characterRest`) is pure, DOM-free JS that runs identically in the Capacitor WKWebView.
- **Biggest architectural risk:** the **schema version collision** — develop and builder-wizard both claimed schema versions 6 and 7 with different meanings.
- **Safest next move:** merge `develop` **into** `builder-wizard` first (resolve the 13 enumerated code conflicts and renumber builder migrations), verify, then merge back to `develop`. `main` receives develop at the next web release.

## Top Findings

| Severity | Branch(es) | Area | Finding | Evidence | Recommended Action |
|---|---|---|---|---|---|
| **Blocker** | develop + builder-wizard | Data model | Schema versions 6/7 claimed twice with different meanings | develop `js/state.js`: v6 = "stable tracker session ids", v7 = "stable inventory item ids"; builder: v6 = "build and overrides", v7 = "manual Abilities & Features cards", v8 = "feature-use storage" | Renumber builder migrations to 8/9/10 during the develop→builder merge; develop's numbering wins |
| **High** | builder-wizard | Branch hygiene | Forked 4 commits behind main and 48 behind develop; 86 commits unmerged | `git rev-list --count`: develop vs builder = 48 / 86 | Merge develop into builder-wizard now, before divergence grows |
| **High** | develop ↔ builder-wizard | Merge risk | 13 code/test files conflict on merge | `git merge-tree`: `js/state.js`, `styles.css`, `cardLinking.js`, `combatEncounterActions.js`, `combatPage.js`, `npcCards.js`, `partyCards.js` + 6 test files | Resolve inside builder-wizard where the 665-test suite protects the result |
| **Medium** | builder-wizard | Content | 5 of 9 SRD data files are 0 bytes | `git ls-tree --long`: `classes.json`, `backgrounds.json`, `feats.json`, `subclasses.json`, `equipment.armor.json`, `equipment.weapons.json` empty | Fine pre-merge (registry handles absence); don't ship builder to users until classes exist |
| **Medium** | builder-wizard | Performance | JS bundle 506 kB, past Vite's warning; SRD JSON statically bundled | Build output chunk warning; `builtinContent.js` statically imports `game-data/srd/*.json` | Dynamic-import `game-data/` or add `manualChunks` before class/spell data lands |
| **Medium** | develop | Repo hygiene | Finder-duplicate artifacts committed to iOS project | `ios/App/App/config 2.xml`, `Splash.imageset/splash 1.png`, `splash 2.png` | Delete; verify the Xcode asset catalog doesn't reference them before archiving |
| **Low** | develop | Build | Splash images warn at build time | Vite: "./splash.png … didn't resolve at build time" | Harmless (runtime-resolved); silence to keep the build log clean |
| **Low** | main, develop | Docs | Root task docs obsolete; builder already deleted/moved them | builder diff: `D AI_RULES.md`, `D STEP1_TASKS.md`, etc. | Resolved automatically by the merge; don't edit them on develop meanwhile |
| **Cleanup** | develop, main | Scripts | Zip/release scripts superseded | builder commit `fdecd25` deleted `make-zip*`, `verify-zip*`, `verify-release.ps1` | Arrives via merge |

## Detailed Findings

### Finding 1 — Schema version collision (Blocker)

- **Branches:** develop, builder-wizard
- **Files:** `js/state.js` (both branches), `docs/state-schema.md` (conflicts on merge)
- **Evidence:** `SCHEMA_MIGRATION_HISTORY` diverges at v6 — develop dated 2026-05-29 (session/inventory stable IDs), builder dated 2026-04-16/29/30 (build/overrides, manual feature cards, feature uses). `CURRENT_SCHEMA_VERSION` is 7 vs 8.
- **Why it matters:** `migrateState()` runs a stepwise loop keyed by version number (`while (v < CURRENT_SCHEMA_VERSION) applyMigrationStep(v)`). A mobile v7 save loaded by a builder build skips builder's v6/v7 migrations in that loop because the number claims "already done." Two design choices prevent immediate data loss: (a) all migrations are also re-applied unconditionally and idempotently after the loop; (b) the forward-compat guard (`if (v > CURRENT_SCHEMA_VERSION) return normalizeState(data)`) accepts newer saves as-is without downgrading, `sanitizeForSave` preserves the incoming `schemaVersion` and passes character entries through untouched, and `normalizeState` is additive (verified — it never rebuilds entries). Today this is a *semantic lie*, not a data-shredder — but the first migration that is not idempotent-safe to re-apply turns it into one.
- **Recommended action:** during the develop→builder merge, renumber builder's migrations to 8/9/10; update `SCHEMA_MIGRATION_HISTORY` and `docs/state-schema.md`; keep develop's 6/7. Only v5 is in the wild (live site; the iOS app has not shipped), so the renumber is safe.
- **Suggested test coverage:** cross-branch fixture tests — load a captured real v5 live-site save and a v7 mobile save through the merged `migrateState()` and assert session IDs, inventory IDs, *and* `build`/`overrides`/feature-use defaults all materialize. `tests/state.migrate.test.js` on each branch currently tests only its own lineage.

### Finding 2 — Long-lived parallel feature branch is the actual drift engine (High)

- **Branches:** all
- **Evidence:** builder-wizard carries 86 commits over ~2.5 months against a fork point predating all 44 mobile commits; 27 files were modified on both develop and builder-wizard, 13 of which genuinely conflict.
- **Why it matters:** the architecture is not causing drift — the layered composition-root design is good. The branching cadence is the problem: two vertical efforts each treated `js/state.js`, `styles.css`, and the combat/tracker modules as their own.
- **Recommended action:** merge develop → builder-wizard immediately. Adopt rules: feature branches sync from develop weekly minimum; schema changes are numbered on develop only.
- **Suggested test coverage:** not a test — a process rule, plus the contract fixtures from Finding 1.

### Finding 3 — Builder domain layer is cleanly reusable; UI layer is web-DOM but WKWebView-safe (High value, positive)

- **Branch:** builder-wizard
- **Files:** `js/domain/rules/deriveCharacter.js` (524 lines), `js/domain/rules/registry.js`, `js/domain/rules/builtinContent.js`, `js/domain/builderSheetSeeding.js`, `js/domain/featureUses.js`, `js/domain/manualFeatureCards.js`, `js/domain/characterRest.js`; UI: `js/pages/character/builderWizard.js` (1,691 lines) + 4 builder panels (~1,800 lines)
- **Evidence:** import-graph inspection — the domain modules import only other domain modules and static JSON; no `document`, no `window`, no storage, no page code. The wizard/panels live in `js/pages/` and touch the DOM, but "mobile" is the same DOM inside WKWebView.
- **Why it matters:** strongest evidence that builder-wizard can be the shared foundation with no restructuring. Only touch-target sizing and small-viewport behavior need verification (develop's stepper-usability commit `7b66d0d` shows exactly this class of fix will be needed).
- **Recommended action:** none structural; on-device touch pass after merge.
- **Suggested test coverage:** a Playwright smoke for the wizard happy path (create dragonborn → finish → sheet seeded) — currently absent.

### Finding 4 — Bundle growth and statically-bundled SRD data (Medium)

- **Branch:** builder-wizard
- **Files:** `js/domain/rules/builtinContent.js`, `vite.config.js`, `index.html`
- **Evidence:** JS chunk 506 kB min / 144 kB gz (main: 401 / 113); `index.html` grew 54 → 76 kB; PWA precache 688 kB vs 546 kB on main; Vite emits its 500 kB chunk warning. SRD JSON is imported statically, so today's ~27 kB of race/trait data is inlined — when classes, subclasses, feats, and equipment fill the five empty files, this multiplies.
- **Why it matters:** WKWebView cold-start parses the whole chunk; PWA precache grows for all users.
- **Recommended action:** lazy-load `game-data/` behind a dynamic `import()` in the registry, or a `manualChunks` entry — **after** the merge, not before.
- **Suggested test coverage:** a build-size budget check in CI (fail if gz exceeds a threshold).

### Finding 5 — iOS project contains committed duplicate artifacts (Medium)

- **Branch:** develop
- **Files:** `ios/App/App/config 2.xml`, `ios/App/App/Assets.xcassets/Splash.imageset/splash 1.png`, `splash 2.png`
- **Evidence:** the ` 2` / ` 1` filename pattern is macOS Finder duplication; a `config 2.xml` alongside the real config is a classic accidental commit.
- **Why it matters:** stray files in Xcode asset catalogs cause warnings and can break archive validation — and the project is at the archive/upload stage.
- **Recommended action:** delete; confirm `Contents.json` doesn't reference them; rebuild. Add to the pre-archive checklist.
- **Suggested test coverage:** none (checklist item).

### Finding 6 — Legacy `state.character` fully retired (Low, positive)

- **Branches:** all
- **Files:** `js/storage/backup.js:360` (builder-wizard)
- **Evidence:** the only remaining reference outside migration code is a validation check rejecting malformed legacy backups — the sanctioned use per CLAUDE.md.
- **Why it matters:** the multi-character migration is complete and disciplined on all branches.
- **Recommended action:** none.

## Branch Divergence Report

| Area | main / Live | develop / Mobile | builder-wizard | Risk | Recommendation |
|---|---|---|---|---|---|
| Features | Baseline | +themes, tab reorder, AC tracking, stabilize, native export/splash | +builder wizard, rules engine, rest, feature uses | Low | Merge, don't cherry-pick |
| Character builder | Absent | Absent | Full (wizard + engine + SRD data) | Low | Lands via develop |
| Data models | Schema v5 | v7 (session/inventory IDs) | v8 (build/overrides/features) | **Blocker** | Renumber builder 6/7/8 → 8/9/10 |
| Validation | Baseline backup validation | Same + minor | Same + builder normalization in `characterHelpers` | Low | Already shared code |
| Routing/navigation | Page controllers, no router | Same | Same + builder wizard flow | Low | None |
| Storage | v5 saves; localStorage + IndexedDB | + `nativeBackupExport.js` | Unchanged infra | Medium | Retest native export post-merge |
| Styling/theme | Baseline single `styles.css` | Theme system (`themeState.js`), native scaling, steppers | Builder panels, banners | Medium | `styles.css` conflict is mechanical but manual |
| Components | Baseline | `tabReorder`, `appSplash` | `persistentBanner`, `selectDropdown` changes, builder panels | Low | Mostly additive, different files |
| Tests | 380 | 454 | 665 | Medium | 6 test files conflict on merge |
| Build/deployment | Static `dist/` | + Capacitor/Xcode/pods | Static; 506 kB chunk warning | Medium | Code-split SRD data before content grows |
| Assets | Baseline; has `robots.txt` | + icons/splash/`privacy.html`; stray Finder dupes | Missing `robots.txt` (forked before it) | Low | Clean dupes; robots.txt returns via merge |
| Documentation | Old flat layout | Old layout, edited | Full reorg (`docs/{operations,features,reference,plans,design}/`) + `AGENTS.md` + SRD licensing | Medium | Builder's docs structure should win; 3 doc conflicts |

## Feature Parity Report

| Feature | main / Live | develop / Mobile | builder-wizard | Parity Status | Notes |
|---|---|---|---|---|---|
| Campaign tracker (sessions/NPC/party/locations) | ✓ | ✓ enhanced | ✓ baseline | Mobile ahead | Stable IDs + drag-reorder only on develop |
| Character sheet (freeform) | ✓ | ✓ | ✓ enhanced | Diverged implementation | Builder adds panels; develop adds stepper/layout fixes |
| Character builder wizard | ✗ | ✗ | ✓ | Character-builder ahead | 1,691-line wizard + 4 panels |
| Rules engine / SRD content | ✗ | ✗ | ✓ (partial data) | Character-builder ahead | 5 of 9 SRD files empty |
| Rest mechanics / feature uses | ✗ | ✗ | ✓ | Character-builder ahead | Pure domain modules |
| Combat workspace | ✓ | ✓ + AC + Stabilize | ✓ modified | Diverged implementation | `combatPage.js` conflicts on merge |
| Themes (campaign-specific) | System toggle only | ✓ full system | System toggle only | Mobile ahead | `themeState.js` is web-compatible, not native-only |
| Tab reordering (drag/touch) | ✗ | ✓ | ✗ | Mobile ahead | 454-line `tabReorder.js` + long-press support |
| Native iOS packaging | ✗ | ✓ | ✗ | Mobile ahead | Correctly isolated |
| Native backup export | ✗ | ✓ | ✗ | Mobile ahead | Swift plugin + JS bridge |
| Backup/import/export (web) | ✓ | ✓ | ✓ | In sync | Same `backup.js` lineage |
| PWA/offline | ✓ | ✓ | ✓ | In sync | Identical vite-plugin-pwa setup |
| Privacy policy page | ✗ | ✓ | ✗ | Mobile ahead | Live site should get this too |
| Dice / calc / map | ✓ | ✓ | ✓ | In sync | |

## Character-Builder Readiness Review

1. **Reusable as-is:** the entire `js/domain/rules/` engine, `builderSheetSeeding.js`, `featureUses.js`, `manualFeatureCards.js`, `characterRest.js`, SRD adapters/ingestion scripts (`scripts/adapters/`, `scripts/fetch-srd-data.js`), `game-data/`, and 600+ builder-related unit tests. The schema additions themselves (`build`, `overrides`, feature-use storage) once renumbered.
2. **Web-only:** strictly, nothing — no web-only APIs in the builder path.
3. **Mobile-incompatible / needs adaptation:** the wizard UI needs touch-usability verification (tap targets, steppers, long forms on small viewports — exactly the class of fixes develop made in `2a1a2b8` and `7b66d0d`, which builder-wizard lacks). Nothing structural.
4. **Canonical data model:** the builder-wizard character entry model — `build !== null` for builder characters, `build: null` for freeform, plus `overrides` — with develop's stable-ID work merged in. The union is canonical; neither branch's model should be discarded.
5. **Shared validation:** already shared by construction — `characterHelpers.normalizeCharacterOverrides`, `migrateState`, `sanitizeForSave`, `backup.js` validation are one code path for both platforms. Do not fork per platform.
6. **Platform-specific UI:** only what already is: `appSplash`, `nativeBackupExport`, `tabReorder` touch handling, native scaling CSS behind `.is-native-app`. Builder UI stays shared.
7. **Tests required before merging:** (a) cross-version migration fixtures (v5 live save, v7 mobile save → merged target); (b) builder-wizard Playwright smoke; (c) develop's mobile smoke suite re-run on the merged tree; (d) backup round-trip on a merged-schema save.
8. **Which branch receives builder work first:** **develop** — it is the de-facto integration trunk (strict superset of main), holds the schema numbers that must win, and its mobile smoke suite is most at risk from builder's shared-file changes.
9. **Safest path:** develop → builder-wizard (resolve 13 conflicts + renumber schema in the feature branch, full verify) → builder-wizard → develop (near-clean) → device soak via `cap:sync:ios` → develop → main at the next web release.

## Recommended Sync Architecture

**Do not restructure the repo.** A monorepo/packages split would solve a problem that does not exist: one build, one `dist/`, Capacitor wraps it. The layered architecture (`app.js` composition root; `js/domain` pure; `js/pages` DOM; native code behind `isNativeAppRuntime()`) already *is* the shared core. Packaging would add version-pinning overhead between things that today are one atomic commit, and it violates the project's own scope discipline.

- **Repo/branch strategy:** trunk-based. `develop` = integration trunk (everything merges here first). `main` = web release branch (merged from develop at release time — it is already a strict ancestor; keep it that way). Feature branches short-lived, syncing from develop weekly minimum.
- **Shared modules:** `js/domain/*`, `js/state.js`, `js/storage/*`, `js/ui/*` — already shared. Formalize: `js/state.js` migrations are *numbered* on develop only.
- **Stays separate:** `ios/`, `capacitor.config.ts`, `js/storage/nativeBackupExport.js`, `js/utils/runtime.js` gating, `.is-native-app` CSS.
- **Character data:** one canonical schema in `js/state.js` with merged migration history; `docs/state-schema.md` as the human contract.
- **Validation:** stays in the shared domain/storage layer (it already is).
- **Tests/fixtures shared:** add `tests/fixtures/saves/` with captured real saves (v5-live, v7-mobile, post-merge) and a `saveCompatibility.test.js` that runs every fixture through `migrateState` + `sanitizeForSave` round-trip. This contract test replaces hope.
- **Releases:** web = merge develop→main + deploy `dist/`; iOS = tag on develop + `cap:sync:ios` + archive. The same commit should be buildable for both.
- **Drift prevention:** fixture suite + schema-numbering rule + weekly branch syncs; optionally a CI check that `SCHEMA_MIGRATION_HISTORY` on any branch is a strict prefix-extension of develop's.

## Suggested Folder / Package Structure

**No restructure recommended.** The only structural additions worth making, inside the current layout:

```text
tests/fixtures/saves/        # captured real saves: v5-live.json, v7-mobile.json, v10-merged.json
tests/saveCompatibility.test.js
```

## Migration Plan

| Phase | Goal | Files / areas | Risk | Tests needed | Manual verification |
|---|---|---|---|---|---|
| **1 — Stabilize & document divergence** | Freeze the facts | This report; schema-collision note in `docs/state-schema.md` on both branches; capture save fixtures | None | n/a | Export a v5 save from the live site and a v7 save from the mobile build |
| **2 — Merge develop into builder-wizard** | Single lineage | The 13 conflict files, `js/state.js` centrally; renumber builder migrations 6/7/8 → 8/9/10; reconcile `SCHEMA_MIGRATION_HISTORY`; keep develop's package.json deps + builder's `lore-ledger` name | **High** — the one risky step; do it in the worktree, no time pressure | Full 665-suite + develop's mobile-behavior tests green post-merge; new tests for renumbered migrations | Load both fixture saves in the merged build; verify freeform and builder characters both round-trip |
| **3 — Shared fixtures & contract tests** | Make Phase 2's verification permanent | `tests/fixtures/saves/`, `saveCompatibility.test.js`; freeform-character-untouched guard; wizard Playwright smoke | Low | The new tests themselves | None |
| **4 — Merge builder-wizard into develop** | Builder on the trunk | Near-clean after Phase 2 | Medium | Full verify + Playwright smoke on preview build | `npm run preview` PWA check; `cap:sync:ios` + on-device smoke (wizard on a phone, steppers, touch targets) |
| **5 — Bring live web into parity** | Ship | Merge develop → main when builder content is user-ready (decide: ship races-only or wait for classes). Also ports themes, tab reorder, AC tracking, privacy.html to the live site | Medium — user-facing; real v5 saves migrate | Fixture suite is the gate | Pre-ship smoke per `docs/operations/pre-ship-smoke-test.md`; verify a real production save migrates on a staging deploy first |
| **6 — Prevent recurrence** | No second collision | Process rules: schema numbers assigned only on develop; weekly feature-branch syncs; optional CI prefix-check on `SCHEMA_MIGRATION_HISTORY`; build-size budget | None | CI checks | None |

## Test Suite Review

### Live Website — `main` (380 tests, 29 files)

- **Strengths:** migration and state tests, backup round-trips, page smoke suite.
- **Weak tests:** none notable — the suite is simply frozen at the fork point.
- **Missing:** everything the other branches added.
- **Top tests to add:** none directly — invest on develop.
- **Rewrite/remove:** nothing.

### Mobile App — `develop` (454 tests, 40 files)

- **Strengths:** excellent behavioral coverage of the new mobile UX — `tabReorder.test.js` (224 lines), `theme.test.js` (214), button-state style tests pinning hover-vs-touch semantics, `combatPage.dom.test.js`.
- **Weak tests:** `buttonStateStyles.test.js` parses CSS text and is mildly brittle — but it encodes real regressions that were fought; keep it.
- **Missing:** nothing exercises `NativeBackupExportPlugin.swift` or the JS↔native bridge; the JS half of `nativeBackupExport.js` could be unit-tested with a mocked plugin and isn't.
- **Top tests to add:** mocked-bridge test for native export; cross-version save fixtures.
- **Rewrite/remove:** nothing.

### Character-Builder — `builder-wizard` (665 tests, 37 files)

- **Strengths:** the best suite of the three. `rulesEngine.test.js` (618 lines), adapter tests, and — standout — `tests/data/referential-integrity.test.js` validating SRD JSON cross-references; expanded migration tests (+161 lines in `state.migrate.test.js`).
- **Weak tests:** none flagged.
- **Missing:** no end-to-end wizard smoke — the 1,691-line `builderWizard.js` controller is protected only indirectly; migration tests cover only builder's own version lineage.
- **Top tests to add:** (1) wizard happy-path Playwright smoke; (2) cross-branch save fixtures; (3) an explicit guard that a freeform character (`build: null`) is completely unaffected by every builder migration.
- **Rewrite/remove:** nothing.

### Cross-Platform Tests to Add

- Fixture-based `saveCompatibility.test.js` — proves any save from any shipped version loads on both platforms.
- Backup export → import round-trip across schema versions.
- Build-size budget assertion.
- One Playwright smoke run against the production `preview` build (PWA path) per release — the docs already prescribe this manually.

## Security and Privacy Review

**All branches (shared posture — genuinely strong):** zero runtime network calls in application JS (verified by grep on all three branches); CSP `default-src 'self'; script-src 'self'` in `index.html` on all three; all data local (localStorage `localCampaignTracker_v1` + IndexedDB `blobs`/`texts`); no analytics, no third-party scripts, no CDN dependencies. Runtime dependency surface: zero on main/builder, Capacitor only on develop.

- **main:** nothing further. `robots.txt` present.
- **develop:** `NativeBackupExportPlugin.swift` writes user-chosen backup files via native file pickers — correct, no silent filesystem writes. `public/privacy.html` exists and is linked from settings; the live site lacks it — worth porting. iOS `Info.plist` was not audited line-by-line; re-check for unused permission strings before App Store submission.
- **builder-wizard:** `scripts/fetch-srd-data.js` fetches SRD content at development time only — not in the app bundle path. SRD 5.1 licensing is handled unusually well (license PDF/text committed, attribution docs, scope greenlist). Consider whether the license PDF needs to live in git given the `.txt` twin.

## Data Integrity Review

- **main:** schema v5 — the only version with real users. Frozen and safe.
- **develop:** v6/v7 migrations (stable IDs) are additive and idempotent. `sanitizeForSave` preserves unknown entry fields and the incoming `schemaVersion`; the forward-compat guard refuses to downgrade newer saves. Native backup export adds a second export path — must be re-verified against merged-schema saves after the merge (test currently absent).
- **builder-wizard:** same defensive machinery, plus builder migrations that seed `build: null`/`overrides` without touching freeform data. **The version collision (Finding 1) is the single data-integrity risk in the project** — everything else in the persistence layer is unusually disciplined (migration history registry, `sanitizeForSave` as the single source of persistence truth, documented schema).
- **Future sync:** if cloud/device sync ever arrives, the schemaVersion + idempotent-migration design is the right foundation — but the version registry must be single-lineage first.

## Performance Review

- **main:** 401 kB JS / 98 kB CSS, 546 kB PWA precache. Fine.
- **develop:** 432 kB JS / 121 kB CSS, 605 kB precache. WKWebView cold-start parses the whole chunk; acceptable today. The splash-handoff work (`appSplash.js`) exists precisely to mask this — good.
- **builder-wizard:** 506 kB JS (warning threshold crossed), 76 kB `index.html`, 688 kB precache. Two structural pressures: (1) statically-imported SRD JSON grows multiplicatively as the five empty files fill; (2) the single-file `index.html` shell grows with every panel. Recommendation: dynamic-import the content registry post-merge; consider `manualChunks` for `game-data`. The 1,691-line `builderWizard.js` is a maintainability hotspot more than a performance one — the file most likely to need splitting as wizard steps multiply.

## Dead Code / Unused Code Report

| Branch / Checkout | Item | Type | Confidence | Evidence | Recommended Action |
|---|---|---|---|---|---|
| develop, main | `STEP1/2/4_TASKS.md`, `MULTI-CHARACTER_DESIGN.md`, `AI_RULES.md`, `NEW-FEATURES-ROADMAP.md` | Obsolete docs | High | builder-wizard already deleted/relocated them | Resolved by merge; don't edit meanwhile |
| develop, main | `scripts/make-zip*.{sh,ps1}`, `scripts/make-pages-zip.sh`, `scripts/verify-zip*`, `scripts/verify-release.ps1` | Obsolete scripts | High | Deleted on builder-wizard (`fdecd25`) | Resolved by merge |
| develop | `ios/App/App/config 2.xml` | Duplicate artifact | High | Finder-duplicate name alongside real config | Delete before archiving |
| develop | `Splash.imageset/splash 1.png`, `splash 2.png` | Duplicate assets | Medium | Same pattern; catalog may or may not reference them | Check `Contents.json`; delete if unreferenced |
| builder-wizard | `game-data/srd/{classes,backgrounds,feats,subclasses,equipment.armor,equipment.weapons}.json` | Empty placeholders | High (that they're empty; intentional) | 0 bytes in `git ls-tree --long` | Keep; track as open content work |
| builder-wizard | `docs/reference/SRD5.1-CCBY4.0License.pdf` | Redundant binary | Medium | `.txt` twin exists in the same directory | Consider keeping only the .txt |

## Release / Merge Readiness Checklist

### Live Website — `main`

| Item | Status | Notes |
|---|---|---|
| Builds | Pass | verify green |
| Tests | Pass | 380/380 |
| Data safety | Pass | v5, stable |
| Security/privacy | Pass | No network, strict CSP; privacy.html missing (it's on develop) |
| Performance | Pass | 401 kB / 113 kB gz |
| Accessibility | Concern | Not directly audited this pass; develop's aria/button-state work shows active attention |
| Deployment readiness | Pass | It's live |

### Mobile App — `develop`

| Item | Status | Notes |
|---|---|---|
| Builds | Pass | Web verify green; Xcode archive not attempted |
| Tests | Pass | 454/454 |
| Data safety | Concern | Schema v6/7 collides with builder numbering — fine alone, blocker for merging |
| Security/privacy | Pass | Privacy policy live; native export user-mediated |
| Performance | Pass | Splash handoff masks cold start |
| Accessibility | Pass | Touch-target and aria work recent and tested |
| Mobile behavior | Pass | Prior smoke 14/14 + dedicated smoke tests |
| App readiness | Concern | Known blockers: App Store metadata + archive/upload; plus `config 2.xml` cleanup |

### Character-Builder — `builder-wizard`

| Item | Status | Notes |
|---|---|---|
| Builds | Pass | verify green, with chunk-size warning |
| Tests | Pass | 665/665, best suite of the three |
| Character data model | Concern | Right model, wrong version numbers |
| Reusability | Pass | Domain layer fully platform-agnostic |
| Web compatibility | Pass | It is the web app |
| Mobile compatibility | Concern | Runs in WKWebView but lacks develop's touch fixes; untested on device |
| Merge readiness | Fail | 48 commits behind develop, 13 code conflicts, schema renumber required first |

## Recommended Fix Order

**Must fix first**

1. Capture v5 and v7 save fixtures (export from the live site and the mobile build).
2. Merge develop → builder-wizard with schema renumber to 8/9/10 — the one genuinely risky task; everything else waits on it.

**Should fix soon**

3. Contract/fixture test suite (`saveCompatibility.test.js`).
4. Wizard Playwright smoke.
5. Merge builder-wizard → develop.
6. On-device wizard touch pass.
7. Delete `config 2.xml` / duplicate splash PNGs before any archive attempt.

**Can defer**

- Dynamic-import SRD data / `manualChunks` (before classes data lands, not before merge).
- Porting `privacy.html` to main (comes with Phase 5 anyway).
- Splitting `builderWizard.js`.

**Cleanup only**

- SRD license PDF vs. txt.
- Build-log splash warnings.
- Obsolete root docs (the merge handles them).

## Final Verdict

1. **Are live web and mobile too far apart?** No — mobile is a strict superset of the live site; merging develop to main is a fast-forward-style release, not a reconciliation. The dangerous gap is **develop ↔ builder-wizard**: at the outer edge of comfortable (13 code conflicts, one schema collision) but fully recoverable today. In another two months of parallel work it would not be.
2. **Should builder-wizard become the shared foundation?** Yes — its domain layer is the best-engineered and best-tested code in the project, platform-agnostic by construction, with professional docs/licensing groundwork. But it becomes the foundation *by merging through develop*, not by being anointed a new trunk; it is missing 48 commits of mobile work it cannot ship without.
3. **Architecture/branch strategy going forward:** keep the single codebase and current layering — no monorepo, no package extraction. Trunk-based flow: develop = integration trunk, main = web release pointer, feature branches sync weekly, schema versions assigned only on develop.
4. **Fix before merging anything:** the schema renumber (builder 6/7/8 → 8/9/10) and the save fixtures proving both lineages migrate correctly. Everything else can ride along or follow.
5. **Blunt summary:** the project is in much better shape than feared. The persistence layer's defensive design already neutralized the one real landmine, the security posture is exemplary for a local-first app, and all three branches pass their full gates. The only thing that actually went wrong is that two feature efforts ran too long without merging and both grabbed the same schema numbers — a process failure with a one-afternoon fix, not an architecture failure.

## Next Prompt

Give Claude Code the following prompt to turn this review into a safe, phased implementation plan:

> Read `docs/lore-ledger-multi-branch-review.md` and produce a detailed, phased implementation plan for Phase 1 and Phase 2 of its Migration Plan — do not write any code yet.
>
> Specifically:
>
> 1. Plan the capture of save fixtures: a schema-v5 export from the live site (`main`) and a schema-v7 export from the mobile build (`develop`), stored under `tests/fixtures/saves/`.
> 2. Plan the merge of `develop` into `builder-wizard` in the `lore-ledger-character-builder` worktree, including: renumbering the builder-wizard schema migrations from 6/7/8 to 8/9/10 so develop's v6 (session stable IDs) and v7 (inventory stable IDs) keep their numbers; reconciling `SCHEMA_MIGRATION_HISTORY` and `docs/state-schema.md`; a file-by-file conflict-resolution strategy for the 13 known conflicting code/test files (`js/state.js`, `styles.css`, `js/domain/cardLinking.js`, `js/domain/combatEncounterActions.js`, `js/pages/combat/combatPage.js`, `js/pages/tracker/panels/npcCards.js`, `js/pages/tracker/panels/partyCards.js`, and 6 test files) that preserves both branches' behavior; and keeping develop's package.json dependencies with builder-wizard's `lore-ledger` package name.
> 3. Define the exact verification gate: `npm run verify` green, all 665 builder tests plus develop's mobile-behavior tests passing, and a new migration test proving a v7 mobile save gains `build`/`overrides`/feature-use defaults and a v5 save gains everything.
> 4. List rollback steps if the merge goes wrong.
>
> Present the plan for approval before making any changes.
