# Archived Documentation

**Nothing in this directory describes the current state of Lore Ledger.**

These are point-in-time records: superseded plans, completed phase trackers, and audits
whose commit hashes and branch topology have long since changed. They are kept for
provenance — they explain *why* past decisions were made — and for no other reason.

## Rules for coding agents

1. **Do not read these docs as part of normal task context.** If a task doesn't explicitly
   ask about project history, skip this directory entirely.
2. **Do not treat any checklist, "future work", or "still deferred" item here as
   remaining work.** Most of it shipped. Some was abandoned.
3. **Do not change code to match these documents.** If code disagrees with an archived
   doc, the code is right.
4. **Do not use commit hashes, branch tips, or test counts from these documents.**
5. If an archived doc contradicts `AGENTS.md` or a doc under `docs/reference/`, the
   canonical doc wins without exception.

## Contents

| Doc | Was | Archived | Superseded by |
| --- | --- | --- | --- |
| `lore-ledger-builder-plan.md` | Phase-by-phase implementation tracker for the character builder | 2026-07-09 | `docs/reference/builder-scope-greenlist.md`, `docs/reference/content-registry-plan.md`, `docs/reference/character-builder-handoff.md` |
| `lore-ledger-multi-branch-review.md` | Audit of the `main` / `develop` / `builder-wizard` divergence | 2026-07-09 | Branch unification completed; see `AGENTS.md` and `docs/state-schema.md` |
| `multi-character-steps-1-4.md` | Step-by-step build record of the multi-character system (April 2026) | 2026-07-09 | `docs/features/multi-character-design.md` (canonical rules); its green list is wrong — see `docs/reference/builder-scope-greenlist.md` |

## When to archive a doc

Move a doc here when it becomes a record of *what happened* rather than a description of
*what is*. Typical triggers:

- a plan whose work has shipped
- a phase/commit tracker for completed work
- an audit or review tied to a specific commit range
- a design doc whose rules have been absorbed into a canonical reference doc

When you archive a doc: `git mv` it here, add an `⚠️ ARCHIVED` banner at the top naming
what supersedes it, add a row to the table above, and update the links in
`docs/README.md` and `AGENTS.md`.
