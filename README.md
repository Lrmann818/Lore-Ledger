# Campaign Tracker

A lightweight, offline-first Campaign Tracker web app (vanilla HTML/CSS/JS) for managing:
- Party cards
- NPC cards
- Location cards
- Sessions
- Character sheet
- Interactive maps (draw layer + touch/pan/zoom)

## Vite workflow

Install dependencies:

```bash
npm install
```

Run local dev server:

```bash
npm run dev
```

Build production output to `dist/`:

```bash
npm run build
```

Preview the built app locally:

```bash
npm run preview
```

### Versioning

- Tag `v0.3.0` (or `0.3.0`) to set the major/minor/baseline patch.
- Build version is computed as `MAJOR.MINOR.(tagPatch + commitsSinceTag)`.
- Dev server appends `-dev` to the computed version.
- Build uses short Git SHA when available.
- If no tag exists (or Git metadata is unavailable), version falls back to `package.json` version and build may be empty.

Set a new baseline tag:

```bash
git tag v0.3.0
git push origin v0.3.0
```

## GitHub Pages deployment

- Production base path is configured as `/CampaignTracker/` in `vite.config.js`.
- Hash routing is preserved (`#tracker`, `#character`, `#map`).
- Deploy the contents of `dist/` to GitHub Pages.

## Release packaging

There are two zip profiles:
- Source snapshot zip (`scripts/make-zip.sh` / `scripts/make-zip.ps1`) for backup/share of the project source.
- GitHub Pages deploy zip (`scripts/make-pages-zip.sh`) for non-Vite runtime packaging workflows.

### 1) Source snapshot zip

Windows (PowerShell):

```powershell
.\scripts\make-zip.ps1
```

Linux/macOS/Chromebook (Bash):

```bash
bash scripts/make-zip.sh
```

Output format:
- `refactor-export-YYYYMMDD-HHMM.zip`
- Script output includes: `Release zip is clean`

Optional output folder:

```powershell
.\scripts\make-zip.ps1 -OutputDir .\exports
```

```bash
bash scripts/make-zip.sh ./exports
```

### 2) GitHub Pages deploy zip (runtime-only)

Windows (Git Bash):

```bash
bash scripts/make-pages-zip.sh
```

Linux/macOS (Bash):

```bash
bash scripts/make-pages-zip.sh
```

Output format:
- `pages-deploy-YYYYMMDD-HHMM.zip`
- Script output includes: `Pages zip is clean`

Optional output folder:

```bash
bash scripts/make-pages-zip.sh ./artifacts
```

## Project structure (high level)

- `index.html` - app shell/markup + CSP + root page sections
- `styles.css` - global styling
- `public/` - static assets copied as-is by Vite (`icons/`, `manifest.json`)
- `boot.js` - pre-module boot for initial theme + app version exposure
- `app.js` - composition root (state guard, persistence wiring, shared UI systems, page init)
- `docs/architecture.md` - intended boundaries + current wiring details

`js/` modules:
- `js/state.js` - app state defaults, migrations, save sanitization, map-manager helpers
- `js/domain/*` - domain factories + explicit state action helpers
- `js/storage/*` - localStorage + IndexedDB (blobs/text) + backup/import/export + save manager
- `js/ui/*` - shared UI infrastructure (dialogs, navigation, popovers, topbar, settings/data panel, bindings)
- `js/features/*` - reusable feature helpers (autosize, image picker/cropper/portrait flow, steppers)
- `js/pages/tracker/*` - tracker page wiring + panel modules (`sessions`, `npcCards`, `partyCards`, `locationCards`, shared card helpers)
- `js/pages/character/*` - character page wiring + panel modules
- `js/pages/map/*` - map page setup + controller/ui/persistence/history/gesture/drawing modules
- `js/utils/*` - dev/state-guard helpers, DOM guards, general utilities

## Notes

- The app uses a strict CSP in `index.html`.
- Images use `blob:` + `data:` URLs and are stored via the storage layer.

## DEV flags

Development mode is auto-enabled on local hosts (`localhost`, `127.0.0.1`, `::1`, `*.local`).

- `?dev=1` enables DEV mode.
- `?dev=0` disables DEV mode.
- `?stateGuard=warn` enables warning-only mutation guard mode.
- `?stateGuard=throw` enables throwing mutation guard mode.
- `?stateGuard=off` disables the mutation guard.

Recommended querystrings:
- `/?dev=1&stateGuard=warn`
- `/?dev=1&stateGuard=throw`
- `/?dev=1&stateGuard=off`

Behavior summary:
- DEV off: mutation guard is off unless explicitly requested.
- DEV on + warn: direct out-of-scope state writes warn once per path.
- DEV on + throw: direct out-of-scope state writes throw with a helper message.
- Normal app UI usage remains functional in DEV guard modes because registered UI lifecycle callbacks are treated as allowed mutation scopes.

Quick guard check from console in DEV mode:
- `__APP_STATE__.tracker.campaignTitle = "Guard test"`

When enabled, direct state writes outside action helpers log warnings (or throw in `throw` mode) and point to `createStateActions(...)` helpers.

See `docs/architecture.md` for the intended boundaries and how the modules fit together.
