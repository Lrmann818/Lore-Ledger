# Character Calculation Architecture Audit — 2026-07-14

_Status: audit complete; the attack correction and High Elf choice are being
implemented in the same owner-authorized session (this document's per-item statuses
are updated as each batch lands). The normative contract lives in
[`docs/reference/character-calculation-contract.md`](../reference/character-calculation-contract.md);
this document records what was found and what was decided._

## Scope

Owner-authorized audit of how every major character-sheet value is stored, derived,
adjusted, overridden, persisted, and tested — for builder characters and manually
entered (freeform) characters — plus the choice-based granted-spell completeness
audit (High Elf).

## How the engine actually works

`js/domain/rules/deriveCharacter.js` is the single rules engine. It already handles
**both** modes: builder characters derive from `build` + registry data; freeform
characters derive from sheet inputs (`abilities[key].score`, `skills[key]`,
`saveProf`, `character.proficiency`, `overrides`, `saveOptions`). Panels decide
per-field whether to consume the derived value or a flat snapshot field — every
parity gap found lives in that wiring, not in the engine.

Persistence: all inputs and snapshots live on the character entry;
`sanitizeForSave` passes entries through whole, so extra structured keys persist
without schema migrations (the `builderSeed` precedent). Export/import and
campaign-vault hydration copy entries wholesale.

## Value-by-value matrix

Columns: current model / Builder-manual parity / auto-updates / adjustment support /
fixed-override support / action.

