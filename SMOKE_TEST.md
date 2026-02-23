# Vite Smoke Test Checklist

Quick validation after Vite changes.

## 1) Dev server
1. Run `npm run dev`.
2. Open the local URL from Vite.
3. Confirm app loads with no CSP errors in console.

## 2) Boot/theme ordering
1. Set a non-default theme in app settings.
2. Reload the page.
3. Confirm theme is applied immediately (no visible flash to wrong theme).

## 3) Hash routing
1. Navigate to `#tracker`, `#character`, and `#map`.
2. Reload on each hash.
3. Confirm the same section stays active after reload.

## 4) Static assets
1. Confirm favicon and apple-touch icon load.
2. Confirm dice/settings/calc icons render in the UI.
3. Confirm manifest is reachable at `/manifest.json` in dev.

## 5) Production build + preview
1. Run `npm run build`.
2. Run `npm run preview`.
3. Confirm app behavior matches dev and assets load from the built output.

## 6) Offline app shell (PWA)
1. While online, open the production site once.
2. Open DevTools -> `Application` and verify a service worker is registered.
3. In DevTools, enable offline mode (`Network` -> `Offline`).
4. Reload the page.
5. Confirm the app still loads and `#tracker`, `#character`, and `#map` tabs still work.
