# Lore Ledger

Vanilla JavaScript PWA for tabletop RPG campaign management. No framework — plain ES modules, no build-time transpilation.

## Commands

- `npm run dev` — Start Vite dev server
- `npm run build` — Production build to `dist/`
- `npm run test` — Run Vitest in watch mode
- `npm run test:run` — Run Vitest once (CI-friendly)

## Architecture

- `app.js` — Composition root. All dependencies are wired here and injected downward. Nothing imports app.js.
- `js/state.js` — Single mutable state object + schema migrations. `migrateState()` is append-only versioned.
- `js/storage/` — Persistence layer: `saveManager.js` (debounced save), `persistence.js` (load/save/exit), `backup.js` (import/export/reset), `blobs.js` (IndexedDB images), `texts-idb.js` (IndexedDB large text).
- `js/domain/stateActions.js` — Centralized state mutation helpers with prototype-pollution guards.
- `js/pages/` — Page modules: `tracker/`, `character/`, `map/`. Each has panel sub-modules.
- `js/ui/` — Shared UI: dialogs, popovers, masonry layout, theme, navigation, topbar widgets.
- `js/utils/dev.js` — Dev-mode state mutation guard (Proxy-based). Only active on localhost.
- `js/features/` — Cross-cutting features: autosize, image cropper, portrait flow.
- `tests/` — Vitest tests plus Playwright smoke coverage for migration, persistence, asset replacement, lifecycle, and focused browser regressions.
- `styles.css` — Single CSS file, 5000+ lines, 16 named themes.
- `index.html` — All static DOM structure lives here.

## Key Patterns

- **Dependency injection everywhere.** Modules export factory functions that receive deps. Intentional globals are limited to boot-time build/version metadata and the DEV-only `globalThis.__APP_STATE__` escape hatch.
- **State mutations go through `createStateActions()`** which wraps changes in `withAllowedStateMutation()`. Direct state writes trigger dev-mode warnings.
- **`SaveManager.markDirty()`** is how any code signals "state changed, schedule a save." It debounces and handles the full save lifecycle.
- **JSDoc types with `@ts-check`.** No TypeScript compiler — type safety comes from JSDoc annotations checked through `tsconfig.checkjs.json`. `js/utils/dev.js` is part of the current `@ts-check` surface.
- **`sanitizeForSave()`** strips ephemeral UI state (undo/redo, dice history) before persistence.

## Rules

- Do NOT introduce any framework (React, Preact, Solid, etc.). This is intentionally vanilla JS.
- Do NOT use TypeScript files. Use JSDoc `@typedef` and `@ts-check` for type safety.
- Do NOT change runtime logic when fixing types — only add or correct annotations.
- All state mutations must go through `stateActions.js` helpers or `withAllowedStateMutation()`.
- New IDB/storage code must follow the existing dependency injection pattern (no direct imports of state).
- When writing tests, use Vitest. Tests live in `tests/`.
- One file at a time. Show what changed and why before moving to the next file.
- If a change would affect more than ~3 files, stop and explain the plan first.
