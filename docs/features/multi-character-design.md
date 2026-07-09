# Character Architecture (Canonical)

Lore Ledger · drafted April 2026 · slimmed 2026-07-09

**Canonical.** These are the character-architecture rules that bind new code. Keep them in
sync with the code.

The multi-character system shipped; all four implementation steps are complete. The
step-by-step build record moved to
[`docs/archive/multi-character-steps-1-4.md`](../archive/multi-character-steps-1-4.md) —
it is historical only, its schema versions are frozen at April 2026, and it must not be
read as a description of today's code.

---

## Character model

- Characters live in `state.characters.entries`, selected by `state.characters.activeId`.
  Resolve the active one with `getActiveCharacter(state)`.
- The legacy `state.character` singleton key is valid **only** in migration and
  backward-compatibility code. Never use it in new production code.
- **Builder characters have `build !== null`. Freeform characters have `build: null`.**
  These two modes must not be collapsed.
- Builder characters use the level-by-level build model (`build.version` 2) with bare SRD
  registry ids. Current schema version is `11` — see `docs/state-schema.md`, which is
  canonical for the persisted shape.
- Custom content is persisted per campaign in the `content.custom` bucket (schema v11).

## Architecture rules (carried forward)

1. **Canonical data has one source of truth.** Linked cards are views, not copies.
2. **UI composition state is not domain data.** Which character is active, which cards are collapsed — these are separate from character content.
3. **Migration safety is mandatory.** Every state shape change gets a defensive migration with tests.
4. **Freeform mode is always available.** Users who don't want the builder can use the sheet manually.
5. **Builtin content is read-only.** Edits fork into custom copies.
6. **The green-list rule is absolute.** If it's not in the SRD 5.1 green list, it's custom.
   See `docs/reference/builder-scope-greenlist.md` for what that list actually contains —
   it is much smaller than full 5E.

## Where the canonical detail lives

| Topic | Canonical doc |
| --- | --- |
| Persisted shape, migrations | `docs/state-schema.md` |
| Shipped builtin content scope | `docs/reference/builder-scope-greenlist.md` |
| Registry record shapes | `docs/reference/content-registry-plan.md` |
| Module boundaries | `docs/architecture.md` |
| Rules that win on conflict | `AGENTS.md` |

---
