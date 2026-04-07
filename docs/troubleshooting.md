# Troubleshooting

This guide covers common operational and development issues for Lore Ledger / Campaign Tracker and how to recover from them without changing app code.

Before using any destructive recovery step:

- If the app still opens, use `Data & Settings` -> `Export Backup (.json)` first.
- `Clear site data`, `Clear Images Only`, `Clear Text Notes Only`, and `Reset Everything` all remove browser-local data.
- `Clear Images Only` removes blob-backed portraits, map backgrounds, and persisted map drawings.
- Note whether the issue happens in `npm run dev`, `npm run preview`, or the deployed GitHub Pages site. PWA and offline behavior should be debugged in preview or production, not in dev mode.

## Quick triage

1. Try a normal reload first.
2. If the problem started after a deploy, open `Data & Settings` -> `Check for updates`.
3. Wait for the status line to settle before closing the tab after edits, image changes, or imports.
4. If the issue only happens in one browser profile, retry in a clean profile.
5. If a recovery step says to clear site data, export a backup first if you still can.

## Theme or style mismatch after refresh

Common symptoms:

- the wrong theme appears after reload
- styles look mixed, partly old and partly new
- the app looks correct only after a second refresh

Current behavior:

- `boot.js` applies the saved theme early from `localStorage["localCampaignTracker_v1"]`
- the current theme is stored in root `ui.theme`
- choosing `System` follows the browser/OS `prefers-color-scheme` setting

Recovery:

1. Open `Data & Settings` and confirm the selected theme.
2. If the theme is `System`, verify the OS/browser dark-mode setting is what you expect.
3. Wait for the status line to show `Saved locally.`.
4. Reload once.
5. If the wrong theme keeps coming back, use `Data & Settings` -> `Reset UI Only`, then choose the theme again.
6. If the styling looks like a mix of old and new assets after a deploy, follow the cache reset steps in the next section.

## Stale service worker or cache issues

Common symptoms:

- a deploy is live, but the app still loads old code
- CSS or JS looks stale after release
- update banner behavior seems inconsistent

Current behavior:

- production builds register a service worker with a prompt-style update flow
- dev builds do not register the production service worker
- the app shell is cached for offline reopening after the site has loaded online at least once

Recovery:

1. On the deployed site or `npm run preview`, open `Data & Settings` -> `Check for updates`.
2. If the app reports `Update available`, click `Refresh` in the update banner.
3. Close any extra tabs for the app and reopen the site once while online.
4. If the app still looks stale, do a full cache reset:
   1. Open DevTools.
   2. Unregister the service worker.
   3. Clear site data/storage for the app.
   4. Close all app tabs.
   5. Reopen the site online and refresh once.
5. Re-test after the site reloads from the network.

Notes:

- In Chrome or Edge, these controls are usually under `Application`.
- In Firefox, the labels differ, but the goal is the same: remove the service worker and clear stored site data.
- If you are using `npm run dev`, stale service worker state is not the cause because dev mode does not register the production service worker.

## App only updates after a hard refresh

Common symptoms:

- `Ctrl+Shift+R` or `Cmd+Shift+R` shows the new version, but a normal refresh does not
- the app keeps serving an older shell until caches are bypassed

Likely causes:

- a stale service worker or cache
- multiple open tabs holding onto the older version
- the `Later` button was used on the update banner during the current page session

Recovery:

1. Prefer `Data & Settings` -> `Check for updates` over repeated hard refreshes.
2. If you clicked `Later` earlier, do one normal reload, then check for updates again.
3. Close other tabs of the app.
4. If a hard refresh is still required every time, do the full service worker and site-data reset from the previous section.
5. For local troubleshooting, reproduce the issue in `npm run preview` or the deployed build, not only in `npm run dev`.

Hard refresh is a useful symptom check, but it is not a durable fix.

## Missing icons or manifest issues

Common symptoms:

- favicon or app icons are missing
- install prompts look wrong
- manifest requests fail or point at the wrong path

Current behavior:

- `index.html` links `./manifest.webmanifest`
- production PWA metadata is defined in `vite.config.js`
- icon files live under `public/icons/`
- the current production base path is `/CampaignTracker/`

Recovery:

1. Make sure the app is being served over Vite, preview, or GitHub Pages, not from `file://`.
2. Inspect the manifest the app actually links: `manifest.webmanifest`.
3. On GitHub Pages, verify the manifest and icon URLs resolve under `/CampaignTracker/`.
4. If an installed PWA keeps old icons or metadata, clear site data, remove the installed app, then install it again.
5. If you are checking repo assets directly, keep `public/manifest.json` aligned too, but treat the linked `manifest.webmanifest` as the first thing to debug.

One current gotcha: the live app shell points at `./manifest.webmanifest`; `public/manifest.json` is a secondary manifest artifact, so debug the linked manifest first.

## Local save or import problems

Common symptoms:

- changes disappear after refresh
- the status line shows `Save failed (local). Export a backup.`
- import fails or restores only part of the data

Current behavior:

- structured state saves to `localStorage["localCampaignTracker_v1"]`
- the active top-level tab also saves separately to `localStorage["localCampaignTracker_activeTab"]`
- images and drawings live in IndexedDB database `localCampaignTracker_db`, store `blobs`
- spell note bodies live in IndexedDB database `localCampaignTracker_db`, store `texts`
- backup import accepts JSON up to `15 MB` and rejects backups with more than `200` blob entries
- the `Saved locally.` status mainly reflects the structured JSON save path, not every separate IndexedDB write

