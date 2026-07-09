# Character Builder Handoff

> **📸 Session snapshot — orientation, not specification.**
>
> Written 2026-07-07 at the end of one session. It was accurate then. Verification
> numbers, commit hashes, and file counts in this doc **decay**: check them against the
> code before relying on them.
>
> Use it to learn **how the builder fits together**. Do not use it as the authority on
> scope, schema, or policy — for those, `AGENTS.md`,
> `docs/reference/builder-scope-greenlist.md`, `docs/reference/content-registry-plan.md`,
> and `docs/state-schema.md` win.

_Written 2026-07-07, at the end of the session that implemented the SRD 5.1
builder end-to-end (commits `6568dfe..8173285` on `builder-wizard`)._

This is the orientation document for the next coding agent working on the
builder. Read `AGENTS.md` first (it wins on conflicts), then
`docs/reference/builder-scope-greenlist.md` and
`docs/reference/content-registry-plan.md` for policy/schema, then this file
for how the implementation actually fits together.

Verification state at handoff: `npm run verify` green (CheckJS clean,
812 vitest tests in 53 files, production build), `npm run test:smoke`
green (46 Playwright tests). Schema is v11.

---

## 1. Content registry architecture

**Build time (never shipped):** `scripts/fetch-srd-data.js` orchestrates
adapters in `scripts/adapters/` (one per category, shared helpers in
`apiUtil.js`). They fetch from `dnd5eapi.co/api/2014`, normalize, and write
`game-data/srd/*.json`. The JSON files are committed and bundled; the app
makes **no runtime network calls**. To change shipped SRD content, edit the
adapter and re-run `node scripts/fetch-srd-data.js <adapter>|all` — never
hand-edit the JSON (it will be overwritten).

**Runtime, three layers in `js/domain/rules/`:**

1. `builtinContent.js` — imports all 14 JSON files and wraps each record as
   `{ id, kind, name, source, ruleset: "srd-5.1", data }` where `data` is
   the whole raw record. Exports `BUILTIN_CONTENT` and the closed
   `CONTENT_KINDS` set (race, subrace, class, subclass, background, feat,
   trait, ancestry, armor, weapon, spell, language, skill, feature).
2. `registry.js` — `createContentRegistry(entries)` builds
   `{ entries, byId, byKindId, byKind }`. **IDs are unique per kind, not
   globally** — four cross-kind collisions exist in SRD data (`shield`
   armor/spell, `darkvision` trait/spell, `draconic` subclass/language,
   `halfling` race/language). Therefore `getContentByKind(registry, kind,
   id)` is the canonical lookup; `getContentById` is legacy and only safe
   where the id space cannot collide.
3. **Active registry with custom content:** `app.js` calls
   `bindCustomContentProvider(() => appState.content?.custom)` once at
   composition. `getActiveContentRegistry()` re-reads the provider on every
   call and rebuilds the merged registry **only when the array identity
   changes**. Custom records are validated by `normalizeCustomContent()`:
   invalid shapes, records shadowing a builtin `kind:id`, and duplicate
   customs are skipped (with reasons). Custom entries get `source:
   "custom"` forced.

`deriveCharacter(character, registry = getActiveContentRegistry())` — the
default parameter is evaluated per call, so campaign switches and imports
pick up custom content automatically.

Custom (homebrew) records use the same normalized shapes as the SRD files.
Future licensed packs are the same mechanism with a different `source`
value — nothing is hardcoded to SRD-only.

## 2. Character build schema (v2) and multiclassing

`character.build === null` → freeform character; non-null → builder
character. **Never collapse the two modes.** The v2 shape (typedef in
`js/state.js`, defaults in `makeDefaultCharacterBuild()` in
`js/domain/characterHelpers.js`):

