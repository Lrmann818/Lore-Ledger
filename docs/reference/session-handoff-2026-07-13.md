# Session Handoff — 2026-07-13

_Point-in-time handoff for the builder-completion session that ran Level Up
Phase 2 through the B-batches. Verify against code before relying on details;
the binding work order is [`AGENTS.md` → Current Working Order](../../AGENTS.md#current-working-order)
and the live audit is [`docs/audits/builder-completion-matrix.md`](../audits/builder-completion-matrix.md)._

## Branch and state

- **Branch:** `builder-wizard` (local only — not pushed, matching the branch's existing posture)
- **Head:** `5355244` (session started from `730a5df`)
- **Working tree:** clean; every batch fully committed
- **Schema:** v12 (no migrations added this session — verified none were needed)

## Completed batches (this session)

| Batch | Commits | What shipped |
| --- | --- | --- |
| Authorization docs | `3ce2b22` | Phase 2 + sequenced B1/B2/B3 owner authorization recorded |
| Level Up Phase 2 (parts 1–3) | `1ae7289`, `4049e8a`, `8c28f1c`, docs `9b81aa9` | `js/domain/rules/classResources.js` (pool derivation from `classSpecificByLevel` + closed SRD rules vocabulary; explicit `resources[]` custom-class schema), `deriveCharacter().derivedResources`, duplicate-aware seeding into `character.resources[]` (`class-resource:<poolId>` markers, name adoption), Level Up growth with spent-use preservation, recovery recompute-if-untouched, summary rows, custom-content import validation, registry-plan "Class Resources" section |
| B1 panel retirement | `5d7e1b6`, docs `301a008` | Builder Identity/Abilities panels are read-only routing surfaces; `openBuilderWizard` callback; markup/tests rewritten |
| B2 spell details | `e272cae`, docs `ce12936` | Live-derived SRD detail block on builder-managed spell rows (`spellsPanel.js#renderSpellSrdDetails`) |
| B3 feature details | `f54f059`, docs `470473f` | Display-only rules-reference cards (class/subclass features, feats, race traits) with full descriptions; `deriveCharacter().raceTraits` |
| Attribution gate | `ff85903` | Audit correction: CC-BY-4.0 already ships in-app (Data & Settings → About); `tests/attribution.test.js` pins LEGAL.md + the About copy |
| Granted spells + ASI cap | `3aaa6d6` | `getGrantedSpells()` walks class-record `grantedSpells` (custom-class extension point); shared ASI editor warns above the SRD 20 cap (guidance-only) |
| Doc sweeps | `d0bcdde`, `5355244` | AGENTS doc-map staleness; matrix reassessment |

## Verification results (final state)

- `npm run typecheck` — clean
- `npm run test:run` — **1006/1006** across 60 files
- `npm run verify` — exit 0 (typecheck + tests + production build + PWA precache)
- `npm run test:smoke` — **53/53** Playwright smokes
- Phone-width (380px) production-preview checks: Phase 2 (Rage tile seeding, Level Up summary, zero overflow) and B1 (read-only panels, wizard routing) — both green
- Known flake: `partyLocationPanels` / `npcPortrait` smokes are timing-sensitive (portrait upload) and occasionally fail once, passing on retry; pre-existing, untouched by this session

## Remaining gaps (see matrix §1/§3 for full detail)

- **P1 (only one left): #15 custom-content authoring UX** — form-based editor so users can author custom races/classes/spells (incl. `resources[]`, `grantedSpells`) without hand-writing JSON. This is the recommended next batch and needs its own session-scale plan.
- P2 backlog in rough order: Finish-step count warnings (#1), attack recalculate-from-build affordance (#9), character-export bundling of referenced custom records (#17), subclass 1-use feature-action counters (#13 follow-up), partial-regain recovery modes (#8), prepared-formula/spellbook-growth overrides (#16), equipment depth (#10), keyboard-only a11y pass (#19).

## Owner decisions still needed

None blocking. Two future product calls flagged in the matrix: magic-item scope (greenlist change, #10) and whether the Builder Summary panel should eventually retire (#11 note).

## Partially completed work

None — no partial batches; the tree is clean.

## Exact next commands / task

```bash
git status            # expect clean, builder-wizard @ 5355244
npm run verify        # expect green before starting
```

Next task: plan and implement **matrix #15 (custom-content authoring UX)** as a
bounded batch series (likely: authoring dialog for one kind first — feats or
spells — then classes with resources/granted spells), or pick a P2 item if a
smaller batch is preferred. Authorization posture: per the 2026-07-12 owner
authorization recorded in AGENTS.md, builder-completion batches continue
without per-batch re-authorization; anything outside the builder system,
down-leveling, or greenlist expansion still needs explicit authorization.

## Documentation updated this session

`AGENTS.md` (working order, editing model, doc map), `docs/audits/builder-completion-matrix.md`,
`docs/plans/new-features-roadmap.md`, `docs/reference/level-up-flow-spec.md` (§7),
`docs/reference/content-registry-plan.md` (Class Resources, class granted spells),
`docs/reference/attribution-requirements.md` (status), this handoff.
