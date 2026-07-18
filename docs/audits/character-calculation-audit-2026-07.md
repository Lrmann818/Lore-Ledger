# Character Calculation Architecture Audit — 2026-07-14

_Status: audit complete. The attack correction and the High Elf choice
**shipped 2026-07-15**; the F2 Structured Vitals conversion (spell DC/attack,
AC, max HP) **shipped 2026-07-16/17** — see "Phase B — F2 implementation
record" at the end. The normative contract lives in
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
| **Attacks & damage** | **Was:** static snapshot strings; builder seeds once; manual rows were final-value text fields; explicit Recalc dialog whose Apply failed in production preview | ⚠️ manual rows were pure text | ❌ | ❌ | Everything was implicitly fixed | **Corrected this session** — structured attacks, one calculator, live derivation, explicit adjustments, intentional fixed mode, safe legacy conversion (see contract doc) |
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

**F0 — Attacks (fixed this session).** The snapshot attack model violated the
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
- **High Elf wizard cantrip (`cantrip`, subrace, filtered wizard/level-0 list, INT provenance)** — shipped 2026-07-15
- Class skills, multiclass skills, expertise, fighting styles, ASI/feat slots,
  cantrip/known/spellbook/prepared spell counts (class-progression choice ids)
- Subclass granted spells; class-record `grantedSpells` (custom classes)

Note: High Elf's **Extra Language** trait remains prose-only (not a structured
`choices[]` entry), so it is not yet a wired pick — see F3 / the deferred list.

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

---

# Phase A — F2 field-by-field audit (2026-07-15, owner-authorized)

_Owner authorization: bring the four remaining snapshot fields (spell save DC,
spell attack bonus, Armor Class, maximum HP) under the calculation contract —
derived by default, adjusted through explicit modifiers, fixed only through an
intentional override; one engine for builder and manual characters. This section
is the pre-implementation audit; the implementation batches follow it. Scope is
strictly the four F2 fields — no unrelated backlog, no down-leveling, no
multiclassing, no greenlist or equipment expansion._

## A.0 The single most important finding

**The rules engine already computes all four values for builder characters.**
The F2 deviation is a **wiring and affordance** gap, not a missing calculator:

| Value | Already derived in `deriveCharacter()` | Evidence |
| --- | --- | --- |
| Max HP | `hp.max` via `computeMaxHp(levels, conMod, registry, { perLevelBonus })` | `deriveCharacter.js:764-770`; `progression.js:500-537` |
| Armor Class | `ac.value` + `ac.formula` via `computeArmorClass({ armor, shield, unarmored formulas, acBonus })` | `deriveCharacter.js:772-791`; `progression.js:754-816` |
| Spell save DC | `spellcasting.classes[i].saveDc = 8 + prof + abilityMod`, **per source** | `deriveCharacter.js:800-826` |
| Spell attack | `spellcasting.classes[i].attackBonus = prof + abilityMod`, **per source** | `deriveCharacter.js:805` |

The panels display the flat snapshot fields (`character.hpMax/ac/spellDC/
spellAttack`) instead of these derived values (`vitalsPanel.js:298-310`,
`vitalNumberFields` — none of these four are in `BUILDER_OWNED_VITAL_NUMBER_IDS`
at `vitalsPanel.js:25`, so they behave as free snapshot inputs). Seeding fills
them once, fill-when-empty (`builderSheetSeeding.js:1217-1232`), and Level Up
patches them with accumulate (HP) / recompute-if-untouched (AC/DC/attack)
policies (`builderSheetSeeding.js:1036-1145`). Between level-ups nothing flows,
and a manual edit becomes a silent implicit fixed override.

**Multiple spellcasting sources are already modeled at the derive layer.**
`spellcasting.classes[]` is a per-class list, each with its own `ability`,
`saveDc`, `attackBonus` (`deriveCharacter.js:800-826`); race/subrace choice
grants carry `grantedSpells[].spellcastingAbility` provenance
(`deriveCharacter.js:842-854`, e.g. the High Elf INT wizard cantrip). The
snapshot model collapses all of this into one `spellDC`/`spellAttack` scalar
seeded from `spellcasting.primary` only (`builderSheetSeeding.js:1224-1232`) —
that is the "one misleading universal DC" the authorization warns against.

