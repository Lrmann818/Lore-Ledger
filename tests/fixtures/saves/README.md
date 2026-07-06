# Save fixtures

Captured real campaign-doc saves used by migration/compatibility tests. Each file
is a single campaign document — the exact object `migrateState()` receives when a
campaign loads from the vault in `localStorage["localCampaignTracker_v1"]`.

| File | Schema | Provenance |
|---|---|---|
| `v5-live.json` | 5 | Captured 2026-07-06 from the production site (lore-ledger.com, `main` build). Byte-verified against live localStorage via SHA-256 before redaction. |
| `v7-mobile.json` | 7 | Captured 2026-07-06 from the installed iOS/Capacitor app's WKWebView localStorage (`develop` build). Richest campaign of three in the vault (14 sessions with v6 stable ids, 36 NPCs, inventory with v7 stable ids, active combat encounter with undo stack). |

## Redaction

The repo is public, so personal prose was replaced before committing. The
redaction pass preserves every structural property and was verified by running
both the raw and redacted docs through `migrateState()` + `sanitizeForSave()`
and asserting structurally identical output (same key sets, types, array
lengths, numbers, booleans, and string emptiness).

- Replaced with `Redacted <key> N` placeholders: `title`, `notes`, `name`,
  `campaignTitle`, `misc`, `className`, `classLevel`, `race`, `background`,
  `alignment`, `features`, `skillsNotes`, `armorProf`, `weaponProf`, `toolProf`,
  `languages`, `equipment`, `status`, `label`, `traits`, `ideals`, `bonds`, `flaws`
- Blanked: search-box fields (`sessionSearch`, `npcSearch`, `partySearch`,
  `locSearch`, `inventorySearch`)
- Kept untouched: all ids (`characterId`, session/inventory/spell/blob/text ids),
  numbers, booleans, dates, enums (`group`, `type`, `role`), dice/stat strings
  (`+4`, `1d4 + 1`), UI ordering state, and the legacy `textareaHeigts` typo key
  that exercises the v1 migration's typo repair.

Do not hand-edit these files; they are contract inputs. If a new fixture is
needed (e.g. post-merge v10), capture and redact a real save the same way.