Recovery for save issues:

1. Watch the status text after making changes and wait for `Saved locally.` before closing or reloading.
2. If the app shows `Save failed (local). Export a backup.`, export a backup immediately if possible.
3. Reload once and check whether the issue reproduces.
4. If it only happens in private browsing, strict privacy mode, or a temporary browser profile, retry in a normal persistent profile.
5. If the browser is low on storage, remove unneeded local data or move the backup into a fresh browser profile.
6. If the problem is limited to portraits, map images, map drawings, or spell note bodies, continue with the next section because those use IndexedDB separately from the main JSON save.

Recovery for import issues:

1. Prefer backup files created with this app's `Export Backup (.json)` action.
2. Make sure the selected file is valid JSON and smaller than `15 MB`.
3. If the backup embeds images, their data must be `png`, `jpeg`, `jpg`, or `webp`.
4. On successful import, the app should reload automatically.
5. If a legacy or raw-state file restores text but not images, that usually means the file did not include blob data; image references only survive when matching blob IDs already exist locally.
6. If import still fails, try the same file in a clean browser profile to separate bad data from a damaged local profile.

## Image and blob issues

Common symptoms:

- portraits disappear after refresh
- the map background or drawing is missing
- newly selected images fail to save

Current behavior:

- portraits, map backgrounds, and map drawing snapshots are stored as blobs in IndexedDB
- image selection and map image save failures usually point to blob-storage problems, not ordinary CSS issues
- map undo/redo history is intentionally in-memory only; only the final drawing snapshot persists

Recovery:

1. Export a backup first if the app still opens.
2. Reload once to rule out a one-time render glitch.
3. Try replacing one missing image. If the new image also fails to persist, treat it as a storage problem.
4. If text data is intact but many images are broken, use `Data & Settings` -> `Clear Images Only`, reload, then import a backup that you know includes images.
5. If saving an image fails, storage may be full. Export a backup, reduce stored images if possible, or move the backup into a clean browser profile.
6. For map issues, remember that a missing `Undo`/`Redo` history after refresh is expected, but a missing final drawing is not.

## GitHub Pages base-path issues

Common symptoms:

- the app works locally but breaks on GitHub Pages
- built CSS, JS, manifest, or icons 404 in production
- the app loads a blank or partially styled shell under the wrong path

Current behavior:

- production `base` is `/CampaignTracker/`
- the PWA manifest `id`, `start_url`, and `scope` also use `/CampaignTracker/`
- the GitHub Pages workflow deploys the built `dist/` folder

Recovery:

1. Build with `npm run build`.
2. Validate the production build with `npm run preview`.
3. If the preview server root is not the right entry point, test under `/CampaignTracker/`.
4. For GitHub Pages, publish `dist/`, not the repository root.
5. If the Pages path ever changes, update all of these together before rebuilding:
   - Vite `base`
   - manifest `id`
   - manifest `start_url`
   - manifest `scope`
   - Workbox navigation fallback paths
6. After any base-path change, do a service worker/cache reset so older cached paths do not keep masking the fix.

## Offline and PWA confusion

Common symptoms:

- offline mode does not work in local development
- a user expects sync across devices because the app is installable
- the installed app and the browser tab do not update at the same time

Current behavior:

- offline support is a production-build feature
- the app must be opened online at least once before the offline shell is available
- the app is local-first, not cloud-synced

Recovery:

1. Do not use `npm run dev` to validate offline or service-worker behavior.
2. Use `npm run build` plus `npm run preview`, or the deployed GitHub Pages site.
3. Open the app once while online.
4. Confirm a service worker is active.
5. Switch the browser to offline mode and reload.
6. If the installed app still behaves differently from the browser tab, check for updates, then reinstall the PWA after clearing site data if needed.

Important distinction:

- Offline-capable means the already-loaded app shell can reopen without a network connection.
- It does not mean the app syncs between browsers, profiles, or devices.

## Browser-specific quirks

Common patterns:

- private/incognito browsing may block or aggressively clear `localStorage`, IndexedDB, or service-worker state
- Firefox, Chromium browsers, and mobile browsers expose storage tools in different DevTools locations
- iOS Safari and installed mobile PWAs may keep old icon or manifest metadata longer than desktop browsers
- touch drawing, image picking, and install behavior should be verified on a real touch device when those paths change

Recovery:

1. Reproduce first in the latest Chrome or Edge desktop build for a quick baseline.
2. If the issue is persistence-, layout-, or CSP-related, retry in the latest Firefox desktop build.
3. If the issue is touch, image-picker, or install related, retry on a real iOS Safari or Android Chrome device.
4. If the issue only happens in private browsing or a temporary profile, retry in a normal persistent profile before assuming the app data is corrupted.

## Manual inspection in DevTools

If you need to inspect the current browser state directly:

- `localStorage["localCampaignTracker_v1"]`: main structured save
- `localStorage["localCampaignTracker_activeTab"]`: last active top-level tab
- IndexedDB database `localCampaignTracker_db`
- object store `blobs`: portraits, map images, drawing snapshots
- object store `texts`: large spell note bodies
- service worker and cache storage: app shell, runtime caches, update state

## Related docs

- [`docs/storage-and-backups.md`](./storage-and-backups.md)
- [`docs/PWA_NOTES.md`](./PWA_NOTES.md)
- [`docs/testing-guide.md`](./testing-guide.md)
- [`README.md`](../README.md)