```js
build = {
  version: 2,
  ruleset: "srd-5.1",
  raceId: "dragonborn" | null,
  subraceId: "high-elf" | null,
  backgroundId: "acolyte" | null,
  abilities: { method: "manual"|"standard-array"|"point-buy"|"roll",
               base: { str: 15, ... } },          // base scores only; totals derived
  levels: [ { classId: "fighter", hp: null }, ... ], // entry i = character level i+1
  subclassByClass: { fighter: "champion" },       // one subclass per class
  choicesByLevel: { "1": { "<choiceId>": value }, "4": { ... } },
  spellcasting: { cleric: { cantripIds: [], knownIds: [], preparedIds: [] } },
  equipment: { armorId, shield: bool, weaponIds: [], startingChoices: {}, notes: "" }
}
```

- `levels[]` is **ordered, one entry per character level**; `hp` is the
  recorded roll for that level (`null` = SRD average; level 1 always uses
  the max hit die of its class regardless of `hp`).
- Choice values: option id string, array of ids for count > 1, or the two
  structured shapes — `asi-<characterLevel>` stores
  `{ type: "asi", increases: {str: 1, ...} }` or
  `{ type: "feat", featId }`; `feature-<featureId>` stores chosen
  subfeature/skill id(s). Class skill picks use `class-skill-<classId>`
  (first class) and `multiclass-skill-<classId>` (later classes). Id
  helpers live in `progression.js`.
- **Migration:** legacy v1 builds (`classId` + `level`, prefixed ids like
  `class_fighter`) normalize through `normalizeCharacterBuild()` in
  `characterHelpers.js` — the *single* v1→v2 point, invoked by
  `migrateToV11()` in `js/state.js`. Derivation additionally tolerates
  un-migrated legacy ids via `getContentByFlexibleId` (strips `class_` etc.
  at lookup). Do not remove either compatibility path.

Multiclass rules implemented: per-class level totals, PB from total level,
saves from the **first** class only, multiclass proficiency subsets from
`class.multiclassing`, ASI slots at each class's own `asiLevels`, subclass
at each class's `subclassLevel`, combined spell slots (below), and
prerequisite *warnings* (guided, never blocking).

## 3. Rules derivation pipeline

All pure functions, no state/DOM:

```
build ──normalizeBuildLevels──► levels[]
      ──flattenChoices────────► flatChoices
                 │
                 ▼
js/domain/rules/progression.js       js/domain/rules/deriveCharacter.js
  getClassLevelTotals / getTotalLevel   deriveCharacter(character, registry)
  getClassBlocks / setClassBlocks         → the panel contract object
  getSavingThrowProficiencies
  getAsiSlots / collectAsiChoices
  getBuildFeatures (class+subclass)
  computeMaxHp / getHitDicePools
  computeArmorClass
  getSpellcastingClasses
  getCombinedSpellSlots (single/multi/pact)
  getGrantedSpells (domain spells)
  checkMulticlassPrerequisites
  collectFeatEffects (custom feat vocabulary)
```

`deriveCharacter()` returns one object consumed live by the character
panels (`vitalsPanel`, `abilitiesPanel`, `basicsPanel`,
`builderSummaryPanel`) and the wizard. Pre-existing fields (`labels`,
`level`, `proficiencyBonus`, `vitals.{speed,hitDieAmt,hitDieSize}`,
`abilities`, `saves`, `skills`, `initiative`, `dragonbornAncestry`,
`derivedFeatureActions`, `warnings`) are a **stable contract** — extend,
don't reshape. Multiclass-era additions: `classLevels`, `totalLevel`, `hp`,
`hitDice`, `ac`, `speed`, `spellcasting` (per-class DC/attack/known/
prepared + combined `slots` + `pact`), `features`, `proficiencies`,
`featIds`, `grantedSpells`, `passivePerception`.

Spell slots: exactly one slot-progression class → its own class table
(half casters correctly get nothing at level 1); two or more → SRD
multiclass table (`MULTICLASS_SPELL_SLOTS`) at caster level = full levels +
`floor(half/2)`; warlock pact magic is always tracked separately.