## A.1 Field-by-field table

| Field | Current source | Current persistence | Live-derived? | Adjustment support | Fixed override | Legacy risk | Recommended batch |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Spell save DC** | Builder: `spellcasting.primary.saveDc`; Freeform: none | flat `spellDC` scalar (fill-when-empty seed; recompute-if-untouched at Level Up) | Derived exists (per source) but **panel shows snapshot**; freeform not derived | none (implicit edit only) | implicit only | **Low** — DC is a pure function of prof + ability; adoption can preview exactly | **Batch 2** |
| **Spell attack** | Builder: `spellcasting.primary.attackBonus`; Freeform: none | flat `spellAttack` scalar | same as DC | none | implicit only | **Low** | **Batch 2** |
| **Armor Class** | Builder: `computeArmorClass(...)`; Freeform: none (manual number) | flat `ac` scalar (fill-when-empty; recompute-if-untouched) | Derived exists (builder); **panel shows snapshot**; freeform manual | feat `acBonus` only (no user adjustment) | implicit only | **Medium** — a bare `16` is ambiguous (armor? shield? magic? temp spell?) | **Batch 3** |
| **Maximum HP** | Builder: `computeMaxHp(...)`; Freeform: none (manual number) | flat `hpMax` scalar (accumulate at Level Up) | Derived exists (builder); **panel shows snapshot**; freeform manual | manual offset preserved by accumulate delta | implicit only | **Medium/High** — interacts with current HP; freeform has no level history | **Batch 4** |

## A.2 The 17-point audit, per field

Answered for each field: (1) persisted fields, (2) source inputs, (3) display
path, (4) derived/seeded/copied/manual, (5) builder/manual parity, (6) existing
adjustment, (7) existing override, (8) dependency-change behavior, (9)
combat/character shared canonical state, (10) save/reload, (11) export/import,
(12) Level Up, (13) rest, (14) legacy ambiguity, (15) data sufficiency, (16)
required adoption, (17) test coverage/gaps.

### Spell save DC & spell attack bonus

1. **Persisted:** `character.spellDC`, `character.spellAttack` (nullable scalars,
   `state.js:552-553`).
2. **Inputs:** proficiency bonus + spellcasting ability modifier. Builder derives
   the ability from each caster class (`getSpellcastingClasses`) and from race
   choice grants; freeform has ability scores + a manual `proficiency` but **no
   declared spellcasting ability**.
3. **Display:** `vitalsPanel.js` tiles `#charSpellDC`/`#charSpellAtk`
   (`vitalNumberFields`, `vitalsPanel.js:308-309`), and the combat embedded
   Vitals panel `#combatEmbeddedCharSpellDC`/`Atk` — **the same panel**, because
   combat reuses `initVitalsPanel` (`combatEmbeddedPanels.js:952`). No spells
   panel DC display exists.
4. **Derived/seeded/manual:** derived-then-seeded snapshot; freeform manual.
5. **Parity:** ❌ freeform gets no derivation.
6. **Adjustment:** none.
7. **Override:** implicit (any typed value sticks).
8. **Dependency change:** an INT/WIS bump or proficiency threshold does **not**
   update the tile between level-ups.
9. **Canonical parity:** character & combat already share one panel + one field →
   ✅ automatic.
10. **Save/reload:** scalars ride the entry; survive (`sanitizeForSave` leaves
    entries as-is, `state.js:937`).
11. **Export/import:** carried whole with the entry.
12. **Level Up:** recompute-if-untouched (`builderSheetSeeding.js:1095-1098`).
13. **Rest:** unaffected.
14. **Legacy ambiguity:** a stored `15` could be WIS+prof, INT+prof, or homebrew.
15. **Data sufficiency:** ✅ **fully sufficient.** DC/attack are pure functions of
    (proficiency, ability modifier); both are available in both modes once the
    freeform caster names an ability.
16. **Adoption:** offer calculated / calculated+adjustment / fixed with a live
    preview; never infer the ability from the stored number.
17. **Tests:** `rulesEngine.test.js` (derive), `builderSheetSeeding.test.js`,
    `levelUpSheetSeeding.test.js`. **Gaps:** no test that the panel shows a
    derived DC that follows an ability change; no freeform-caster derivation; no
    multi-source DC; no adjustment/fixed persistence.

