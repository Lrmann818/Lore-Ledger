# Session Handoff — 2026-07-18 (Preview-compatible smoke harnesses)

_Point-in-time snapshot. The binding rules and work order live in
[`AGENTS.md`](../../AGENTS.md); the canonical smoke posture and the
preview-safe harness rules live in
[`browser-smoke-status.md`](../operations/browser-smoke-status.md)._

## What this session did

Closed the follow-up filed 2026-07-17: the seven dev-only browser smoke
harnesses that failed under the production-preview config were reworked onto
preview-safe seams, and the **full 61-test suite now passes under both smoke
configs** — the dev-mode gate (`npm run test:smoke`) and the production gate
(`npm run build && npx playwright test --config playwright.preview.config.js`).
No test was skipped, weakened, or marked expected-fail.

## The seven failures and their root cause

All seven failed with the same mechanism, confirmed by running the preview
suite before changing anything (`54 passed / 7 failed`, every failure a
`TypeError: Failed to fetch dynamically imported module:
http://127.0.0.1:4173/js/...`):

| Test (file:line at time of audit) | Imported source path |
| --- | --- |
| `backup.smoke.js:37` — backup export round-trips tracker data into a fresh browser context | `js/storage/texts-idb.js` |
| `characterPanelLifecycle.smoke.js:132` — character panels stay safe after repeated character page init | `js/pages/character/characterPage.js` + state/save/popover/helper modules |
| `characterPanelLifecycle.smoke.js:159` — attack panel listeners are removed on destroy and rebound once on re-init | same harness |
| `characterPanelLifecycle.smoke.js:206` — vitals panel listeners are removed on destroy and rebound once on re-init | same harness |
| `characterPanelLifecycle.smoke.js:269` — abilities panel listeners are removed on destroy and rebound once on re-init | same harness |
| `combatShell.smoke.js:752` — combat embedded spell notes are the same canonical text as the character spell notes | `js/storage/texts-idb.js` |
| `trackerPanelLifecycle.smoke.js:93` — tracker card panels stay single-bound after repeated tracker page init | `js/pages/tracker/trackerPage.js` + state/save/popover/factory modules |

Every one passed in dev mode: the Vite dev server serves `js/**` directly, so
in-page `import()` of source paths works there and nowhere else. `vite preview`
serves only `dist/`, so those fetches 404 by construction. All seven were
harness defects, not application defects — but reworking them exposed one real
application defect (below).

## The corrections

**Spell-note pair (`backup`, `combatShell`)** — the in-page module import only
existed to read the persisted spell-note text from IndexedDB. Replaced with a
shared helper, `readStoredSpellNote(page, spellId)`
(`tests/smoke/helpers/smokeApp.js`), which reads the app's IndexedDB texts
store through public browser APIs (`localCampaignTracker_db` → `texts` →
`spell_notes_<campaignId>__<spellId>`, mirroring the persisted contract in
`js/storage/idb.js` + `js/storage/texts-idb.js`). Same class of seam as the
existing direct `localStorage["localCampaignTracker_v1"]` reads; the asserted
behavior (canonical persisted text) is unchanged.

**Lifecycle trio (`trackerPanelLifecycle`, `characterPanelLifecycle` ×4)** —
the old harnesses imported page modules into the browser and hand-built
synthetic controllers with stub deps to simulate destroy/re-init. The real app
already has that lifecycle: `switchActiveCampaign()` / `createCampaign()` run
`destroyCampaignModules()` → `initCampaignModules()` (app.js), tearing down and
re-initializing the tracker page (which owns the character page init). The
rewritten tests drive it through the UI with new shared helpers
`cycleCampaignShell(page, name)` / `reopenCampaignFromHub(page, name)` /
`submitPromptDialog(page, value)`: create campaign → Hub round trip(s) →
exact-count and exact-value assertions on the static add controls, ability
controls, and persisted state (via the DEV `__APP_STATE__` escape hatch, which
is active under both configs because they serve on `127.0.0.1`). The
destroy-phase intent is preserved: at the Hub the tests assert the dynamically
injected ability controls (`.skillProfBtn`, `.abilityMoves`) are removed, and
poke static buttons to prove destroyed controllers stay inert; after re-entry
they assert controls rebuilt exactly once and one-click-one-action.

