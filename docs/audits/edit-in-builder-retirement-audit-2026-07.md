# Edit in Builder Retirement Audit — 2026-07

_Status: **audit record, ratified owner direction. Phase R1 (snapshot capture)
shipped 2026-07-18; owner decisions D1–D4 ruled the same day (§3). R2–R6 remain
gated on explicit owner authorization.** Audited against code at `builder-wizard`
HEAD `47a0439` on 2026-07-18. The normative replacement design lives in
[`docs/reference/restore-character-spec.md`](../reference/restore-character-spec.md);
the binding work order remains
[`AGENTS.md` → Current Working Order](../../AGENTS.md#current-working-order)._

## Owner decision being audited (ratified 2026-07-18)

> The Builder creates characters. It is **not** a general-purpose tool for
> retroactively rewriting race, class, subclass, background, equipment, feat, or prior
> progression decisions after creation. The general user-facing **Edit in Builder**
> action will be retired. Its "fix a mistake" role is replaced by **pre-Level-Up
> snapshots + Restore Character** (restore a pre-mistake copy, redo the Level Up).
> Everything else players edit lives on the normal sheet, exactly as the
> [Editing Model](../../AGENTS.md#editing-model-guarded-build-choices-vs-quick-edit-sheet-fields)
> already defines.

This document is the Phase A dependency inventory and the Phase G editable-field
boundary audit for that decision. **Nothing here changes runtime behavior.** Until the
retirement implementation phase (R5 in the spec) is authorized and shipped, Edit in
Builder remains present and all current docs describing it remain accurate.

---

## 1. Dependency inventory

Classification legend: **Remove** · **Keep-creation** (needed by the creation wizard) ·
**Keep-shared** (Level Up and/or Long Rest share it) · **Move-to-sheet** ·
**Replace** (another explicit flow takes over) · **Owner-decision**.

### 1.1 UI entry points

| # | Dependency | Where | Classification |
| --- | --- | --- | --- |
| E1 | Action-menu item `Edit in Builder` (`#charActionEditBuilderBtn`, `data-char-action="edit-builder"`) | `index.html:540-541` | **Remove** |
| E2 | Builder Identity panel routing button (`#charBuilderIdentityEditBtn`, class `builderEditRouteBtn`) | `index.html:625`, `js/pages/character/panels/builderIdentityPanel.js` | **Owner-decision** (§3, D1) — the B1 panel exists *only* to display guarded choices and route to Edit in Builder |
| E3 | Builder Abilities panel routing button (`#charBuilderAbilitiesEditBtn`) | `index.html:666`, `js/pages/character/panels/builderAbilitiesPanel.js` | **Owner-decision** (§3, D1) — same B1 routing purpose |
| E4 | `editBuilderButtons` enable/disable wiring | `js/pages/character/characterPage.js:493-503` | **Remove** |
| E5 | `runEditBuilderCharacterAction()` + the `"edit-builder"` dispatch case | `js/pages/character/characterPage.js:701-705, 937` | **Remove** |
| E6 | `openBuilderWizard(character)` lazy handle injected into both B1 panels | `js/pages/character/characterPage.js:165-170, 295-297` | **Remove** (dies with E2/E3's routing role) |

### 1.2 Routes and mode flags

| # | Dependency | Where | Classification |
| --- | --- | --- | --- |
| M1 | `builderWizard.open({ character })` edit mode: `editingCharacterId`, draft seeded from `normalizeCharacterBuild(clonePlainBuild(character.build))`, title "Edit with Builder" | `js/pages/character/builderWizard.js:1713-1735` | **Remove** (create mode — `open()` with no character — is Keep-creation) |
| M2 | `onFinish` result carries `characterId` | `builderWizard.js:1752-1760` | **Keep-creation** with the field always `null`; drop the field only if the edit branch (M3) is fully removed in the same change |
| M3 | `onFinish` **edit branch**: in-place `character.name`/`character.build` replacement + `adoptInitialBuilderPreparedSelections()` + `getBuilderFinishSheetSeedPatch()` re-seed | `js/pages/character/characterPage.js:352-377` | **Remove** (the create branch below it is Keep-creation) |

### 1.3 Builder state initialization and seeding

| # | Dependency | Where | Classification |
| --- | --- | --- | --- |
| S1 | `getBuilderFinishSheetSeedPatch()` — additive sheet seeding | `js/domain/builderSheetSeeding.js` | **Keep-shared** — called by creation Finish, the Edit branch (M3), **and Long Rest prepared-spell seeding** (`characterPage.js:576`). Only the M3 call site retires. |
| S2 | Re-seed dedup machinery: `builderSeed` markers, `featureLineDedupKey()`, weapon-marker attack dedup, unmarked-name respect | `builderSheetSeeding.js:330-360` and throughout | **Keep-shared** — Level Up's `getLevelUpSheetSeedPatch` and the Long Rest re-seed depend on the same idempotence. Comments naming "Edit in Builder / Level Up" as the re-seed drivers need a wording pass at retirement (see §4 docs list). |
| S3 | Derived-mirror refresh on re-seed ("Edit in Builder can change Dex/armor/shield") | `builderSheetSeeding.js:1300-1360` | **Keep-shared** — the adoption-safety stamp rule and mirror refresh also serve Level Up and Long Rest. After retirement the *only* remaining paths that change derivation inputs are Level Up (ASI/feat/level) and Long Rest (prepared changes); the logic stays, the comment's example changes. |
| S4 | `adoptInitialBuilderPreparedSelections()` | `characterPage.js:69-95` | **Keep-creation** (creation Finish). The edit-branch call retires. Note: Level Up's apply path does **not** call it; a multiclass into a new prepared caster gets its `rest.preparedByClass` bucket lazily via `normalizeCharacterRestState` / Long Rest defaults, so no gap opens. |
| S5 | `clonePlainBuild()` + `normalizeCharacterBuild()` (dev-proxy-safe cloning + v1→v2 normalization) | `js/domain/characterHelpers.js:389-410, 269-386` | **Keep-shared** — creation wizard, Level Up wizard (`levelUpWizard.js:1070`), and migration all use them. |
| S6 | Wizard step primitives shared with Level Up (`makeSelect`, `renderMultiPickChoice`, `readChoice`, `writeChoice`) | `js/pages/character/builderWizardSteps.js` | **Keep-shared** |

### 1.4 Finish/Level Up sharing already contract-pinned

The Level Up spec §6.4 encodes the sharp edge directly: *"`getBuilderFinishSheetSeedPatch()`
must keep its fill-only-when-empty behavior for Edit-in-Builder"* while the Level Up
patch applies deltas. After retirement that sentence's justification shifts from Edit
in Builder to the Long Rest re-seed call site — the fill-only-when-empty rule itself
**must not change**, or Long Rest would clobber slot totals. Classification:
**Keep-shared**, doc wording updated at retirement.

### 1.5 Tests

| # | Test | What it pins | Classification |
| --- | --- | --- | --- |
| T1 | `tests/characterPage.test.js:422, 511, 553, 1137, 1282` | Menu item presence, label, freeform-disable of `edit-builder` | **Remove/rework** at R5 |
| T2 | `tests/characterPage.test.js:3490, 3733` | Edit-mode open ("Edit with Builder" title) via menu and B1 routing | **Remove/rework** at R5 |
| T3 | `tests/builderWizard.editClone.test.js` (whole file) | The edit-mode `DataCloneError` regression (proxied build → `clonePlainBuild`) | **Replace** — the underlying hazard lives on in Level Up's use of `clonePlainBuild`; keep equivalent coverage against `levelUpWizard.open()` before deleting this file |
| T4 | `tests/smoke/builderWizard.smoke.js:112, 130-135, 176, 184` | Edit-mode smoke + the historical Edit-in-Builder crash regression | **Remove/rework** at R5 |
| T5 | `tests/smoke/attackEditor.smoke.js:68-70` | Uses Edit in Builder as the **lever** to raise STR and prove attacks live-derive | **Replace lever** — needs a post-retirement way to change a derivation input (see D2) |
| T6 | `tests/smoke/structuredVitals.smoke.js:82-84` | Same lever pattern for WIS → spell DC/attack | **Replace lever** (same dependency as T5) |

T5/T6 are the load-bearing finding: two shipped smoke suites prove the calculation
contract's "derived values update automatically" promise **by editing a base ability
score through Edit in Builder**, because that is the only post-creation surface that
can change a builder character's base scores today.

### 1.6 Documentation that names Edit in Builder as current behavior

To revise at retirement (R5), not before:

- `AGENTS.md` — Editing Model (guarded flows list), step 9 (B1 description), Level Up
  Rules ("A user who made a mistake can use 'Edit in Builder'…")
- `docs/reference/level-up-flow-spec.md` — §2 (down-level HP exclusion), §6.4
  (Edit-mode seeding contract), §10.1 (mistake remedy), §11 (unpicked grants
  "recoverable via Edit in Builder")
- `docs/audits/builder-completion-matrix.md` — row #11 (B1 routing surfaces)
- `docs/reference/content-registry-plan.md:1369` — re-seed dedup mention
- `js/pages/character/builderWizardSteps.js` `getIncompleteChoiceSummaries` JSDoc +
  the creation Summary guidance copy ("completable later via Edit in Builder or Level
  Up")
- Historical records (`docs/audits/character-calculation-audit-2026-07.md`,
  `docs/reference/session-handoff-2026-07-14.md`, archived audits) stay as-is —
  point-in-time documents are not rewritten.

### 1.7 Feature assumptions that require reopening the Builder

| # | Assumption | Source | Classification |
| --- | --- | --- | --- |
| A1 | "A user who made a mistake can use 'Edit in Builder' or create a corrected character" (down-leveling remedy) | level-up spec §10.1 | **Replace** — Restore Character is the designed remedy; also retires the known Edit-in-Builder down-level `hpMax` bug *with* the flow that exposes it |
| A2 | Incomplete creation choices are "completable later via Edit in Builder or Level Up" (Finish is deliberately non-blocking) | `builderWizardSteps.js:302-310`, matrix #1 | **Owner-decision** (D3) — Level Up only asks for *newly unlocked* choices; retirement orphans earlier-level gaps |
| A3 | Spell pickers "allow choosing fewer; unpicked grants are recoverable via Edit in Builder" | level-up spec §11 | **Owner-decision** (D3, same gap class) |
| A4 | B1: builder panels are "read-only routing surfaces (Edit in Builder)" | AGENTS.md step 9, matrix #11 | **Owner-decision** (D1) — what the panels become |
| A5 | Down-level HP bug tracked "separately" against Edit in Builder | level-up spec §10.1 note | **Remove** — the bug retires with `removeLevelAt` exposure; no fix needed if retirement lands first |

### 1.8 Repair / adoption / reseeding behavior Edit in Builder performs today

Verified against code — this is what actually runs when a user finishes an Edit:

1. **In-place build replacement** with the wizard draft (name + `build`).
2. **Prepared-selection adoption** for classes missing a `rest.preparedByClass`
   bucket (`adoptInitialBuilderPreparedSelections` — fills missing keys only).
3. **Additive re-seed** via `getBuilderFinishSheetSeedPatch`: appends missing feature
   lines/languages/proficiencies/attacks/spells/slot rows/inventory pockets
   (duplicate-aware), fill-when-empty vitals, adoption-safety calc-block stamping,
   and derived-mode flat-mirror refresh.
4. **Build normalization** on open (`normalizeCharacterBuild` over a plain clone) —
   *not* Edit-exclusive; `migrateState` v11 performs the same normalization on load.
5. **Rename** via the wizard's name field — redundant with the Rename action.

(2), (3), (4) survive retirement through their other callers (creation, Level Up,
Long Rest, migration). (1) is the general-purpose rewrite being retired. (5) has an
existing replacement.

---

## 2. Phase G — ordinary editable-field boundary

Audit question: what do users rely on Edit in Builder to change, and does every
legitimate post-creation edit have a non-Builder editor?

### 2.1 Already editable on the normal sheet (no gap, no action)

Verified surfaces, all independent of the Builder: name (Rename action + Basics),
portrait (Basics/portrait flow), biography/personality/notes, current/max/temp HP and
death saves (Vitals, incl. calc editors for adjustments and fixed overrides), AC /
spell DC / spell attack adjustments and fixed modes (Structured Vitals editors),
initiative/speed overrides, saves and skills (+ overrides), attacks (per-row editor
incl. weapon linking and adjustments), spells and spell notes (Spells panel), prepared
spells (Long Rest flow), equipment/inventory/pockets/money, features (manual feature
cards + `featureUses`), custom counters (`resources[]` tiles incl. recovery
metadata), languages/proficiencies text, conditions/status. The
[calculation contract](../reference/character-calculation-contract.md) governs which
of these derive vs. accept manual input; nothing in the retirement changes that.

### 2.2 Guarded choices whose only editor is Edit in Builder today

These are *structural* choices, intentionally guarded per the Editing Model. After
retirement their edit paths become: creation (before Finish), Level Up (newly
unlocked choices only), or Restore + redo (recent levels). Remaining holes:

| # | Field | Post-retirement path | Gap? |
| --- | --- | --- | --- |
| G1 | Race / subrace / background | None (creation-only) | **Intentional** per owner decision — these define the character |
| G2 | Class levels / multiclass order / subclass | Level Up (append) + Restore (undo recent) | Covered for go-forward; historical rewrites intentionally impossible |
| G3 | **Base ability scores / ability method** | **None** | **Real gap (D2)** — a typo'd 14→41 STR at creation has no correction path; also breaks the T5/T6 smoke levers |
| G4 | ASI / feat choices at already-taken levels | Restore + redo (if a snapshot predates it) | Covered for post-snapshot levels; level-1-adjacent choices predate every snapshot |
| G5 | **Incomplete creation choices** (skipped skills, ancestry, origin cantrip, partial ASI) | **None** (Level Up asks only what the new level unlocks) | **Real gap (D3)** — the creation Summary explicitly promises later completion |
| G6 | Unpicked Level Up spell grants from *earlier* levels | Restore + redo (if snapshotted) | Mostly covered; the promise wording in level-up spec §11 must change |
| G7 | Build equipment selections (`build.equipment`) | Sheet inventory/attacks are user-owned already; the build record stays frozen | Cosmetic only — seeded rows remain editable; no rules impact |
| G8 | Starting-name typo | Rename action | No gap |

### 2.3 Boundary conclusion

The Editing Model's two-category split survives intact. Retirement does not move any
play-state editing; it narrows *structural* editing from
{creation, Edit in Builder, Level Up} to {creation, Level Up, Restore}. Exactly two
correction workflows are orphaned — G3 (base ability scores) and G5/G6
(incomplete-choice completion) — and both are listed as blocking owner decisions
below. **Per the owner instruction, Edit in Builder must not be removed until D2 and
D3 are resolved** (moved to an explicit flow, deferred with approval, or proven
unnecessary).

---

## 3. Owner decisions — **ruled 2026-07-18** (bind the R5 design; R1 shipped without depending on them)

- **D1 — B1 panel disposition: RULED.** Both general Builder-edit panels (Builder
  Identity, Builder Abilities) retire during R5, **provided ordinary play-state
  editors remain available elsewhere**. Ordinary sheet editors must not be removed
  merely because they share code with Edit in Builder (the Keep-shared rows in §1.3
  stay).
- **D2 — base ability-score editing: RULED.** Retiring Edit in Builder must preserve
  base ability-score editing **through the existing editor on the Abilities & Skills
  page**. Do **not** create a new "Correct Ability Scores" flow. The existing editor
  is the canonical user-facing path for base ability scores, saving throw
  proficiencies, and miscellaneous saving throw bonuses.

  **R1 audit of that editor (2026-07-18, code-verified, no changes made):**
  - *Freeform characters:* score inputs write `character.abilities[key].score`
    directly; the save-proficiency checkbox writes `abilities[key].saveProf`; save
    totals recompute as `mod + (saveProf ? proficiency : 0) + extra save mod`
    (`abilitiesPanel.js` `createAbilityRecalc`). Conforms to the ruling today.
  - *Builder characters:* ability **adjustments** (`overrides.abilities`, the
    `.abilityMoves` controls), save-proficiency toggles (manual toggle merges with
    class-derived proficiency), and misc save bonuses are already sheet-editable and
    recalculate live through `deriveCharacter()` — the shared engine (proven
    end-to-end by the structuredVitals/attackEditor smokes). **Documented R5 gap:**
    the base-score inputs themselves are currently `disabled`/`readOnly` with the
    hint "Builder mode ability scores are controlled by Builder Abilities for now"
    (`abilitiesPanel.js:444, 719-727`) — a deliberate B1-era guard that routes to
    Edit in Builder. R5 must enable those inputs for builder characters, writing
    through to `build.abilities.base` so every dependent derived value (modifiers,
    saves, skills, attacks, spell DC/attack, AC, HP) recalculates through the
    existing engine, and update the hint text plus the T5/T6 smoke levers to use
    the sheet editor instead of Edit in Builder. No correctness, persistence, or
    accessibility defect was found in the existing editor beyond that deliberate
    disable; nothing blocks R1.
- **D3 — incomplete required choices: RULED.** The Edit-in-Builder dependency is
  replaced by a future **contextual incomplete-choices banner** for the currently
  open character: shown only while that character has objectively unresolved
  *required* creation or granted-content choices; explains setup is incomplete;
  offers a `Complete Choices` action opening a narrow flow containing **only** the
  unresolved required choices; never reopens completed choices; disappears
  immediately on resolution; persists across reload until complete; follows the
  responsive/keyboard/focus/screen-reader conventions. Not part of R1; design and
  build land with R5 (or a dedicated pre-R5 batch).
- **D4 — source-character deletion: RULED.** Deleting a playable character keeps its
  snapshots by default. The future delete confirmation states that Restore Character
  versions remain available. No "also delete snapshots" option in v1. (R1 pins the
  keep-by-default behavior in tests; the confirmation copy lands with the R3 UI.)

These rulings unblock the R5 design. They do **not** authorize R2–R6; each phase
still requires explicit owner authorization per the working order.

---

## 4. Verification basis

- Grep inventory: `edit-builder`, `editBuilder`, `Edit in Builder`, `Edit with
  Builder` across `js/`, `index.html`, `tests/`, `docs/`, `types/` at HEAD `47a0439`
  (all hits classified above; historical docs intentionally excluded from the change
  list).
- Call-path reads: `characterPage.js` (menu wiring, onFinish branches, Level Up
  onApply, rest actions, delete/select/import/export), `builderWizard.js` (open
  modes, finish), `levelUpWizard.js` (open/apply), `builderSheetSeeding.js` (Finish
  patch, Level Up patch, dedup markers, mirror refresh), `characterHelpers.js`,
  `stateActions.js`, `cardLinking.js`, `state.js` (sanitize + migrations),
  `campaignVault.js`, `backup.js`, `characterPortability.js`, `texts-idb.js`,
  `combat.js` (participant source refs).
- No runtime behavior was changed by this audit.