### Armor Class

1. **Persisted:** `character.ac` (`state.js:548`).
2. **Inputs:** worn armor (`build.equipment.armorId`), shield
   (`build.equipment.shield`), Dex modifier + armor Dex cap (`data.maxDex`),
   unarmored formulas keyed by feature id (Barbarian/Monk/Draconic Resilience,
   `progression.js:42-46`), feat `acBonus`.
3. **Display:** `#charAC` tile; combat `#combatEmbeddedCharAC`; **tracker party &
   npc cards** as a linked field (`partyCards.js:201/556`, `npcCards.js:197/556`).
4. **Derived/manual:** builder derived-then-seeded; freeform manual.
5. **Parity:** ❌ freeform has no structured armor to derive from.
6. **Adjustment:** only feat `acBonus`; no user adjustment field.
7. **Override:** implicit.
8. **Dependency change:** changing Dex, armor, or shield does not flow between
   level-ups.
9. **Canonical parity:** `#charAC` and combat share `initVitalsPanel`; tracker
   cards read the same flat `character.ac`.
10. **Save/reload:** survives.
11. **Export/import:** survives.
12. **Level Up:** recompute-if-untouched.
13. **Rest:** unaffected.
14. **Legacy ambiguity:** a bare `16` is genuinely ambiguous — chain mail vs
    leather+Dex vs shield vs magic vs a temporary spell vs homebrew.
15. **Data sufficiency:** ✅ for builder (equipment + features are structured);
    freeform lacks structured armor inputs.
16. **Adoption:** builder can derive with a preview; freeform stays a manual
    number unless the user opts into a structured AC. **`computeArmorClass`
    already selects the best eligible formula and returns a human-readable
    `formula` string**, so formula selection is solved for the common cases;
    explicit _alternate_-formula selection (rare ties) is a documented limitation
    for this batch.
17. **Tests:** `progressionRules.test.js`/`rulesEngine.test.js` cover the formula
    math and unarmored selection. **Gaps:** no panel-level "AC follows Dex/armor
    change" test; no adjustment/fixed; no legacy-adoption test; tracker-card
    parity after adoption.

### Maximum HP

1. **Persisted:** `character.hpMax`, plus `hpCur` (current) — distinct fields
   (`state.js:541-542`). Temp HP lives in combat participant state, not on the
   character entry.
2. **Inputs:** per-level hit die (`build.levels[i].classId` → class `hitDie`),
   per-level HP roll/average (`build.levels[i].hp`, null = SRD average), Con
   modifier applied **once per level**, feat `hp_per_level_bonus`. First level is
   max die (`progression.js:515-517`).
3. **Display:** `#charHpMax`/`#charHpCur`; combat; tracker cards linked `hpMax`.
4. **Derived/manual:** builder derived-then-seeded; freeform manual.
5. **Parity:** ❌ freeform has no per-level history.
6. **Adjustment:** the Level Up _accumulate_ policy preserves a manual offset as
   a side effect; there is no explicit adjustment field.
7. **Override:** implicit.
8. **Dependency change:** a between-level Con change does **not** flow (only Level
   Up applies the delta).
9. **Canonical parity:** shared panel + shared flat field.
10. **Save/reload:** survives.
11. **Export/import:** survives.
12. **Level Up:** accumulate by derived delta (`builderSheetSeeding.js:1056-1068`)
    — this already implements retroactive Con correctly, because `computeMaxHp`
    applies the Con modifier at every level.
13. **Rest:** Long Rest restores to `hpMax`; Short Rest spends Hit Dice. HP max is
    an input to rest, not changed by it.
14. **Legacy ambiguity:** a bare `31` cannot be decomposed into rolls vs averages.
15. **Data sufficiency:** ✅ **for builder characters** — `build.levels[i].hp`
    stores each level's roll (null ⇒ average), first level is max die, and Con is
    applied per level, so `computeMaxHp` reconstructs max HP exactly, including
    retroactive Con. ❌ **for freeform** — no level history exists; freeform max
    HP must stay a manual input. **Criterion 1 of the HP acceptance list is met
    for builder, not for freeform.**
