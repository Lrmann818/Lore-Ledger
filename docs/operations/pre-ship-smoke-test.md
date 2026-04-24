# Pre-Ship Smoke Test (5 Minutes)

This checklist validates high-risk persistence flows before shipping.

## Goal
- Verify core data and image persistence for NPCs and Map.
- Verify undo/redo behavior is intentionally ephemeral across refresh.
- Verify full backup restore path (`Export Backup (.json)` -> `Reset Everything` -> `Import Backup`).

## Time Budget
- Target total: ~5 minutes.

## Setup (Clean Browser Profile)
1. Start the app from a local static server (not `file://`).
2. Open the app in a clean browser profile.

Optional helper script (Windows PowerShell):
```powershell
.\scripts\open-clean-profile.ps1 -Url "http://localhost:5500"
```

Manual alternatives (if you do not use the helper script):
- Edge:
```powershell
msedge --user-data-dir="$env:TEMP\lore-ledger-smoke-edge" --new-window "http://localhost:5500"
```
- Chrome:
```powershell
chrome --user-data-dir="$env:TEMP\lore-ledger-smoke-chrome" --new-window "http://localhost:5500"
```

## Smoke Checklist

### 1) NPC create/edit + portrait persists after refresh
1. In the top tabs, stay on `Tracker`.
2. In the `NPCs` panel, click `+ NPC`.
3. In the new NPC card:
- Set `Name` to `Smoke NPC`.
- Set `Class / Role` to `Scout`.
- Set `HP` `Cur` to `7` and `Max` to `12`.
4. Click the NPC portrait area at the top of the card and select an image.
5. Refresh the browser page once.

Expected result:
- `Smoke NPC` card is still present.
- `Class / Role` and HP values are still present.
- Portrait image is still shown after refresh.

### 2) Map background + drawing persists after refresh
1. Click top tab `Map`.
2. Click `Set Map Image` and choose an image.
3. Draw at least one visible stroke on the map canvas.
4. Refresh the browser page once.

Expected result:
- Selected map background image is still visible.
- Drawn stroke is still visible.

### 3) Undo/redo behavior: drawing persists, undo/redo stacks do NOT persist
1. On `Map`, draw one additional visible stroke.
2. Click `Undo` once.
3. Click `Redo` once.
4. Refresh the browser page once.
5. Without drawing anything new, click `Undo` and then `Redo`.

Expected result:
- The final drawing state from before refresh remains visible (drawing persistence works).
- After refresh, `Undo`/`Redo` do not replay pre-refresh history (history stacks are ephemeral and effectively reset).

### 4) Export backup -> reset/clear -> import backup -> refresh happens -> data returns
1. Click the top-right settings icon button (`Data & Settings`).
2. Under `Backups`, click `Export Backup (.json)` and save the file.
3. In `Danger Zone`, click `Reset Everything` and confirm the prompt.
4. Verify the app reloads to a clean/default state.
5. Open `Data & Settings` again.
6. Under `Backups`, use `Import Backup` and select the file from step 2.
7. Wait for import to complete.

Expected result:
- Import triggers a page refresh automatically.
- After refresh, prior test data is restored:
- `Tracker` -> `NPCs`: `Smoke NPC` and portrait are present.
- `Map`: background image and drawing are present.

## Pass/Fail Rules
- Pass: every expected result above is true.
- Fail: any expected result is missing, incorrect, or inconsistent.

## Evidence to Capture on Failure
- Which checklist step failed.
- What was expected vs what actually happened.
- Browser name/version and whether helper script was used.
- Console errors (if any).