| Value | Current model | Parity | Auto-updates | Adjustments | Fixed override | Action |
| --- | --- | --- | --- | --- | --- | --- |
| Ability scores & modifiers | Live-derived both modes (`deriveCharacter`); builder base is guarded, freeform score is a sheet input | ✅ same engine | ✅ | `overrides.abilities` (both modes) | n/a (score is the input) | None |
| Saving throws | Live-derived both modes; builder profs from classes/feats, freeform from `saveProf` toggles | ✅ | ✅ | `overrides.saves` + freeform `saveOptions.misc/modToAll` | Proficiency toggle is explicit | None |
| Skills & expertise | Live-derived both modes; builder merges manual toggle (higher proficiency level wins) | ✅ | ✅ | per-skill `misc` + `overrides.skills` | Manual level toggle is explicit | Race-trait skill grants (Keen Senses, Menacing) are prose-only → choice audit §below |
| Initiative | Builder: live-derived, read-only (DEX + `overrides.initiative` + feat effects). Freeform: flat `initiative` snapshot | ⚠️ | Builder ✅ / freeform ❌ | `overrides.initiative` (builder path) | Freeform flat field is an implicit override | Documented follow-up (F1) |
| Passive Perception | Derived both modes; displayed only in the wizard Summary | ✅ | ✅ | via Perception misc | none | None (sheet display is a product decision, not a defect) |
| Proficiency bonus | Builder: derived from level, read-only. Freeform: manual input `proficiency` | ✅ by design (freeform prof is an _input_) | ✅ | — | n/a | None |
| Speed / hit dice | Builder: live-derived read-only. Freeform: manual inputs | ✅ by design | ✅ | feat speed bonus | freeform flat fields | None |
| HP maximum | Seeded snapshot; Level Up **accumulates** the derived delta so manual offsets survive | ✅ | Only at Level Up (a between-level CON change does not flow) | Manual offsets preserved by the delta policy | Implicit (any edit) | Documented deviation (F2) |
| Armor Class | Seeded snapshot; Level Up **recompute-if-untouched**; a manual edit silently becomes a kept manual value | ✅ | ❌ between level-ups (Dex/armor changes don't flow) | none | Implicit only — violates the explicit-override rule | Documented deviation (F2) |
| Spell save DC / spell attack | Same snapshot + recompute-if-untouched model as AC | ✅ | ❌ between level-ups | none | Implicit only | Documented deviation (F2) |
| **Attacks & damage** | **Was:** static snapshot strings; builder seeds once; manual rows were final-value text fields; explicit Recalc dialog whose Apply failed in production preview | ⚠️ manual rows were pure text | ❌ | ❌ | Everything was implicitly fixed | **Being corrected this session (Batches 1–3)** — structured attacks, one calculator, live derivation, explicit adjustments, intentional fixed mode, safe legacy conversion (see contract doc) |
| Class/feature resource maximums | Derived pools (`classResources.js`), seeded duplicate-aware, Level Up grows by delta, spent uses preserved | ✅ | At Level Up by design | Manual offsets kept | Seeded tiles degrade to inert user tiles | None |
| Weapon damage (registry) | Weapon records are structured inputs; consumed by the attack calculator | ✅ | ✅ (structured attacks) | `damageAdjustment` | fixed mode | Corrected with attacks |

### Survival matrix (save / reload / export / import / vault)

All inputs, adjustments, and snapshots above live on the character entry and survive
save, reload, single-character export/import, full backup, and campaign-vault
hydration (verified by `saveCompatibility.test.js`, vault round-trip tests, and the
portability suite). Structured attack `calc` blocks ride the same open
`AttackEntry` shape — no migration required or added.

### Test coverage found

- Derivation: `rulesEngine.test.js`, `progressionRules.test.js`, `classResources.test.js`
- Seeding: `builderSheetSeeding.test.js`, `levelUpSheetSeeding.test.js`
- Attacks (pre-correction): `attackRecalculation.test.js`, `attackRecalcDialog.test.js`, `tests/smoke/attackRecalc.smoke.js`
- Persistence: `state.sanitize.test.js`, `saveCompatibility.test.js`, `characterPortability.test.js`

## Findings and dispositions

**F0 — Attacks (correction in progress this session).** The snapshot attack model violated the
product contract in every column: no parity for manual rows, no auto-updates, no
adjustments, only implicit fixing, and a broken Apply control in `npm run preview`.
Replaced by the structured attack model + canonical calculator; the Recalculate
from Build dialog was removed and its two legitimate jobs (legacy weapon linking,
returning to calculated values) moved into the attack editor. See the contract doc
and `content-registry-plan.md → Structured Attacks`.

**F1 — Freeform initiative (follow-up, small).** `deriveCharacter` already computes
freeform initiative (DEX mod + `overrides.initiative`), but the Vitals panel shows
the flat `initiative` field for freeform characters. Converting it to
derived-plus-adjustment needs a decision about existing sheets whose stored value
differs from DEX-derived (treat as adjustment? as fixed?). Recommended: own batch,
paired with F2's mechanism.

**F2 — AC / spell DC / spell attack / HP max (follow-up, medium).** These are
snapshot fields with Level-Up-time policies. They deviate from the contract in two
ways: dependencies don't flow between level-ups, and manual edits become silent
fixed overrides. A conforming design needs an explicit adjustment + visible
override affordance (e.g. the quick-edit popover pattern) and a safe adoption story
for existing sheets. Needs new owner scope; do not bolt onto the attack work.

**F3 — Race-trait proficiencies are prose-only.** Fixed skill/weapon/tool grants
(Keen Senses, Menacing, Elf Weapon Training, Dwarven Combat Training, Tool
Proficiency) exist only as trait description text; `deriveCharacter` never sees
them. Consequences: builder skill indicators miss race skills, and weapon
proficiency defaults can't detect race-granted weapons. Requires structured trait
effects or race-record fields (adapter change) — documented in the choice audit,
deferred with a recommended shape.

**F4 — Feat effects vocabulary lacks `weapon_proficiency`.** Custom feats cannot
grant weapon proficiencies structurally. Deferred; the structured attack model's
per-attack `proficient` input covers the play-state need manually.

## Choice-based granted spells / unresolved Builder choices

**Root cause of the High Elf gap** (four stacked omissions):

1. `game-data/srd/races.json` `high-elf` carries no `choices[]` — the subrace
   adapter (`scripts/adapters/racesAdapter.js`) never emitted subrace choices.
2. The wizard's origin-choices step read `choices[]` from race and background
   entries only — never from the selected subrace.
3. The closed choice-kind vocabulary reserved `cantrip` but no renderer or
   validation consumed it.
4. `deriveCharacter` had no path from a race/subrace spell choice (or a fixed race
   `grantedSpells` array) into `derived.grantedSpells`, so seeding could never add
   the spell.

All four were corrected this session — see
`content-registry-plan.md → Build-Time Choices Schema` (filtered spell choices) and
the completeness report below.

### Choice completeness report (SRD 5.1 registry sweep)

**Supported and working (after this session):**

- Dragonborn Draconic Ancestry (`ancestry`, race)
- Human / Half-Elf bonus language (`language`, race), Acolyte languages (`language`, background)
- **High Elf wizard cantrip (`cantrip`, subrace, filtered wizard/level-0 list, INT provenance)** — new
- **High Elf extra language (`language`, subrace)** — new
- Class skills, multiclass skills, expertise, fighting styles, ASI/feat slots,
  cantrip/known/spellbook/prepared spell counts (class-progression choice ids)
- Subclass granted spells; class-record `grantedSpells` (custom classes)

**Representable but not wired into the Builder:** none found — every `choices[]`
entry in shipped data now renders.

**Unsupported schema (deferred, with recommended shape):**

- Half-Elf "+1 to two other abilities of your choice" — needs a new choice kind
  (e.g. `ability`, count 2, excluding CHA) plus derive support. Priority:
  **high** (it is a core Half-Elf feature; currently the +1s are silently missing).
- Half-Elf Skill Versatility (choose 2 skills) — representable with the existing
  `skill` kind + an origin-step renderer + a derive hook reading race choices into
  the skill set. Priority: **high**, smallest of the deferred items.
- Dwarf Tool Proficiency (smith's/brewer's/mason's tools) — blocked on the absence
  of a tools registry; would need literal string options or a tools file. Priority:
  low.
- Tiefling Infernal Legacy — the thaumaturgy cantrip is representable **today** as a
  fixed race `grantedSpells` entry (the derive path now consumes race-level grants);
  the level-gated once-per-long-rest spells (hellish rebuke, darkness) need a
  `grantType: "once_per_long_rest"` play-state story first. Priority: medium
  (cantrip), low (leveled).
- Race-trait fixed proficiencies (F3 above). Priority: medium.

**Intentionally outside current scope:** monk/druid/etc. content beyond SRD 5.1,
magic items, down-leveling, multiclass-specific choice UIs beyond what ships.

**Recommended priority order for a future batch:** Half-Elf skills → Half-Elf
ability choice → Tiefling cantrip grant → race-trait fixed proficiencies (F3) →
Dwarf tools.

## Decisions log

- **One calculator:** `js/domain/attackCalculation.js` owns all attack math; Finish
  seeding, the editor, both panels, and legacy conversion call it. The former
  `attackRecalculation.js` proposal engine was removed with the dialog.
- **Recalc button disposition: removed and replaced.** Its valid roles (legacy
  linking, repair of broken source references, returning to calculated mode,
  inspecting the calculation) moved into the per-row attack editor, which previews
  before applying and never mutates on cancel. The broken Apply control no longer
  exists.
- **Legacy attacks:** rows without `calc` keep their stored values verbatim until
  the user explicitly converts them in the editor. No data migration; no name
  matching; conversion is preview-first and cancel-safe.
- **No schema migration** was needed anywhere in this session (open shapes +
  pass-through sanitize + defensive reads).
