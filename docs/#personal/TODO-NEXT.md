# Target structure

Here's a target structure:

/                              (repo root — keep small)
├── README.md                  Project overview (keep)
├── CHANGELOG.md               Version history (keep)
├── CONTRIBUTING.md            For humans (keep)
├── LEGAL.md                   SRD attribution (must stay at root)
├── AGENTS.md                  THE canonical agent rules file (consolidate AI_RULES + CLAUDE into this)
└── CLAUDE.md                  THIN — "see AGENTS.md" pointer for Claude Code
└── docs/
    ├── README.md              NEW — navigation/index for everything below
    ├── architecture.md        Current architecture (keep — load-bearing, current)
    ├── state-schema.md        Current schema (keep — load-bearing, current)
    │
    ├── reference/             EXISTS — ratified policies (keep as-is)
    │   ├── attribution-requirements.md
    │   ├── builder-scope-greenlist.md
    │   ├── content-registry-plan.md
    │   └── srd-licensing-notes.md
    │
    ├── operations/            NEW — maintenance and release
    │   ├── release-process.md          (moved from docs/)
    │   ├── testing-guide.md            (moved from docs/, fixes stale refs)
    │   ├── troubleshooting.md          (moved from docs/)
    │   ├── pre-ship-smoke-test.md      (moved from docs/)
    │   ├── browser-smoke-plan.md       (moved from docs/)
    │   ├── PWA_NOTES.md                (moved from docs/)
    │   ├── CSP_AUDIT.md                (moved from docs/)
    │   ├── security-privacy.md         (moved from docs/)
    │   └── storage-and-backups.md      (moved from docs/)
    │
    ├── plans/                 NEW — active forward-looking plans
    │   ├── LORE_LEDGER_BUILDER_PLAN.md (moved from docs/)
    │   └── NEW-FEATURES-ROADMAP.md     (moved from root)
    │
    ├── features/              NEW — per-feature design docs (survive shipping)
    │   └── character-portability.md    (moved from docs/)
    │
    └── archive/               NEW — historical records of completed design work
        └── MULTI-CHARACTER_DESIGN.md   (moved from root)

## Staged work, not one big push

Staging order:

**Stage 1 — Decide.** You react to the proposed structure. We refine it together. No file moves yet. (~30 min, conversational.)

**Stage 2 — High-impact consolidation.** Fix the AI rules problem first because it's actively harmful. Read all three files (AGENTS.md, AI_RULES.md, CLAUDE.md) carefully, identify contradictions, produce a single reconciled AGENTS.md and a thin CLAUDE.md pointer. (~1 session.)

**Stage 3 — Reorganize files into the new folder structure.** Mechanical moves, no content rewrites. (~1 session.)

**Stage 4 — Reconcile smoke test docs and fix stale references.** Read all four smoke-test docs, decide which is canonical, merge or delete the rest, fix the broken references. (~1 session.)

**Stage 5 — Write `docs/README.md` as the navigation index.** Last because it depends on the final structure being settled. (~30 min.)

**Stage 6 — Absorb the vertical-slice-schema.md decisions into content-registry-plan.md and AGENTS.md** (the work we already had queued from yesterday).
