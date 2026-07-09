# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

The canonical coding-agent rules live in [`AGENTS.md`](./AGENTS.md). **Read that file first**, before this one and before any other doc. If anything here conflicts with `AGENTS.md`, **`AGENTS.md` wins**.

Before opening any doc under `docs/`, check the [Agent Doc Map](./AGENTS.md#agent-doc-map) in `AGENTS.md`. It tells you which docs your task needs and which are historical records that no longer describe the system. Reading historical docs as if they were current is the most common way agents break things here — `docs/archive/**` in particular describes work that has already shipped.

---

## Commands

- `npm run dev` — Start Vite dev server
- `npm run build` — Production build to `dist/`
- `npm run test` — Run Vitest in watch mode
- `npm run test:run` — Run Vitest once (all tests)
- `npx vitest run tests/foo.test.js` — Run a single test file
- `npm run typecheck` — Run CheckJS static validation (`typescript@5.9.3`)
- `npm run preview` — Serve the production build (required for PWA and offline validation; dev server does not register the service worker)
- `npm run test:smoke` — Run Playwright smoke suite (install Chromium once with `npx playwright install chromium`)
- `npm run verify` — Full gate: typecheck + test:run + build; run before any merge
- Dev URL for state-safety work: `/?dev=1&stateGuard=warn`

---

## The Five Most Important Rules (Summary)

This is a quick-reference summary. The full rules and reasoning are in `AGENTS.md`.

1. **Do not break existing behavior.** Saved data, mobile layout, PWA behavior, backup/import/export, and existing UI contracts are non-negotiable. ([Prime Directive](./AGENTS.md#prime-directive))
2. **Hard bans are non-negotiable.** No frameworks, no TypeScript rewrite, no storage format changes without migration, no feature removal, no large CSS rewrites for cleanliness, no new modal frameworks, no duplicating canonical data. ([Hard Bans](./AGENTS.md#hard-bans))
3. **Scope discipline.** If a change is discovered mid-task to require touching more than ~3 files (or significantly more than the original plan), stop and explain before continuing. This is a circuit breaker for scope drift, not a planning constraint. ([Scope Discipline](./AGENTS.md#scope-discipline-circuit-breaker))
4. **SRD/Builder work has its own rules.** SRD 5.1 is the active source. SRD 5.2.1 is retired. Read `docs/reference/srd-licensing-notes.md`, `docs/reference/builder-scope-greenlist.md`, and `docs/reference/content-registry-plan.md` before any builder work. ([SRD / Builder Content Rules](./AGENTS.md#srd--builder-content-rules))
5. **Output format.** When reporting work, use the five-part structure: Executive summary / Exact files changed / What changed and why / Verification performed / Remaining risks or follow-ups. Be honest about anything not verified. ([Output Expectations](./AGENTS.md#output-expectations))

---

## Architecture Quick Reference

`app.js` is the **sole composition root** — it wires every service and injects them downward. Nothing imports `app.js`.

**Layer order (dependencies flow downward only):**

```text
app.js
  js/state.js      canonical state object; CURRENT_SCHEMA_VERSION; migrations in migrateState()
  js/domain/*      factories and explicit state-action helpers
  js/storage/*     persistence, save lifecycle, IndexedDB helpers
  js/ui/*          shared page-agnostic UI systems
  js/features/*    reusable cross-page flows
  js/pages/*       page-specific controllers and panels
  js/pwa/*         service worker and update handling
  js/utils/*       low-level helpers with minimal app knowledge
```

`js/pages/*` must not become a dependency for any layer above it. Shared behavior is extracted to `js/ui/*`, `js/features/*`, or `js/domain/*` only when at least two callers need it.

**State and save lifecycle:**

- Mutate through `createStateActions()` helpers or `withAllowedStateMutation()`.
- Every user-visible structured-state change must call `SaveManager.markDirty()`.
- `sanitizeForSave()` is the source of truth for what is persisted — a field living on `state` is not automatically saved.
- Main save: `localStorage["localCampaignTracker_v1"]` (campaign vault). Binary assets: IndexedDB `blobs`. Long spell notes: IndexedDB `texts`.
- New persisted fields require: default in `js/state.js`, an entry in `SCHEMA_MIGRATION_HISTORY`, and a `migrateState()` step for old saves.

**Character model:**

- Active character lives in `state.characters.entries`, selected by `state.characters.activeId`. Resolve it with `getActiveCharacter(state)`.
- The legacy `state.character` key is valid only in migration/backward-compatibility code. Never use it in new production code.
- Builder characters have `build !== null`; freeform characters have `build: null`. Do not collapse the two modes.

**Module conventions:**

- `create*` builds a service/controller; `init*` wires a concrete UI module; `setup*` is a one-time composition helper.
- New modules accept a single `deps` injection object and return `destroy()` for lifecycle cleanup.
- New shared infrastructure, storage, and page-orchestration modules start with `// @ts-check` + JSDoc typedefs.
- DOM anchors: use `requireEl(...)` / `requireMany(...)` and fail soft in production.
- Prefer `AbortController` for listener ownership over manual `removeEventListener` bookkeeping.

---

For full workspace rules, UI contracts, SRD/builder rules, CSS rules, accessibility rules, persistence rules, testing expectations, and the output format — see `AGENTS.md`.