Rules that are intentionally code-not-data (documented in the registry
plan): `SPELLCASTING_META` in `classesAdapter.js` (prepared/known/spellbook
+ progression per class), `UNARMORED_AC_FORMULAS` (barbarian/monk/draconic
resilience — **optional**: plain 10+Dex+shield competes and wins if
higher), `EXPERTISE_FEATURE_IDS`, and the multiclass slot table.

Overrides model: `character.overrides` holds additive bonuses
(abilities/saves/skills/initiative). For HP max, AC, spell DC/attack and
similar, the **sheet fields themselves are the override** — they are
user-owned; the builder only fills them when empty (see §4). Manual skill
toggles on the sheet merge with derived proficiency (highest level wins).

## 4. Finish/seeding and data preservation

`getBuilderFinishSheetSeedPatch(character)` in
`js/domain/builderSheetSeeding.js` returns a **patch object**; the caller
(`characterPage.js` onFinish) `Object.assign`s it onto the entry inside a
state mutation. Guarantees, enforced by tests:

- **Text fields** (`features`, `languages`, `armorProf`, `weaponProf`,
  `toolProf`): duplicate-aware line/label append only; existing text always
  stays at the front. The Dragonborn lines keep their exact Phase 3I
  format.
- **Numeric vitals** (`hpMax`/`hpCur`, `ac`, `spellDC`, `spellAttack`):
  filled **only when currently empty** — a user-entered value is never
  replaced.
- **Attacks**: appended only if no existing attack has the same name
  (case-insensitive).
- **Spells**: merges into the existing `character.spells.levels` model by
  level label; slot `total` set only when null, `used` (remaining) is never
  touched, existing spell entries keep their `prepared`/`expended` flags;
  missing spells appended by name. Pact magic gets its own
  `Pact Magic (…)` level row.
- **Inventory**: a `Starting Gear` tab is created/appended
  (duplicate-aware); other tabs untouched.

Edit mode: `builderWizard.open({ character })` deep-clones and normalizes
the build; on Finish the handler in `characterPage.js` writes `name` +
`build` and re-runs the seed patch on the *same entry* — notes, inventory,
spell usage, combat state, death saves, manual cards, portraits, and every
other field are untouched. Re-seeding is idempotent by construction.

## 5. Custom content import/export

- **Domain:** `js/domain/customContent.js` —
  `validateCustomContentRecord`, `addCustomContentRecords` (replaces
  `state.content.custom` **immutably** — required, see traps),
  `removeCustomContentRecord`, `listCustomContent`, `ensureCustomContent`.
- **UI:** Data panel (`js/ui/dataPanel.js`, markup in `index.html` under
  the "Custom Content" section): Import (JSON file — array, single record,
  or `{ custom: [...] }`), Export (`lore-ledger-custom-content.json`
  download), List/Remove (prompt-based `kind:id` removal). Summary line
  shows the record count.
- **Persistence:** the bucket rides `sanitizeForSave()` (`js/state.js`),
  `migrateToV11()` defaults it, and backup validate/apply in
  `js/storage/backup.js` (`validateIncomingStateShape` +
  `replaceStateBuckets`) round-trips it; pre-v11 backups restore with an
  empty list.

## 6. Most important tests after changes

Full gate before any merge: `npm run verify` (typecheck + `test:run` +
build). Targeted, by area touched:

| Area | Test files |
| --- | --- |
| Rules/derivation | `tests/progressionRules.test.js`, `tests/rulesEngine.test.js` |
| SRD data / adapters | `tests/data/srdDatasets.test.js`, `tests/data/referential-integrity.test.js` (rerun after any adapter re-run) |
| Custom content / migration | `tests/customContent.test.js`, `tests/state.migrate.test.js`, `tests/state.migrate.fixtures.test.js`, `tests/saveCompatibility.test.js` |
| Seeding / finish | `tests/builderSheetSeeding.test.js` |
| Wizard + panels | `tests/characterPage.test.js`, `tests/characterPanels.activeCharacter.test.js` |
| Persistence/backup | `tests/storage.backup.test.js`, `tests/state.sanitize.test.js` |

