# PWA Offline Notes

## What is cached
- The app shell is cached by the service worker so `index.html` and built assets can load offline.
- Image requests (`.png`, `.jpg`, `.jpeg`, `.webp`, `.svg`) use a `CacheFirst` runtime cache.

## How to test offline
1. Open the production build/site once while online.
2. Open DevTools -> `Application` -> `Service Workers` and confirm one is active.
3. In DevTools, enable offline mode (`Network` -> `Offline`).
4. Reload the page and verify the app shell still loads and tabs still switch.

## Update behavior
- Service worker registration uses `registerType: "prompt"`.
- New versions are downloaded in the background and applied when the page accepts the update flow.
- Registration is guarded by `import.meta.env.PROD`, so `npm run dev` does not register a service worker.

## Hard reset if cache gets stale
1. Open DevTools -> `Application` -> `Service Workers` -> `Unregister`.
2. In `Application` -> `Storage`, run `Clear site data`.
3. Close all app tabs, reopen the site online, and refresh once.
