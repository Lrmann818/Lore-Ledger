# Security and Privacy

This project is a local-first browser app. It does not use an app-managed account system, cloud sync service, or server-side database for campaign data. That reduces some privacy exposure, but it is not the same as a formal security guarantee.

This document summarizes the current implementation conservatively. [`docs/CSP_AUDIT.md`](./CSP_AUDIT.md) is a useful verification checklist for CSP behavior in development, but it is only one supporting document and not the full security story.

## 1. Data storage model

The app currently splits data across a few browser storage layers:

- `localStorage["localCampaignTracker_v1"]` stores the main structured app state.
- `localStorage["localCampaignTracker_activeTab"]` stores the last selected top-level page.
- IndexedDB database `localCampaignTracker_db` stores:
  - `blobs` for portraits, map background images, and map drawing snapshots
  - `texts` for large text payloads, currently spell notes
- Runtime-only state stays in memory and is rebuilt on load.
- Exported backup files are user-created JSON files that bundle sanitized state, referenced images, and stored text.

This split is intentional, but it also means persistence is not a single atomic transaction. `localStorage` and IndexedDB writes can succeed or fail independently, and some recovery flows are best-effort rather than all-or-nothing.

## 2. What data stays local

Under the current code, campaign data is intended to stay in the current browser profile unless the user explicitly exports a backup.

That includes:

- campaign title, sessions, NPCs, party members, locations, character data, map metadata, and UI preferences
- portraits, map background images, and map drawing snapshots
- large note text stored separately in IndexedDB

Some data is intentionally not persisted:

- map undo/redo history
- dice history
- calculator history

"Local" here means local to the current browser profile on the current device. The app does not add its own encryption, password protection, or user-to-user access controls. Anyone with access to that browser profile, device, or a sufficiently privileged browser extension may be able to access the stored data. Browser vendor sync, OS backups, and enterprise management tooling are outside the app's control.

## 3. Network expectations

The app is designed so that normal editing and viewing of campaign data does not require a backend connection after the app is loaded.

Current expectations:

- The browser still makes normal same-origin requests to load the app shell, scripts, styles, icons, manifest, and production service worker assets.
- In production, the PWA/service worker path may also check the same origin for updated app files.
- The current codebase does not use a backend API, account login, or third-party analytics endpoint for campaign data.
- The current CSP restricts app-initiated network connections to `'self'`, and the checked-in runtime code does not send campaign data to third-party hosts via `fetch`, `XMLHttpRequest`, `WebSocket`, or similar APIs.
- Import reads a user-selected local file. Export triggers a local download in the browser.

This should be understood as "no app-managed remote sync today," not "the app never touches the network." If the app is hosted online, the browser still talks to that host to load and update the app itself.

## 4. CSP summary

The runtime CSP is defined in [`index.html`](../index.html).

In plain language, the current policy:

- allows scripts, styles, fonts, and network connections only from the same origin
- allows images from the same origin plus `data:` and `blob:` URLs
- allows media and workers from the same origin, with `blob:` allowed for media/workers as needed
- blocks plugin/object content with `object-src 'none'`
- limits `<base>` changes with `base-uri 'self'`

Important limits of the current policy:

- Inline scripts are blocked.
- Inline style attributes are still allowed via `style-src-attr 'unsafe-inline'`.
- CSP helps reduce risk from unsafe script injection patterns, but it does not make unsafe rendering code safe by itself.
- The CSP does not replace careful handling of imported data, stored data, or DOM updates.

For development verification of CSP violations, see [`docs/CSP_AUDIT.md`](./CSP_AUDIT.md).

## 5. Import/export safety notes

Export:

- Export creates a plain JSON backup file.
- That file can contain campaign data, stored text, and referenced images encoded as data URLs.
- The file is not encrypted or password-protected by the app.
- Export currently includes all stored text records from the IndexedDB text store, not only text that is still obviously referenced by the visible state.
- Export may still succeed even if one or more images could not be read, so a completed export is not a guarantee that every image made it into the file.

Import:

- Import accepts JSON backups and validates the basic format before applying it.
- Current checks include a maximum backup size of 15 MB, a maximum of 200 imported images, and an image allowlist limited to PNG, JPEG, and WebP data URLs.
- Imported state is migrated before restore so older backup formats can still load when supported.
- Import stages blobs and texts before mutating live state, which is safer than mutating state first but is not a fully transactional restore.

Current limitations:

- Import is not fully transactional. Failed imports clean up newly written blobs and attempt to restore the previous values for text IDs they touched, but unrelated old records, text-restore failures, or post-success cleanup failures can still leave extra IndexedDB records behind.
- Import does not clear existing blob/text stores before restore, so old unreferenced records can remain until a reset or cleanup flow removes them.
- If a backup contains no images, the import keeps already-present blob records and only preserves portraits/images that the restored state still references; it does not synthesize missing image data.

Practical guidance:

- Treat exported backups as sensitive if your campaign notes or images are sensitive.
- Keep backups somewhere you trust.
- Prefer importing backups that came from this app or a source you trust.
- Before relying on a backup as your only copy, verify it by doing a test import in a disposable profile or after making another backup.

## 6. User expectations and limitations

Users should expect:

- data to stay in the local browser profile unless they explicitly export it
- the app to work offline after the needed files are already available locally
- manual backups to be the main recovery path

Users should not expect:

- server-side recovery
- app-provided encryption at rest
- account-based access control
- guaranteed save completion if the browser or device closes abruptly
- service worker caches to act as a reliable backup of campaign content

Local browser storage can still be lost or become unavailable if the user clears site data, uses a temporary/private browsing context, switches browser profiles, hits storage limits, or resets the app. Exit-save hooks are best-effort only.

## 7. Developer safety notes when changing storage or rendering behavior

When changing persistence, backup, import, or rendering behavior:

- Treat `sanitizeForSave(...)`, `migrateState(...)`, IndexedDB helpers, and backup import/export as one system. If you add a persisted field or a new blob/text reference, update all affected paths together.
- Do not assume `SaveManager.flush()` makes IndexedDB writes durable. It only drives the main `localStorage` save path.
- Preserve the current commit-before-delete ordering for blob-backed replacements and deletions. Current portrait/map flows do not delete the previously referenced blob until the structured state change has been durably saved.
- Keep user-controlled content in form values, `textContent`, and DOM-created nodes. Avoid rendering user or imported content with `innerHTML` or similar HTML-parsing APIs unless a sanitization strategy and security review are added first.
- Be cautious about adding new network behavior or relaxing CSP directives. Document why the change is needed and what new trust assumptions it introduces.
- Re-test the full local data lifecycle after storage changes: edit data, refresh, export backup, reset, import backup, and verify restore behavior.
- Use [`docs/CSP_AUDIT.md`](./CSP_AUDIT.md) as one verification step when changing rendering paths, dialogs, dynamic UI creation, or policy-sensitive browser behavior.

## Supporting references

- [`docs/storage-and-backups.md`](./storage-and-backups.md)
- [`docs/CSP_AUDIT.md`](./CSP_AUDIT.md)
- [`index.html`](../index.html)
- [`js/state.js`](../js/state.js)
- [`js/storage/persistence.js`](../js/storage/persistence.js)
- [`js/storage/backup.js`](../js/storage/backup.js)
- [`js/storage/blobs.js`](../js/storage/blobs.js)
- [`js/storage/texts-idb.js`](../js/storage/texts-idb.js)
- [`vite.config.js`](../vite.config.js)