For any wizard/panel/navigation change also run
`npx playwright test tests/smoke/builderWizard.smoke.js`, and the full
`npm run test:smoke` before calling the work done. After a build, confirm
the PWA precache report stays under Workbox's 2 MB per-file limit (the SRD
data is a separate `srd-data` chunk via `vite.config.js` `manualChunks`).

## 7. Top 5 safest next fixes (value ÷ risk, best first)

1. **Seed full feature descriptions.** `builderSheetSeeding.js` seeds
   feature *names* only; `features.json` already has full `desc` text.
   Single-module change, duplicate-aware line logic already exists.
2. **Emit trait-embedded choices from `racesAdapter.js`** (High Elf bonus
   cantrip, Dwarf tool proficiency). The `cantrip` choice kind is already
   in the closed vocabulary and the origin-choices step renders generic
   choices; mostly adapter + data regeneration + referential-test update.
3. **Structured subclass proficiency grants.** Life domain's heavy armor is
   prose-only today. Add `grantedProficiencies` to `subclassesAdapter.js`
   output and merge in `deriveCharacter`'s proficiency block. Small,
   additive, easy to anchor-test.
4. **Derived class resource counters** (Rage, Ki, Sorcery Points) from
   `classSpecificByLevel`, following the existing Dragonborn Breath Weapon
   `featureUses` pattern (`docs/reference/content-registry-plan.md`
   describes the canonical-counter rules). Well-worn path, but touches
   `abilitiesFeaturesPanel` — keep counters character-owned.
5. **Spells-step polish:** prepared/known over-limit warnings (counts are
   already computed), spell detail popovers from bundled `desc`. UI-only.

High value but *not* low risk (do after the above): a guided level-up flow
from the sheet. (Exact multiclass level order in the wizard is done — see
§9; a drag-to-reorder affordance for existing levels is the only remaining
polish there.)

## 8. Traps — do not casually rewrite

- **`game-data/srd/*.json` are generated.** Never hand-edit; change the
  adapter and re-run. (AGENTS.md rule.)
- **Custom content array identity is the cache key.** The active registry
  rebuilds when `state.content.custom` is a *new array*. Any mutation must
  replace the array (as `customContent.js` does) — an in-place `push` will
  silently not refresh the registry.
- **`deriveCharacter`'s return shape is a panel contract.** Vitals,
  abilities, basics, builder summary, and combat-embedded panels read it
  live. Extend it; never rename/reshape existing fields.
- **`normalizeCharacterBuild()` is the only v1→v2 migration point** and
  migrations are append-only. Don't add a second normalization path.
- **`builderWizard.js` ability-method machinery** (manual/standard
  array/point buy/roll, ~700 lines) is preserved, heavily test-pinned
  code. The dynamic steps live in `builderWizardSteps.js`; keep that split.
- **Test DOM is not jsdom.** `characterPage.test.js` uses a FakeElement
  harness without `replaceChildren` — use the `clearChildren()` helper in
  `builderWizardSteps.js` for container clearing, `innerHTML = ""`
  otherwise.
- **Use `getContentByKind`, not `getContentById`,** for anything that could
  collide across kinds (spells vs armor vs traits vs languages).
- **`sanitizeForSave()` whitelists buckets.** A new persisted field is not
  saved just because it's on `state` — wire sanitize + migration + tests.
- **Stable DOM ids are load-bearing:** `#builderWizardDraconicAncestry` is
  created dynamically but must keep that id (smoke + unit tests);
  `#builderWizardOverlay/Panel/Next/Back/Finish` and the step section ids
  are pinned by tests.
- **Legacy prefixed ids** (`class_fighter`, `race_human`) must keep
  resolving via the flexible lookup — old fixtures and pre-renumber saves
  depend on it.
- **Choice ids are semantic** (`asi-<characterLevel>`,
  `feature-<featureId>`, `class-skill-<classId>`), and
  `pruneStaleChoices`/`collectActiveChoiceIds` delete anything not
  currently active — if you add a new choice family, register it in
  `collectActiveChoiceIds` or it will be pruned on the next wizard sync.