16. **Adoption:** builder can adopt derived max HP with a preview; a diverged
    stored value is treated as an adjustment or a fixed override by explicit user
    choice, never guessed. **Current-HP rule:** when the max decreases below
    `hpCur`, clamp `hpCur` to the new max (consistent with the existing combat
    clamp `Math.min(hpMax, hpCurrent + healing)`, `combat.js:606`); increasing
    the max never auto-heals except through the Level Up delta already shipped.
    Temp HP is untouched.
17. **Tests:** `levelUpSheetSeeding.test.js` (accumulate, retroactive Con,
    conMod-null), `progressionRules.test.js` (`computeMaxHp`). **Gaps:** no
    derived-max-HP-in-panel test; no adjustment/fixed persistence; no
    max-decrease-clamps-current test; no legacy-adoption test.

## A.3 Chosen data model (mirrors the shipped attack `calc` precedent)

Each scalar field keeps its existing flat snapshot (`character.ac/hpMax/spellDC/
spellAttack`) **and** gains an **optional** structured calc block on the open
character-entry shape — the exact `AttackEntry.calc` / `builderSeed` precedent,
so **no schema migration** is required (`sanitizeForSave` passes entries through
whole, `state.js:937`). Three states per field, identical in spirit to attacks:

- **No calc block → legacy snapshot.** Show the stored flat value verbatim; never
  auto-update. Every existing sheet keeps its exact bytes and behavior. This is
  the safety default; adoption is always an explicit user action.
- **`mode: "derived"` → derived + adjustment.** `displayed = derive(inputs) +
  adjustment`; updates live on dependency change. The flat field is kept as a
  cached mirror so tracker/combat surfaces that read `character.ac`/`hpMax`
  without a registry stay correct.
- **`mode: "fixed"` → intentional fixed override.** Show the stored flat value;
  never auto-update; adjustment N/A. This is the _explicit_ replacement for
  today's _implicit_ "a typed number sticks."

Block shapes (documented normatively in the contract doc):

```js
character.acCalc     = { mode: "derived" | "fixed", adjustment: number }
character.hpMaxCalc  = { mode: "derived" | "fixed", adjustment: number }
```

**Spellcasting is modeled as profiles, not a single scalar**, to avoid the "one
misleading universal DC." The derive layer already produces one profile per
spellcasting source (`spellcasting.classes[]` + granted-spell abilities). The
character page renders a derived DC/attack pair **per distinct source ability**,
each labeled with its provenance (class name, or "Racial (Intelligence)"), using
the dynamic derived-tile precedent already shipped for the Dragonborn Breath
Weapon DC tile (`vitalsPanel.js:354-383 renderBreathWeaponDCTile`). Per-source
adjustment + fixed override live on:

```js
character.spellcastingCalc = {
  mode: "derived" | "fixed",
  bySource: { [sourceKey]: { dcAdjustment: number, attackAdjustment: number } },
  // freeform-only: the user-declared caster profile(s)
  freeform: [{ ability: string, dcAdjustment, attackAdjustment }] | undefined,
  fixed: { dc: number|null, attack: number|null } | undefined
}
```

Freeform casters declare a profile (pick an ability); the DC is
`8 + proficiency + mod(ability)` and the attack is `proficiency + mod(ability)`,
so a freeform caster's DC follows ability and proficiency changes through the
same engine.
Legacy freeform `spellDC`/`spellAttack` snapshots persist untouched until adopted.

The flat `character.spellDC`/`spellAttack` remain the legacy/back-compat surface
(single primary value) and the mirror for combat/tracker; the per-source tiles
are the contract-conformant display.

## A.4 Batch plan and boundaries

- **Batch 1 (docs, this commit):** audit (this section) + calculation-contract
  update (Structured Vitals model + legacy-adoption rules) + AGENTS.md working
  order authorization. **No runtime changes.**
- **Batch 2 — Spell save DC + spell attack:** lowest legacy risk, most explicit
  inputs. New `js/domain/spellcastingCalculation.js` (the one calculator, mirror
  of `attackCalculation.js`), per-source derived tiles + field editor in
  `vitalsPanel.js` (character + combat parity free), freeform caster profiles,
  seeding back-compat, tests + preview. High Elf INT cantrip is a first-class
  test case.
