# Session Handoff — 2026-07-15 (Unified Calculation Contract, Live Attacks, High Elf Cantrip)

_Point-in-time snapshot. The binding rules and work order live in
[`AGENTS.md`](../../AGENTS.md); the normative calculation rules live in
[`character-calculation-contract.md`](./character-calculation-contract.md); the
live capability audit is
[`builder-completion-matrix.md`](../audits/builder-completion-matrix.md)._

## What this session did

Owner-authorized run starting from `9f0ea24` (clean, `verify` green,
1106/1106). Corrected the character-calculation architecture so builder-created
and manually entered characters use one rules engine, replaced the
snapshot/on-demand attack model with **live-deriving structured attacks**,
removed the broken "Recalculate from Build" dialog, and implemented the missing
**High Elf wizard-cantrip** choice through a **reusable** choice-based
granted-spell mechanism.

## Commits (oldest first)

| Commit | What |
| --- | --- |
| `334500a` | Docs: the input/derived/adjustment/fixed-override **calculation contract**, the Phase A **calculation-architecture audit** (builder/manual parity matrix, findings F0–F4, choice-completeness report), and the AGENTS.md working-order authorization (step 16). |
| `103406c` | **Batch 1** — `js/domain/attackCalculation.js`: the one canonical attack calculator. Structured `calc` block (weapon/ability/spell/fixed), live derivation of bonus/damage/range/type, explicit adjustments, `isWeaponProficient`, `buildSeededWeaponAttack`. Finish seeding + portability wired to it; `AttackEntry` typedef documents `calc`. 27 unit tests. |
| `f8d91ce` | **Batches 2–3** — attack panel renders structured rows read-only and derives live (character page + combat panel); per-row **Edit dialog** owns structured inputs, adjustments, fixed mode, and safe legacy conversion (explicit weapon pick, never name-matched); the **broken Recalc dialog + `attackRecalculation.js` were removed**; re-seed dedupes by the `weapon:<id>` marker (renamed seeded attacks no longer duplicate). 10 editor tests + marker-dedup regression + browser smoke. |
| `c45359d` | **Batch 4** — reusable choice-based granted spells (`js/domain/rules/spellChoices.js`) + **High Elf wizard cantrip**. Subrace `choices[]` emitted by the adapter (races.json regenerated, minimal diff), origin-step rendering, Finish gating, incomplete-summary, prune fix (subrace choices were being deleted), derive→`grantedSpells` with INT provenance, non-caster seeding. 12 unit tests + 3 referential-integrity tests + browser smoke. |

Plus the final Batch 5 docs commit after `c45359d`.

## Architecture in one paragraph

`js/domain/rules/deriveCharacter.js` is the single rules engine and already
handled both modes; the parity gaps lived in per-panel wiring, not the engine.
Attacks are now an example of the contract done right: `attackCalculation.js`
computes display values from a structured `calc` block plus `deriveCharacter()`
output, and every surface (Finish seeding, the editor, the character-page
Attacks panel, the combat embedded Weapons panel) calls it, so builder and
freeform characters get identical math and values that update automatically. A
`calc` block is an optional extra key on the open `AttackEntry` shape — **no
schema migration**. Choice-based granted spells resolve generically from
race/subrace `choices[]` via `spellChoices.js`, so adding another filtered
spell choice is data-only.

## Verification (final tree)

- `npm run typecheck` — clean (exit 0)
- `npm run test:run` — **1135/1135** (66 files; +29 net this session: +27 attack
  calculator, +10 attack editor, +12 High-Elf/choice, −20 for the removed
  recalc module/dialog tests, +others)
- `npm run verify` — green (typecheck + tests + production build)
- `npm run test:smoke` — **58/58** (dev-production server): incl.
  `attackEditor.smoke.js` (automatic bonus update after a STR change, custom
  name preserved, adjustment persists across reload, manual structured attack,
  fixed mode), `highElfCantrip.smoke.js` (only wizard cantrips shown, Finish
  blocked until chosen, summary INT provenance, spell DC 13, reload),
  `attackKeyboard.smoke.js` (keyboard-only editor + 380px overflow), and
  `builderWizard.smoke.js` (4/4, no regression).
- **Production `npm run preview` build** (the exact config matrix #9 failed
  under): `attackEditor`, `highElfCantrip`, and `attackKeyboard` smokes all
  green at **desktop and 380px** — the editor Apply works in the real built
  `dist/`, no horizontal overflow, focus trap + Escape-returns-focus verified
  with no mutation.

## Contract summary (see the contract doc)

- **Attacks** derive live; explicit adjustments are stored separately; fixed
  mode is the intentional override; legacy rows convert only through the
  editor; provenance is the `weapon:<id>` marker, never the display name.
- **Still snapshot-based (contract deviation F2, deferred):** `ac`, `spellDC`,
  `spellAttack`, `hpMax`. Converting these to derived-plus-adjustment needs its
  own owner-scoped batch (existing sheets store bare totals).

## Known limitations

- AC / spell DC / spell attack / HP max remain snapshot fields (F2).
- Weapon-mode attacks do not offer versatile (two-handed) damage as an
  alternative row; base damage comes from the weapon's one-handed dice.
- High Elf's **Extra Language** trait is still prose-only (not a wired choice).
- Deferred choice work (documented, needs owner scope): Half-Elf +1×2 ability
  choice and Skill Versatility, Tiefling Infernal Legacy cantrip grant,
  structured race-trait fixed proficiencies (F3), Dwarf tool choice.

## Next session start

```bash
git status            # expect clean on builder-wizard
npm run verify        # expect green
```

Recommended next (needs owner scope): **audit F2 — bring AC / HP / spell DC /
spell attack under the calculation contract** (derived-plus-adjustment with a
visible fixed-override affordance and a safe adoption path for existing sheets),
or the smallest deferred choice item, **Half-Elf Skill Versatility**.
