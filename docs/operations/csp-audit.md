# CSP Audit (DEV)

This audit verifies that:
- DEV mode shows clear CSP violation diagnostics.
- Normal app usage does not trigger `securitypolicyviolation`.
- Non-DEV mode has no CSP audit logging overhead.

## Setup
1. Serve the app from a local static server (not `file://`).
2. Open the app with DEV enabled: `http://localhost:5500/?dev=1`.
3. Open browser DevTools Console.

## What DEV logs should look like
When a CSP violation occurs, Console should show:
- `"[DEV][CSP VIOLATION] securitypolicyviolation event"`
- an object containing:
- `violatedDirective`
- `blockedURI`
- `effectiveDirective`
- `documentURI`
- `sample` (when provided by the browser)

The status line also shows a non-invasive indicator:
- `CSP violation: <effectiveDirective>`

## Intentional violation check (DEV only)
Use this once to verify the listener is active:

```js
const s = document.createElement("script");
s.textContent = "window.__cspInlineProbe = 'blocked-if-csp-is-working'";
document.head.appendChild(s);
```

Expected result:
- A clear `[DEV][CSP VIOLATION]` console error appears with the fields above.

## Normal usage audit flows
Run these flows with `?dev=1` and watch Console:

1. Map draw flow
- Open `Map`.
- Click `Set Map Image` and choose an image.
- Draw at least one stroke.
- Refresh once and confirm map image + drawing persist.

2. NPC portrait flow
- Open `Tracker`.
- Add an NPC card.
- Set a name.
- Pick a portrait image.
- Refresh once and confirm the NPC + portrait persist.

3. Import/export backup flow
- Open `Data & Settings`.
- Export backup JSON.
- Reset Everything and confirm.
- Import the exported backup.
- Confirm auto-refresh and data restoration.

Expected result for all three flows:
- No `securitypolicyviolation` events in Console.
- No `[DEV][CSP VIOLATION]` logs.

## DEV-off check
1. Open app without DEV: `http://localhost:5500/` (or `?dev=0`).
2. Repeat a quick normal flow (for example, map draw).

Expected result:
- No CSP audit log output from the DEV listener.
- No extra status message related to CSP audit.
