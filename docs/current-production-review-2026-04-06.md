# Current Production Review - 2026-04-06

Repo-grounded review summary for the current Lore Ledger / Campaign Tracker app and docs.

## Overall

- The recent tracker architecture cleanup is real and landed cleanly.
- `npm run verify` passed locally.
- `npm run test:smoke` passed locally (`9/9`).
- The app is much closer to portfolio-ready than earlier review notes would suggest.

## Resolved enough to stop flagging

- `app.js` is acting as a real composition root with explicit dependency injection.
- Tracker page re-init now destroys the previous controller and panel-owned listeners.
- NPC / Party / Location tracker panels are instance-scoped controllers with explicit teardown.
- Incremental tracker-card dedupe stayed narrow and reasonable; it did not collapse into an over-abstracted renderer/framework layer.
- Backup/import core safety is materially improved: staged blob writes, state swap after staging, rollback on save failure, targeted smoke coverage.
- Testing/docs around tracker lifecycle and panel patch behavior are substantially more current than before.

## Still open

- Asset replacement safety still has a real failure-mode gap:
  - portrait replacement deletes the old blob before the new cropped image is safely stored
  - map background replacement does the same
  - map drawing snapshot persistence deletes the old drawing blob before the new one is committed
- Character state naming still drifts between `hitDieAmt` and `hitDieAmount`.
- Broad CheckJS is still not green in current character and tracker surfaces.
- Character lifecycle cleanup is behind Tracker: singleton-style guards and module-level mutable state still remain in some panels.

## Docs concerns

- `docs/storage-and-backups.md` is partially stale on current import behavior.
- `docs/release-process.md`, `docs/storage-and-backups.md`, and `docs/troubleshooting.md` still contain machine-local absolute links.
- `docs/architecture.md` is mostly current, but its startup-order section is not fully aligned with `app.js`.
- Root `SMOKE_TEST.md` still mentions `/manifest.json`, while the live shell links `./manifest.webmanifest`.

## Reasonable deferrals

- Leaving tracker card body renderers panel-local still looks like the right call.
- Deferring a shared full-rerender shell, controller factory, or schema-driven card renderer is reasonable.
- Keeping Playwright smoke local-only is acceptable for now as long as the manual release checklist remains real.
- Character deep-flow coverage, map touch/gesture coverage, and PWA/offline validation are still valid manual-release items.

## Immediate next steps

1. Make image/map replacement flows stage the new blob before deleting the old one.
2. Resolve the `hitDieAmt` / `hitDieAmount` schema split and add a regression test.
3. Fix review-facing doc drift and remove absolute local filesystem links.
4. Chip away at current CheckJS errors in the hardened boundary/shared modules.
5. Later: bring Character lifecycle patterns closer to the Tracker controller model.