## 9. Multiclass level order (FIXED 2026-07-07)

**Both the data model and the editing UI now preserve exact level order.**
The earlier contiguous-class-blocks editor that collapsed interleaved order
has been replaced; this section documents the current behavior.

`build.levels[]` is an ordered array — `Fighter 1 → Wizard 1 → Fighter 2`
is representable exactly as:

```json
[ { "classId": "fighter", "hp": null },
  { "classId": "wizard",  "hp": null },
  { "classId": "fighter", "hp": 7 } ]
```

Derivation is fully order-faithful: `getClassLevelAtEachCharacterLevel`,
`getAsiSlots`, `getBuildFeatures`, and `computeMaxHp` walk the array in
order, so feature/ASI *character-level* timing and the per-level HP
breakdown (which die, and which recorded roll, at which character level)
respect interleaving. Migration (`normalizeCharacterBuild`) preserves the
array verbatim.

**Editing now goes through ordered level operations** in
`js/domain/rules/progression.js`, which mutate `build.levels[]` in place and
never reorder:

- `materializeLevels(build)` — resolves the array (expands any legacy
  `classId`+`level` fallback, clears the legacy scalars) for in-place edits.
- `appendLevel`, `setLevelClassAt`, `setLevelHpAt`, `removeLevelAt` — the
  primitive ordered edits. Each mutates exactly one position (or appends).
- `setSingleClassId`, `setSingleClassTotalLevel` — single-class conveniences
  for the sheet-side panel (order is trivial for one class).
- `pruneOrphanedClassData` — drops subclass/spell selections for classes no
  longer present, after any level edit.

Where they're used:

- **Wizard "Classes & Levels" step** (`renderClassesStep` in
  `builderWizardSteps.js`) is a per-character-level editor: one row per
  entry of `build.levels[]`, in order, each with a class picker, an HP input
  (level 2+), and a remove button (level 2+), plus an "add next level"
  control and per-distinct-class subclass selects. HP edits attach to that
  exact character-level index and never re-render (focus stays put).
- **Identity "Starting Class"** edits `levels[0]` only (via
  `setLevelClassAt(build, 0, …)` / `appendLevel`); `onDraftChanged` keeps the
  Identity select display in step with `levels[0]` so navigation can't read a
  stale value and revert level 1.
- **Sheet-side Builder Identity panel** (`builderIdentityPanel.js`) is a
  single-class editor: for multiclass builds it **disables** the class/level
  controls and shows `#charBuilderMulticlassHint` ("edit in the builder"),
  so it can't collapse interleaving. Race/subrace/background stay editable.

What concretely happens now with `[fighter, wizard, fighter]`:

- Open in edit mode and Finish with no changes → array unchanged.
- Edit the level-3 HP → `levels[2].hp` updates; order and the Wizard's
  level-2 HP are untouched (the roll stays on the d10 Fighter level, not the
  d6 Wizard level).
- Add a level → appended at the end (defaults to the most recent class);
  the interleaved history ahead of it is untouched.
- ASI/feat choice ids (`asi-<characterLevel>`) stay valid because character
  levels don't shift; `pruneStaleChoices` keeps them.

`setClassBlocks` is retained only for backward compatibility and is marked
DEPRECATED for editing — do **not** reintroduce it into any edit path
(it rewrites contiguously and collapses order). `getClassBlocks` is still
fine for read-only grouping (e.g. multiclass detection).

Regression coverage: `tests/progressionRules.test.js` ("ordered level
operations preserve exact multiclass order") for the domain ops, and
`tests/characterPage.test.js` ("builder wizard preserves interleaved
multiclass level order") for the wizard edit-mode flows (open+finish, HP
edit, add level, ASI-id preservation). The smoke test exercises the new
per-level Classes step.

Remaining polish (not a correctness gap): the wizard has no drag-to-reorder
for existing levels — you change order by editing each row's class or
removing/re-adding. Adding a level always appends at the end.
