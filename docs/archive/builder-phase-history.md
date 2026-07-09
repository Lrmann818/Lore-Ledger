# Builder Phase History (Schema Notes)

> ## 📜 ARCHIVED — HISTORICAL RECORD ONLY
>
> **Archived 2026-07-09.** These bullets were the phase-by-phase changelog inside
> `docs/state-schema.md`, written while the character builder was still a Dragonborn-only
> vertical slice.
>
> **Do not read them as current behavior or as remaining work.** The builder now ships an
> 8-step wizard across the full SRD 5.1 registry.
>
> ⚠️ **Their schema version numbers are wrong by today's numbering.** They say
> "schema v7 `manualFeatureCards[]`" and "schema v8 `featureUses`". Those were the
> pre-renumber builder-branch numbers. The correct values are **v9** and **v10** — the
> builder migrations were renumbered to v8-v10 during the `develop` merge.
>
> **Canonical replacements:**
>
> - Current persisted shape and version history → [`docs/state-schema.md`](../state-schema.md)
> - Shipped builtin SRD scope → [`docs/reference/builder-scope-greenlist.md`](../reference/builder-scope-greenlist.md)
> - Module boundaries → [`docs/architecture.md`](../architecture.md)
>
> Kept for provenance: it records which slice introduced which field, and the
> non-materialization discipline each phase preserved.

---

## Phase notes (as written, 2026-04 → 2026-05)

- Step 3 Phase 2 added the first `New Builder Character` creation path that writes this build object. The current wizard supports the shipped creation slices through Identity, supported Dragonborn Race Choices, Ability Scores, Summary, and Finish, while broader content-complete class/background/equipment/spell choice flows, generalized seeding, level-up additions, and shared-resource automation remain future work.
- Step 3 Phase 3A did not change the schema. The Builder Summary panel is display-only UI for builder characters. It reads derived class/level, race, background, level, proficiency bonus, and ability totals/modifiers without adding schema fields or persisting derived values back into `classLevel`, `race`, `background`, `proficiency`, abilities, or other flat fields.
- Step 3 Phase 3B also did not change the schema. The Builder Identity panel edits only `build.raceId`, `build.classId`, `build.backgroundId`, and `build.level` for builder characters, using builtin SRD-safe content IDs from the code-shipped registry. Selecting "Not selected" stores `null` for the relevant content ID. It does not persist derived values into flat fields, and it does not add subclass choices, custom content, HP/AC/spell automation, or content-complete builder choice coverage.
- Step 3 Phase 3C also does not change the schema. The Builder Abilities panel edits only manual base scores in `build.abilities.base` for builder characters. Those values feed builder-derived sheet values such as Abilities/Skills totals, Vitals DCs, derived feature cards, and Builder Summary review output, while remaining separate from the flat/freeform `abilities.*.score`, `abilities.*.mod`, and `abilities.*.save` fields.
- Step 3 Phase 3D also does not change the schema. Builder characters with valid derived abilities may display `deriveCharacter(character).abilities.*.total` and `.modifier` in the normal Abilities/Skills panel, while those values remain unpersisted and are not copied into flat/freeform ability fields.
- Step 3 Phase 3E also does not change the schema. For builder characters with a valid `build.abilities.base` shape, ability adjustments made through the existing Abilities & Skills controls write deltas to `overrides.abilities.*`, which `deriveCharacter(...)` adds to the builder base scores. Reset adjustments are neutralized as `0` through the existing override normalization shape. The flat/freeform `abilities.*.score`, `abilities.*.mod`, and `abilities.*.save` fields remain separate and are not used as storage for builder-derived totals.
- Step 3 Phase 3F also does not change the schema. Builder characters display `deriveCharacter(character).labels.classLevel`, `.race`, and `.background` in the normal Basics panel for `charClassLevel`, `charRace`, and `charBackground`; those three Basics fields are display-only for builder characters and still do not write derived labels back into `classLevel`, `race`, or `background`. Builder Identity remains temporary scaffolding for editing the underlying `build.*` identity inputs. HP, AC, proficiency, broader saves/skills, spells, attacks, custom content, schema migration, and materialization remain future work.
- Step 3 Phase 3G also does not change the schema. Builder characters display `deriveCharacter(character).proficiencyBonus` in the normal Vitals proficiency field as builder-owned/read-only UI, and Abilities/Skills uses that same derived proficiency scalar for builder characters only in its existing save/skill formulas. Freeform characters still edit and persist flat `proficiency` exactly as before. Save/skill automation, HP/AC automation, spell/combat automation, schema migration, and derived-field materialization remain future work.
- Step 3 Phase 3H in the older builder-integration checklist did not change the schema. Builder characters display `deriveCharacter(character).vitals.speed`, `.hitDieAmt`, and `.hitDieSize` in the normal and embedded Vitals speed and hit-dice fields as builder-owned/read-only UI. These values come from selected builtin race `data.speed`, selected builtin class `data.hitDie`, and normalized builder level. Freeform characters still edit and persist flat `speed`, `hitDieAmt`, and `hitDieSize` exactly as before. Malformed or incomplete builder content displays blank read-only values with derivation warnings instead of falling back to stale flat fields. HP/AC automation, combat/card linking changes, new overrides, and derived-field materialization remain future work.
- Abilities & Features Phase 3F added schema v7 `manualFeatureCards[]` for character-owned manual/custom cards.
- Abilities & Features Phase 3G extends manual/custom cards with an optional nested `limitedUse` object for feature-specific counters only; broad shared resource pools remain `resources[]` / Vitals work.
- Abilities & Features Phase 3H added schema v8 `featureUses` for character-owned mutable use state on derived feature-specific counters. The first shipped entry is `featureUses["dragonborn-breath-weapon"].current`; max uses, recovery, label, DC, area, damage, damage type, ancestry, feature text, and generated SRD data remain derived from build/rules data.
- Phase 3I did not change the schema version or add new fields. Dragonborn wizard Finish seeds existing editable text fields only: selected Draconic Ancestry and Damage Resistance text into `features`, and fixed Common/Draconic language text into `languages`. Seeded text becomes user-owned sheet content after creation and is not silently synchronized with registry/rules text. Breath Weapon remains live-derived in Vitals and Abilities & Features and is not copied into `features`, `manualFeatureCards[]`, `resources[]`, or a new top-level field.