- **Batch 3 — Armor Class:** derived + adjustment + fixed via the shared field
  editor; `computeArmorClass` formula string surfaced in the preview; builder
  derives, freeform stays manual with the same adjustment/fixed affordance;
  tracker-card and combat parity verified; legacy `16` never reinterpreted.
- **Batch 4 — Maximum HP:** implement for builder (data sufficiency proven);
  freeform stays manual (documented). Adjustment + fixed; max-decrease clamps
  current HP; temp HP untouched; Level Up accumulate policy preserved and
  reconciled with the new calc block.
- **Batch 5 — Integration:** smokes, 380px + keyboard passes, persistence and
  export/import checks, matrix/roadmap/handoff updates.

Each batch leaves the branch green. Nothing here authorizes work outside the four
F2 fields.

## A.5 Blocker check

No stop condition is triggered: AGENTS.md does not contradict the authorization;
baseline `verify` is green (1135 tests); spell provenance distinguishes source
abilities (`spellcasting.classes[].ability` + `grantedSpells[].spellcastingAbility`);
AC formula selection is already deterministic; **builder** HP history is
sufficient (freeform HP is documented as manual, not guessed); no destructive
migration is required (open-shape additive blocks); old data is preserved by the
no-calc-block legacy default. The remaining choices (per-source tiles; freeform
manual AC/HP) are normal implementation decisions, made and documented above.

---

# Phase B — F2 implementation record (2026-07-16/17)

Batches 2–5 shipped. The normative behavior lives in the contract doc
("Structured Vitals ownership"); this section records what the implementation
found and decided beyond the Phase A plan.

## Shipped shape

- One display resolver per field over the existing engine formulas:
  `js/domain/spellcastingCalculation.js` (per-ability **profiles** with
  provenance labels — class casters + granted-spell sources such as the High
  Elf INT cantrip — never a universal scalar; freeform casters declare
  profiles), `js/domain/armorClassCalculation.js`, `js/domain/hpMaxCalculation.js`.
- Vitals tiles render legacy (editable snapshot + "tap ✎ to calculate" when
  derivable), derived (read-only value + formula/provenance + adjustment note),
  or fixed ("Fixed value"); extra spellcasting sources render as additional
  read-only tiles. One shared scalar calculation editor serves AC and max HP;
  the spellcasting editor handles per-source adjustments, freeform ability
  declaration, and fixed DC/attack. Cancel/Escape never mutates; Save writes
  the calc block + flat mirror in one mutation.
- Finish seeding stamps derived blocks under the **adoption-safety rule**
  (stored value empty or equal to the derivation — stamping can never change
  the displayed number); Level Up applies calc-aware policies (derived
  re-derives the mirror, fixed preserved + reported, legacy byte-identical).
- Calc-managed side surfaces: tracker linked cards + combat seeding resolve
  displayed values; linked writes decline; combat AC edits become
  participant-local temporaries; Short/Long Rest heal to the displayed max.

## Findings made during implementation (beyond Phase A)

