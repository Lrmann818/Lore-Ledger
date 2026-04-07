# Current Production Review - 2026-04-06

Repo-grounded review summary for the current Lore Ledger / Campaign Tracker app and docs.

## Overall

- The recent tracker architecture cleanup is real and landed cleanly.
- `npm run verify` passed locally.
- `npm run test:smoke` passed locally (`10/10`).
- The app is much closer to portfolio-ready than earlier review notes would suggest.

## Resolved enough to stop flagging

- `app.js` is acting as a real composition root with explicit dependency injection.
- Tracker page re-init now destroys the previous controller and panel-owned listeners.
- Character page re-init now destroys the previous controller, and the current highest-risk panels (`equipmentPanel.js` and `spellsPanel.js`) return real `destroy()` APIs.
- NPC / Party / Location tracker panels are instance-scoped controllers with explicit teardown.
- Incremental tracker-card dedupe stayed narrow and reasonable; it did not collapse into an over-abstracted renderer/framework layer.
- Asset replacement safety is materially improved: tracker portraits, the Character portrait, map background replacement, and drawing snapshot persistence now stage the new blob, save the new reference, and only then delete the old blob.
- Character hit-die naming is now canonicalized to `hitDieAmt` across migration/save paths, with regression coverage for legacy `hitDieAmount`.
- Backup/import core safety is materially improved: staged blob writes, state swap after staging, rollback on save failure, targeted smoke coverage.
- Testing/docs around tracker lifecycle, Character lifecycle, state-action helpers, save sanitization, round-trip persistence, and panel patch behavior are substantially more current than before.

## Still open

- Broad CheckJS is still not green in current character and tracker surfaces.
- Character lifecycle is closer to Tracker, but not at full parity yet: some older panels still rely on dataset guards or module-local state.

## Docs concerns

- The review-facing docs touched in this hardening pass now line up with the landed code and tests.
- The dated audit/plan docs that still describe pre-fix behavior now carry explicit historical-status notes so they are less likely to be read as current behavior.

## Reasonable deferrals

- Leaving tracker card body renderers panel-local still looks like the right call.
- Deferring a shared full-rerender shell, controller factory, or schema-driven card renderer is reasonable.
- Keeping Playwright smoke local-only is acceptable for now as long as the manual release checklist remains real.
- Broader Character deep-flow coverage, map touch/gesture coverage, and PWA/offline validation are still valid manual-release items.

## Immediate next steps

1. Chip away at current CheckJS errors in the hardened boundary/shared modules.
2. Continue the remaining Character lifecycle cleanup in panels that still use dataset guards or module-local state.
3. Keep broader Character, full restore, map touch, and PWA/offline validation on the manual release checklist.
