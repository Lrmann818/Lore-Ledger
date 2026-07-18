// Production-preview variant of the smoke config: identical tests, but the
// server is `vite preview` serving the real `dist/` build (run `npm run build`
// first). This is the configuration the matrix #9 attack dialog failed under
// while dev-mode smokes stayed green — production-preview runs are the
// blocking gate for UI-flow changes.
//
// The full suite passes under both configs (since 2026-07-18) and must stay
// that way: smoke harnesses must never `import()` repository source modules
// into the page — those paths exist only on the dev server, never in the
// bundle. Drive the app through its visible UI, its persisted storage
// (localStorage / IndexedDB), and the DEV-mode `__APP_STATE__` escape hatch
// (active on 127.0.0.1 under both configs). See
// docs/operations/browser-smoke-status.md → "Preview-safe harness rules".
//
//   npm run build && npx playwright test --config playwright.preview.config.js
import { defineConfig } from "@playwright/test";
import baseConfig from "./playwright.config.js";

const HOST = "127.0.0.1";
const PORT = 4173;

export default defineConfig({
  ...baseConfig,
  webServer: {
    ...baseConfig.webServer,
    command: `npm run preview -- --host ${HOST} --port ${PORT} --strictPort`
  }
});