1. **Defense fighting style was missing from `computeArmorClass`.** The chosen
   subfeature ids (`fighter-fighting-style-defense`, `fighting-style-defense`,
   `ranger-fighting-style-defense`) reached `featureIdSet` but nothing consumed
   them. Added: +1 only on the worn-armor path (SRD: "while you are wearing
   armor"), never on unarmored formulas; a shield alone is not armor.
2. **Dwarven Toughness was prose-only**, so derived max HP would have silently
   under-counted Hill Dwarves by 1/level. Made structural: `racesAdapter.js`
   emits `hpPerLevelBonus: 1` on `hill-dwarf` (mechanic keyed by stable trait
   id, the UNARMORED_AC_FORMULAS precedent; races.json regenerated, one-line
   diff) and `deriveCharacter` stacks race/subrace per-level bonuses with feat
   effects into `computeMaxHp`.
3. **Combat AC edits wrote through to the canonical character**
   (`setCombatParticipantAc` → `writeCardLinkedField`), so "temporary combat
   AC" did not exist for linked characters. For calc-managed characters the
   write is now declined and the participant-local value acts as the temporary
   layer (display prefers it while set; clearing returns to the calculated
   base). Legacy characters keep write-through unchanged.
4. **Rest healed to the flat snapshot.** `applyShortRest`/`applyLongRest` read
   `character.hpMax` directly; with a derived max that flat field is a mirror.
   Both now resolve through `getDisplayedHpMax` (legacy/fixed unchanged).
5. **Panel re-init left dead ✎ buttons.** Edit in Builder re-initializes the
   character page; statically-hosted tile parts survive in the DOM while their
   listeners die with the old instance's AbortController. Calc buttons now
   carry an instance-ownership stamp and are rebuilt by the next instance.
6. **Hiding a dialog that still contains focus loses the restore.** The
   browser fixes focus up to `<body>` on its own schedule when the focused
   subtree is hidden, clobbering a later `requestAnimationFrame` restore. Both
   calculation dialogs move focus back to the opener **before** hiding the
   overlay (plus a one-frame re-assert).
7. **Number-stepper wrappers must hide with their inputs.**
   `enhanceNumberSteppers` wraps every vitals number input in a `.numWrap`
   with buttons; hiding only the input left orphaned steppers. All tile
   show/hide paths go through a wrapper-aware helper, re-asserted after the
   async enhancement pass.

## Verification basis (final tree)

- `npm run typecheck` clean; `npm run test:run` **1219/1219** (72 files; +58
  net this session: 17 spellcasting calculator + 11 spellcasting seeding + 12
  AC calculator + 14 AC seeding/linking/combat + 14 HP calculator + 13 HP
  seeding/Level-Up/linking + 2 Defense-style progression + 2 races-adapter −
  reorganized); `npm run verify` green.
- Dev-mode smoke gate (`npm run test:smoke`): **61/61**, including the new
  three-part `structuredVitals.smoke.js` (builder tiles derive live and update
  automatically after an Edit-in-Builder ability change; AC adjustment + HP
  fixed override through the editors with Escape cancel-safety and reload
  persistence; freeform caster profile declaration; keyboard-only editor
  operation at 380px with no horizontal overflow).
- **Production preview** (`vite preview` over the real `dist/`, via the new
  `playwright.preview.config.js`): **54/61** — every F2-related suite green
  (structuredVitals, characterRest, attackEditor, attackKeyboard,
  builderWizard, levelUp, highElfCantrip, customContent). The 7 failures were
  pre-existing dev-only test harnesses that `import()` source modules into the
  page (backup, panel-lifecycle ×4, one combatShell case, trackerPanelLifecycle)
  — impossible against a bundle; follow-up filed. `characterRest` and
  `structuredVitals` were made production-compatible in this session.
  *(Follow-up closed 2026-07-18: all 7 harnesses reworked onto preview-safe
  seams; the preview gate is now 61/61 — see
  `docs/operations/browser-smoke-status.md` → "Preview-safe harness rules".)*
- Manual production-preview acceptance (real browser over `npm run preview`):
  builder cleric Finish stamps all three blocks; tiles show 13 / +5 / 12
  ("10 + Dex") / 10 ("Calculated from levels"); AC editor Save applies +1
  adjustment (tile 13, provenance "10 + Dex + 1 adj", mirror 13); HP fixed 25
  with `hpCur` 10 untouched; Escape with a typed 99 mutates nothing; full
  reload preserves all three modes; 380px renders with **zero** horizontal
  overflow and visible provenance. Keyboard trap/Escape/focus-return at 380px
  is pinned by the preview-mode smoke (real key events against the same build).

## Intentionally not done

- Freeform AC / max HP derivation (no structured armor / level history) — the
  tiles keep plain manual inputs with no calc affordance, by contract.
- Alternate-formula *selection UI* for rare unarmored ties (best-of is
  deterministic; equipment remains the primary input; fixed/adjustment cover
  intentional deviations).
- A shield/armor quick-toggle on the sheet (equipment stays a guarded build
  choice edited through Edit in Builder; noted as possible future quick-edit).
- Rewriting the 7 dev-only smoke harnesses for preview compatibility
  (follow-up chip filed; completed 2026-07-18).
- F1 (freeform initiative) and the deferred choice/backlog items — unchanged,
  still need owner scope.
