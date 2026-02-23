# PWA Offline Notes

## What is cached
- The app shell is cached by the service worker so `index.html` and built assets can load offline.
- Same-origin navigation requests use a `NetworkFirst` runtime cache (`pages-cache`) with a 3 second network timeout.
- If navigation fails (offline/cache miss), the app falls back to the precached `index.html`.
- Same-origin image requests use a `CacheFirst` runtime cache (`images-cache`).
- Cross-origin images are not included in our runtime image cache rule.

## How to test offline
1. Open the production build/site once while online.
2. Open DevTools -> `Application` -> `Service Workers` and confirm one is active.
3. In DevTools, enable offline mode (`Network` -> `Offline`).
4. Reload the page and verify the app shell still loads and tabs still switch.

## Update behavior
- Service worker registration uses `registerType: "prompt"` and runs only in production (`import.meta.env.PROD`).
- Navigation requests try the network first, then fall back to cached documents when the network is slow or offline.
- When an update is available, the app shows the in-app update banner (`Refresh` / `Later`).
- The new service worker is activated when the user accepts refresh in that banner.
- `cleanupOutdatedCaches: true` removes old cache versions after updates.

## Hard reset if cache gets stale
1. Open DevTools -> `Application` -> `Service Workers` -> `Unregister`.
2. In `Application` -> `Storage`, run `Clear site data`.
3. Close all app tabs, reopen the site online, and refresh once.