## Genuine application defect found and fixed

Driving the real teardown exposed a leak the synthetic harnesses could never
see: `js/pages/tracker/trackerPage.js` registered the destroy of the character
page controller **created at page init**, but the character page replaces its
own controller through `rerender()` after any character CRUD action. After a
rerender, shell teardown destroyed the stale first instance and the live
replacement survived `destroyCampaignModules()` — still bound to the static
DOM while the app sat on the Hub (evidence: `.skillProfBtn` remained in the
DOM at the Hub; CDP listener dumps confirmed live handlers). The module-level
singleton guard in `initCharacterPageUI` healed it on the *next* init, so
user-visible impact was limited to a live stale controller during the Hub
dwell — but it violated the teardown contract the lifecycle smokes exist to
pin. Fix (2 files, minimal): `characterPage.js` now exports
`destroyActiveCharacterPageUI()` (destroys whichever controller is live) and
`trackerPage.js` registers that as the panel destroy. `tests/trackerPage.test.js`'s
module mock gained the new export.

## Files changed

- `tests/smoke/helpers/smokeApp.js` — new shared helpers: `reopenCampaignFromHub`,
  `cycleCampaignShell`, `submitPromptDialog`, `readStoredSpellNote`
- `tests/smoke/backup.smoke.js` — IDB-direct spell-note wait (1 line + import)
- `tests/smoke/combatShell.smoke.js` — `readActiveCampaignSpellNote` delegates to the shared helper
- `tests/smoke/trackerPanelLifecycle.smoke.js` — rewritten onto the real shell cycle
- `tests/smoke/characterPanelLifecycle.smoke.js` — rewritten onto the real shell cycle
- `js/pages/character/characterPage.js` — `destroyActiveCharacterPageUI()` export
- `js/pages/tracker/trackerPage.js` — registers the live-controller destroy
- `tests/trackerPage.test.js` — mock gains the new export
- `playwright.preview.config.js` — header now states the both-configs-green requirement
- Docs: `docs/operations/testing-guide.md`, `docs/operations/browser-smoke-status.md`
  (new "Preview-safe harness rules" section), `AGENTS.md` (steps 17/18),
  `docs/audits/builder-completion-matrix.md`, `docs/audits/character-calculation-audit-2026-07.md`,
  `docs/README.md`, this handoff

## Verification (final tree)

- `npm run typecheck` — clean.
- `npm run test:run` — **1219/1219** (72 files).
- `npm run test:smoke` (dev-mode gate) — **61/61**.
- `npm run verify` — green.
- `npm run build && npx playwright test --config playwright.preview.config.js`
  (production gate, real `dist/`) — **61/61**.
- Manual production-preview inspection over `npm run preview`: real-browser
  walk of the campaign-shell cycle flow (create → Hub → reopen), seeded data
  visible after re-entry, no console errors, reload restores state; confirmed
  against the served production bundle.

## The rule going forward

Smoke harnesses must never `import()` repository source modules into the page.
Test through visible UI, the real campaign-shell lifecycle helpers, persisted
storage (localStorage / public-API IndexedDB), `__APP_STATE__` for state
assertions, and Node-side setup. The full rules live in
[`browser-smoke-status.md`](../operations/browser-smoke-status.md) →
"Preview-safe harness rules"; both smoke gates are blocking for smoke-harness
changes.

## Known limitations / deferred

- The preview gate remains a local/manual gate; CI still runs `npm run verify`
  + `npm run test:smoke` only (unchanged posture).
- `readStoredSpellNote` mirrors the persisted texts-store shape; a storage
  contract change must update it alongside (called out in the helper JSDoc).
- The deferred product backlog is unchanged (AGENTS.md step 18): P2 matrix
  items, Half-Elf/Tiefling/race-proficiency choice work, Dwarf tools, freeform
  initiative (F1).

## Next session start

```bash
git status            # expect clean on builder-wizard (local commits, not pushed)
npm run verify        # expect green
npm run test:smoke    # expect 61/61
npm run build && npx playwright test --config playwright.preview.config.js  # expect 61/61
```

Recommended next (needs owner scope): **Half-Elf Skill Versatility** (smallest
deferred choice item) or freeform initiative (F1) using the shipped scalar-calc
pattern.
