# Rest Rules — Short Rest and Long Rest

_Status: **canonical expectations**. Written 2026-07-09._

This document is the reference for what Short Rest and Long Rest are expected to do in
Lore Ledger, under SRD 5.1. It is the authority when rest behavior is implemented or
changed.

Read with [`AGENTS.md`](../../AGENTS.md) (wins on conflict) and
[`builder-scope-greenlist.md`](./builder-scope-greenlist.md).

> **Implementation status.** `js/domain/characterRest.js` now applies modeled resource
> recovery, spell slots, HP, Hit Dice, and death saves. Builder prepared casters use the
> Long Rest flow; freeform prepared flags remain manual/DM-managed. This document still
> defines the behavior and boundaries for any future rest change.
>
> **Prepared Correctness C1 (2026-07-27).** §4's prepared-spell rules are implemented as
> written. Before C1 three of them were not: the selection heading rendered `0 / capacity`
> regardless of the real selection, every count was hidden until the player chose "Yes",
> and granted/always-prepared spells were offered as ordinary picks that consumed
> preparation capacity. `js/domain/rules/preparedSpells.js` now owns the whole prepared
> model — see §4.1.
>
> **Prepared Sheet Synchronization C1.1 (2026-07-28).** The sheet's spell-row `prepared`
> flag now follows `rest.preparedByClass` in both directions for actively recommitted
> classes, and the Long Rest commit seeds **spells only** — see §4.3.
>
> **Creation Prepared Correctness C2-A (2026-07-28).** Character creation consumes the same
> `getPreparedSpellPlan()` as Long Rest instead of deriving its own candidates and capacity,
> enforces `effectiveCapacity`, and validates the draft before a character can exist — see
> §4.4.
>
> **Prepared Underfill and Summary C2-B (2026-07-28).** Creation Finish and every Long Rest
> prepared path now confirm an underfilled resulting list inline; creation Summary includes a
> neutral prepared-count review block and direct return path; live prepared counts announce
> politely — see §4.5.
>
> **Level Up Prepared Capacity C2-C (2026-07-29).** Level Up no longer computes prepared
> capacity from build abilities. It reads the shared plan on both sides of the pending level,
> so the number it displays is the one a Long Rest will enforce — see §4.6.
>
> **Granted-Spell Presentation C2-D (2026-07-30).** The Spells panel stops offering the
> manual/DM `Prepared` override on every `builderGranted` row and marks it with a visible
> capacity explanation, on both the Character and Combat surfaces. The wording follows the
> grant's kind, live-derived from the registry: granted leveled spells read `Always
> Prepared`, granted cantrips read `Granted Cantrip`, and an unresolvable record falls back
> to `Granted Spell` — see §4.7.

---

## 1. Rest applies to the active character only

Rest actions operate on the active character resolved through `getActiveCharacter(state)`.
Rest must behave correctly for **both** builder characters (`build !== null`) and freeform
characters (`build: null`), and must be safe across character switching.

Rest must never erase user-owned content: notes, inventory, spell notes, known spells,
spellbook entries, build choices, or manual overrides.

---

## 2. Short Rest

A short rest is at least 1 hour of light activity.

Expected effects:

- The character may spend **one or more available Hit Dice** to regain HP.
- Spending a Hit Die rolls that die and adds the character's **Constitution modifier** to
  the healing from that die.
- The character **cannot spend more Hit Dice than are currently available**.
- Healing is capped at the character's maximum HP.
- Spending Hit Dice **reduces** the available Hit Dice pool.
- When multiclassed, available Hit Dice are shown **per class / per die size**, and the
  user chooses which dice to spend.
- Short Rest resets resources and features explicitly tagged as recovering on a short rest.
- Warlock **Pact Magic** slots recover on a short rest.

Short Rest explicitly does **not**:

- restore HP automatically without spending Hit Dice
- restore ordinary (non-pact) spell slots
- restore long-rest-only resources

**Edge case to decide explicitly, not silently:** a negative Constitution modifier can make
a die's healing zero or negative. Clamp per-die healing at a minimum of `0`. The SRD does
not spell this out; this is Lore Ledger's product decision.

---

## 3. Long Rest

A long rest is at least 8 hours.

Expected effects:

- The character regains **all lost HP**.
- The character regains **spent Hit Dice up to half the character's total Hit Dice**
  (minimum of one die). This is _half the total_, not "reset to full", and not
  "half of character level" as some older notes claimed.
- Spell slot usage resets.
- Pact Magic slots reset (they also reset on a short rest).
- Resources and features tagged as recovering on a long rest reset.
- Resources tagged as recovering on _any_ rest reset, where that distinction is modeled.
- Death save state resets, if death saves are tracked.

Long Rest constraints:

- The character must have **at least 1 HP** at the start of the long rest to gain its
  benefits.
- A character normally cannot benefit from **more than one long rest in a 24-hour
  period**, but that limit is table/DM-enforced in Lore Ledger. The app does **not**
  persist a rest timestamp or block a Long Rest from a wall-clock check.

---

## 4. Prepared spells and rest

Prepared casters are **not** the same as known-spell casters, and the two must not be
collapsed.

> **Prepared spell selections normally change when finishing a Long Rest — not freely at
> any time.** Known spells normally change at Level Up — not at rest.

| Class | Spell model | Where the choice changes |
| --- | --- | --- |
| Cleric | Prepared | Long Rest prepared-spell flow |
| Druid | Prepared | Long Rest prepared-spell flow |
| Paladin | Prepared half-caster | Long Rest prepared-spell flow |
| Wizard | Spellbook + prepared | Prepared: Long Rest. Spellbook additions: Level Up / copying spells |
| Bard | Known | Level Up |
| Ranger | Known (in SRD 5.1) | Level Up |
| Sorcerer | Known | Level Up |
| Warlock | Known + Pact Magic | Level Up. Pact slots recover on short/long rest |

### Long Rest prepared-spell flow

When the user takes a Long Rest on a character with prepared spellcasting (Cleric, Druid,
Paladin, Wizard), prompt: _"Would you like to change your prepared spells?"_

- **No** — apply the Long Rest normally and preserve current prepared selections.
- **Yes** — open a prepared-spell selection step, then apply the prepared changes and the
  rest effects **together**.

Rules for the selection step:

- Show current prepared count and maximum prepared capacity.
- Allow deselect/select up to capacity.
- **Wizards** prepare from their **spellbook**, not the full wizard class list.
- **Clerics, Druids, Paladins** prepare from the class spell list, plus any
  always-prepared domain/oath/subclass spells.
- Always-prepared / granted spells display as granted and do **not** count against the
  prepared limit unless SRD data says otherwise.
- Handle each prepared caster class separately when multiclassed.
- Prepared changes must not erase spell notes, known spells, spellbook entries, or
  descriptions.

Known-spell casters (Bard, Ranger, Sorcerer, Warlock) do **not** get this flow.

If direct prepared-spell editing exists in the Spells panel, it should either route
through this same flow or clearly present itself as a manual/DM override.

### 4.1 The prepared-spell plan (Prepared Correctness C1, 2026-07-27)

`js/domain/rules/preparedSpells.js` is the **single owner** of every prepared-spell rule.
`getPreparedSpellPlan(character, registry)` is pure and registry-injected;
`getBuilderPreparedSpellOptions()` is its registry-bound accessor and
`validateBuilderPreparedSpellSelections()` its commit guard. No UI module may reproduce a
capacity, class-list, spellbook, grant-exclusion, or multiclass spell-level formula.

Per prepared caster the plan reports `classId`, `className`, `preparationMode`,
`formulaCapacity`, `ordinaryCandidateIds`, `grantedIds`, `selectedIds`,
`effectiveCapacity`, `limitedBy`, and `maxSpellLevel`.

**Two capacities, never collapsed:**

- `formulaCapacity` — the rules entitlement (class level, or half class level for a half
  caster, plus the spellcasting ability modifier, minimum 1). It stays `null` when the
  ability modifier is unknown. **`null` means unknown and is never coerced to `0`.**
- `effectiveCapacity` — `min(formulaCapacity, ordinaryCandidateIds.length)`, i.e. how many
  ordinary spells the character can actually hold prepared today, or `null` when the
  formula is unknown.
- `limitedBy` — `"formula"` (the normal case), `"candidates"` (fewer eligible spells exist
  than the formula allows — an under-filled wizard spellbook, or a class with no spell
  list), or `"unknown"`. The Long Rest dialog uses it to explain an unreachable target in
  plain language instead of silently displaying one.

**Candidate rules:**

- Granted / always-prepared spells are excluded from `ordinaryCandidateIds` and from
  `selectedIds`, are reported separately as `grantedIds`, and never consume capacity.
- Wizards (and any custom `spellbook` class) draw candidates from their spellbook;
  Cleric, Druid, and Paladin draw from their class spell list. Custom spells participate
  through the same `classIds` membership as builtin ones.
- **Multiclass:** each caster's `maxSpellLevel` comes from *its own* class slot table at
  *its own* class level, as if it were single-classed. Combined multiclass slots let a
  character cast a lower-level spell with a higher slot; they never unlock higher-level
  candidates for a class whose own table has not reached that level.
- Unresolvable spell ids, a missing slot table, a malformed build, and a deleted custom
  class all fail soft: they yield fewer candidates or no plan entry, never a false prompt
  and never a destructive cleanup.

### 4.2 Prepared commit semantics

Prepared updates **merge** into the normalized `rest.preparedByClass` map. The Long Rest
dialog submits only the classes whose ordinary selection actually changed (order is not
meaningful, so unchecking and rechecking the same spell is not a change).

- Choosing "No" submits nothing; the stored map is preserved verbatim.
- Choosing "Yes" without editing submits nothing and does not rewrite prepared state.
- Untouched classes — including a class whose content is temporarily unresolvable, and
  classes holding legacy or redundant ids — are carried through verbatim.
- A class actively recommitted stores only valid ordinary prepared ids; clearing a class
  drops its key rather than storing an empty array.
- There is **no load-time cleanup, no migration, and no silent mutation.**

Granted spells reach the sheet through `derived.grantedSpells` in
`getBuilderFinishSheetSeedPatch()`, not through `rest.preparedByClass`, so a granted spell
stays always-prepared on the sheet regardless of what the prepared list contains.

### 4.3 Prepared Sheet Synchronization (C1.1, 2026-07-28)

`rest.preparedByClass` is authoritative; the sheet spell row's `prepared` boolean is a
**projection** of it. Before C1.1 that projection was write-only: seeding was additive, so a
deselected ordinary spell simply stopped appearing in the seed set and its row kept
`prepared: true` on both the Character and Combat Spells surfaces, and on disk. (The defect
predates C1 — C1 only made deselection a routine, correctly-guided action. Wizards were
accidentally exempt, because every spellbook entry is re-seeded at `prepared: false`.)

`getLongRestPreparedSheetPatch(character, preparedClassIds, registry?)` in
`js/domain/builderSheetSeeding.js` closes it, called from the Long Rest mutation in
`characterPage.js` with the classes the dialog actually submitted. It reads only
`getPreparedSpellPlan()`, so no second source of prepared rules exists.

Projection contract:

- Eligible rows are the **ordinary candidates of the actively recommitted classes** only. A
  manual `Prepared` override on a class the player did not touch survives untouched.
- A row is prepared when **any** prepared caster currently prepares that spell, so a spell
  shared by two classes stays prepared while either still holds it.
- Granted rows (`builderGranted`) and manual rows (no `builderSpellId`) are never eligible.
- Only the `prepared` boolean is written. Row ids, names, notes, known/spellbook status,
  expended state, and markers are byte-identical. **No row is created or deleted by the
  sync** (the additive pass still adds a row for a newly prepared spell).
- A class with no resolvable plan entry — deleted custom content, no longer a prepared
  caster — contributes nothing and fails soft.
- **No load-time repair, no migration, no new persisted field.** Rows left stale by a
  pre-C1.1 build self-correct the next time that class is actively recommitted; they never
  self-correct on render, and nothing rewrites saved spell arrays in bulk.

**Long Rest seeding is spells-only.** The rest commit previously ran the entire
`getBuilderFinishSheetSeedPatch()`, so a prepared change could silently restore features,
languages, proficiencies, attacks, inventory pockets, resources, or vitals the player had
edited or deleted. It now returns `{ spells }` and nothing else. Creation Finish, Edit in
Builder, Complete Choices, and Level Up keep full seeding unchanged.

### 4.4 Creation consumes the same plan (C2-A, 2026-07-28)

Prepared selection begins at character creation, so the creation wizard is bound by the same
rules as Long Rest. Before C2-A it derived its own: it filtered the whole class spell list
without excluding grants, took its spell-level ceiling from the **combined multiclass slot
array**, displayed `formulaCapacity` rather than `effectiveCapacity`, and enforced no upper
limit at all. A creation-time list could therefore contain a granted spell, a spell above the
class's own table level, or more spells than the class can hold — and
`adoptInitialBuilderPreparedSelections()` copied it into `rest.preparedByClass` verbatim.

`renderSpellsStep()` in `js/pages/character/builderWizardSteps.js` now reads
`getPreparedSpellPlan()` through `getDraftPreparedSpellPlan(build, registry)`, a
**non-persisted** character-shaped view of the wizard draft (`{ build, overrides: null }`).
The view deliberately carries no `rest`, so the plan falls back to each class's
`build.spellcasting[classId].preparedIds` and reports the draft's own in-progress selection
as `selectedIds`. It adds no canonical state, no saved field, and no second prepared store.

Per prepared caster the creation picker takes:

- ordinary candidates from `ordinaryCandidateIds` (grants already excluded, spellbook already
  applied, the class's **own** table ceiling already applied),
- granted spells from `grantedIds` — read-only display, never a checkbox, never counted,
- the displayed count from `effectiveCapacity`, and the limitation wording from `limitedBy`
  with the same plain-language meaning §4.1 established for the Long Rest dialog.

No combined-slot or class-list traversal remains in the UI for prepared groups. Cantrip,
known-spell, and spellbook groups are untouched and keep their existing class-list behavior
byte-for-byte, including their permissive over-cap handling (out of C2-A scope; see the
R5-B2 note below).

**Enforcement.** Selection is hard-blocked at `effectiveCapacity`: at the cap, unchosen
candidates are disabled while chosen ones stay deselectable, so the player is never trapped
at a full list. An unknown capacity (`limitedBy: "unknown"`) disables the picker entirely
rather than guessing a limit, and never renders as `0`. Because a wizard's spellbook *is* its
prepared candidate set, changing the spellbook recomputes the plan and rebuilds the prepared
group in place — leaving focus on the spellbook control the player is using.

**Defensive pre-Finish validation.** `getDraftPreparedValidationMessage(build, registry)`
re-checks every prepared caster against the plan before a draft may become a character. It
rejects redundant granted ids, ids above the class's own spell-level ceiling, ids outside the
ordinary candidate set, lists longer than `effectiveCapacity`, and any non-empty list when
capacity is unknown. A class with no plan entry — a known-spell caster, deleted custom
content, an unresolvable class — is skipped rather than blocking Finish, matching
`validateBuilderPreparedSpellSelections()`.

The picker's own hard block means a draft built through the UI cannot fail this. It exists
for drafts the UI did not build: a character reopened through Edit in Builder, custom content
deleted mid-flow, or an ability score cleared after spells were chosen. **An invalid draft is
never truncated, reinterpreted, or repaired.** The wizard stays open on the Spells step and
explains the problem; the character page repeats the check as a second line before any
mutation. A failure produces no mutation, no sheet seeding, no `rest.preparedByClass`
adoption, no dirty mark, no save attempt, and no partially created character.

**Rejected ids stay recoverable.** Rejecting an id the picker does not render would strand
the character: a granted, above-ceiling, off-list, or unresolvable id is deliberately absent
from `ordinaryCandidateIds`, so no ordinary checkbox can clear it. Saved builds legitimately
hold such ids — the shipped pre-C2-A picker offered grants as ordinary picks, took its
ceiling from the combined slot array, and enforced no cap. The prepared group therefore
renders every stored id that is not an ordinary candidate as a **remediation row**: named
(falling back to the raw id), labelled with why it needs attention, checked, enabled, and
removal-only — re-checking one is refused, so an unavailable id can never be reselected.
Unchecking removes it from the draft and the row disappears, freeing the capacity it held.

This is explicit user action, never automatic correction. **Nothing repairs a stored list on
load, on open, on render, or by migration** — opening and closing the wizard changes nothing,
and cancelling discards the draft so the stored build keeps every id it had. A stored list is
rewritten only by an explicit removal followed by a successful Finish. An unknown capacity
locks *unchosen* candidates only: already-selected candidates and remediation rows stay
enabled, so the list can always be cleared to the empty list Finish accepts.

**Adoption.** On success `adoptInitialBuilderPreparedSelections()` stores the plan's
`selectedIds` — the validated ordinary selection — so redundant granted ids never enter
`rest.preparedByClass` at creation. Granted access keeps flowing from
`derived.grantedSpells` through sheet seeding, exactly as §4.2 describes. The existing rule
that an already-established runtime key wins over the wizard draft is preserved, so Edit in
Builder still cannot overwrite play-state. A class with no plan entry keeps the previous
verbatim behavior, so unresolvable content fails soft and nothing is silently dropped.

**Creation underfill remains legal.** C2-B adds the deliberate inline confirmation, Summary
review row, and `aria-live` count announcement described below. Under-cap *opportunity* UI
and persisted acknowledgement for cantrips, known spells, and the wizard spellbook —
including that shared handler's permissive over-cap behavior — remain R5-B2. **No schema
change, no migration, no new persisted field, and no persisted prepared acknowledgement.**

### 4.5 Underfill confirmation, Summary, and live counts (C2-B, 2026-07-28)

An ordinary prepared list may legally hold fewer spells than `effectiveCapacity`, but ending
creation or a Long Rest with that shortfall must be deliberate.
`getPreparedSpellUnderfillShortfalls(plan, selectedByClass?)` in
`js/domain/rules/preparedSpells.js` is the pure shared decision:

- it compares the **resulting** legal ordinary ids with each plan entry's
  `effectiveCapacity`;
- an omitted class uses the plan's current `selectedIds`, while the Long Rest picker may
  supply its in-progress list;
- supplied ids are restricted to `ordinaryCandidateIds`, so a stale, invalid, or granted id
  cannot count as filling a legal slot;
- a full list, a zero-capacity candidate set, and unknown capacity produce no shortfall.

The result is transient. There is no stored acknowledgement, schema field, migration,
load-time repair, or new modal.

**Creation Finish.** This applies only while creating a new character. Edit in Builder is
excluded: after creation, its draft `preparedIds` are not authoritative play-state and must
not be presented as though they were. On the first underfilled Finish:

- the wizard remains open on Summary;
- an inline alert names each class's `current / effective` count;
- no character, prepared state, sheet seed, dirty mark, or save is produced;
- the action becomes **Finish Anyway**.

A second activation proceeds only while the exact selected ids and effective capacities are
unchanged. Editing the draft invalidates that transient confirmation.

Creation Summary includes its own neutral **Prepared for play** block, separate from both
required-choice and R5-B2 under-cap guidance. Its row reads **Prepared spells** and shows
each prepared class's `current / effective capacity` (or `capacity unknown`); **Review
prepared spells** returns directly to the Spells step.

**Long Rest.** The same inline two-step confirmation applies to all resulting paths:

- the preselected **No** (it is not acknowledgement merely because it is the default);
- an edited **Yes**;
- a no-edit **Yes**.

The first Apply leaves the dialog open, reports the class counts in its existing alert, and
changes the action to **Take Long Rest Anyway**. A radio or prepared-list change clears that
prompt and requires a fresh evaluation. The second activation returns the same selection
shape the rest flow already used, so rest application, prepared merging, active-character
isolation, and the one-mutation/one-dirty-mark contract are unchanged.

**Accessibility.** The live prepared count on both creation and Long Rest uses
`role="status"`, `aria-live="polite"`, and `aria-atomic="true"`. The inline confirmation is
an alert and receives focus when it appears; the existing dialog focus trap and keyboard
paths remain authoritative.

### 4.6 Level Up reports the same capacity (C2-C, 2026-07-29)

Level Up is informational about prepared spells — it reports capacity and routes the
selection to a Long Rest ([`level-up-flow-spec.md`](./level-up-flow-spec.md) §10.3). Until
C2-C the number it reported was its own: `getLevelUpPlan()` derived it from
`getBuildAbilityTotals()`, which meant it ignored `overrides.abilities`, excluded the ASI or
ability-granting feat being chosen in that very flow, showed the raw `formulaCapacity` rather
than the candidate-bounded `effectiveCapacity`, ignored a wizard's actual spellbook, and could
not notice a capacity change to a prepared class the appended level does not belong to. A
Level Up could therefore promise a capacity the following Long Rest refused to honour.

`getPreparedSpellCapacityChanges(beforeCharacter, afterCharacter, registry)` in
`js/domain/rules/preparedSpells.js` is the shipped answer. It calls `getPreparedSpellPlan()`
on two **character-shaped views** and diffs their `effectiveCapacity` per prepared caster:

- **before** — the real active character, so its `overrides.abilities`, stored spellbook, and
  granted spells all count;
- **after** — that same character shell carrying Level Up's isolated draft build, so the
  pending level, a pending subclass, a pending ASI or ability-granting feat, and pending
  spellbook additions all count.

Both sides therefore inherit §4.1 in full: per-class levels and casting progression (a half
caster still uses `floor(level / 2)`), each class's own spell-level ceiling rather than the
combined multiclass slot array, granted-spell exclusion, spellbook-bounded candidates, and
`null` for unknown. Each entry reports `capacityBefore`, `capacityAfter`, `limitedByBefore`,
`limitedByAfter`, `isNewCaster`, and `changed`. The function is pure, never throws, and
reports one entry per prepared caster of the projected character — build levels only append,
so a before-only entry would be a content-resolution artifact, not a capacity change.

**`getLevelUpPlan()` no longer carries prepared capacity at all.** Its
`preparedCapacityBefore` / `preparedCapacityAfter` delta fields and their local formula are
gone rather than left as a second, disagreeing owner, and a prepared caster whose only change
would be capacity no longer produces a `spellcastingDelta` entry. The plan still reports
newly reached spell levels, newly granted spells, and cantrip / known / spellbook deltas.

**Presentation stays informational.** The existing **Prepared capacity** row and the existing
"Prepared spells are chosen when finishing a Long Rest, not here." explanation are unchanged
in kind. The row shows `before → after` when the level moves the value and the resulting value
alone when it does not; an unknown capacity reads `unknown` and is never rendered as `0`; a
class only becoming a prepared caster now shows its resulting value with no misleading
"before". The informational Spells step becomes available whenever any prepared caster's
capacity moves — including a multiclass ASI that raises the spellcasting ability of a class
the newly gained (possibly non-spellcasting) level does not touch — and the displayed value is
recomputed rather than cached, so a pending wizard spellbook pick updates it in place, bounded
by that class's formula.

**Ownership is unchanged.** Level Up still never opens the Long Rest prepared selector, adds
no prepared picker, writes no legacy `build.spellcasting[classId].preparedIds`, and preserves
`rest.preparedByClass` byte-for-byte on open, navigation, cancel, and a successful Apply. C2-C
adds **no persisted field, no acknowledgement, no schema change, and no migration**.

### 4.7 The Spells panel marks granted rows by grant kind (C2-D, 2026-07-30)

The Spells panel is the last surface a player reads a granted spell on, and until C2-D it
contradicted every rule above. A `builderGranted` row carried the same interactive
`Prepared` toggle as any other row, titled "Manual/DM prepared override" — so the sheet
implied a grant is an ordinary preparation the player chose and may unchoose, and that it
occupies one of the `effectiveCapacity` slots §4.1 reserves for ordinary candidates. Neither
is true: grants reach the sheet through `derived.grantedSpells` in
`getBuilderFinishSheetSeedPatch()` (§4.2), are excluded from `ordinaryCandidateIds`, consume
no capacity, and are never eligible for §4.3's projection — so the toggle also had no
authoritative meaning to write back to.

**The presentation contract**, implemented once in
`js/pages/character/panels/spellsPanel.js` and therefore identical on the Character sheet and
the Combat workspace's embedded Spells panel (which calls the same `initSpellsPanel()` against
the same canonical character data — there is no Combat-specific renderer):

- A row with `builderGranted === true` renders **no** interactive `Prepared` control, and
  renders a non-interactive marker plus a **visible** sentence about preparation capacity.
  The explanation is rendered text on its own line, not a `title` tooltip, and it is not
  behind the row's notes disclosure: a collapsed granted row still shows it.
- **Marker presence and `Prepared` suppression are decided by `builderGranted` alone.** They
  never consult the row's stored `prepared` boolean, so a legacy or malformed granted row
  sitting at the "wrong" boolean is presented correctly and is not repaired.
- **Only the wording is grant-kind-sensitive**, and it is *live-derived* from the row's stable
  `builderSpellId` through the active registry at render time — never from `prepared`, and
  never from a persisted field (**no `grantType` is stored on the row**):

  | Registry record for `builderSpellId` | Badge | Explanation |
  | --- | --- | --- |
  | finite `data.level === 0` | `Granted Cantrip` | "Granted by your build. Cantrips are not prepared and do not use ordinary prepared spell capacity." |
  | finite `data.level > 0` | `Always Prepared` | "Granted by your build. It stays prepared and does not use your ordinary prepared spell capacity." |
  | missing, deleted, or invalid | `Granted Spell` | "Granted by your build. It does not use ordinary prepared spell capacity." |

  An absent, blank, or malformed level is **never coerced to `0`**; it takes the neutral
  fallback rather than being mislabelled a cantrip. `Always Prepared` reuses the builder
  wizard's own granted-spell heading.
- `Known` and `Cast` are untouched: still present, still keyboard-operable, still writing
  only their own field through the existing `mutateSpellEntry()` path with one
  `SaveManager.markDirty()` per user action.
- Rendering the marker **repairs nothing**. No row is normalized or rewritten, `builderGranted`
  and `prepared` are never touched to support the display, and rendering marks nothing dirty.

**Why the kinds differ (C2-D review correction).** Granted *leveled* spells — Life Domain's
Bless — genuinely are always prepared. Granted *cantrips* are not: `collectChoiceGrantedSpells()`
in `js/domain/rules/spellChoices.js` classifies the High Elf wizard cantrip as
`known_cantrip`, and §4.2's seeding deliberately writes such a grant as
`prepared: false, builderGranted: true` precisely so it does not imply a prepared slot.
Labelling it `Always Prepared` and saying it "stays prepared" restated exactly the confusion
C2-D set out to remove, so the wording now follows the registry level instead.

Every other row keeps the shipped behavior byte-for-byte. Manual rows (no `builderSpellId`)
and ordinary builder-managed rows keep the `Prepared` toggle, its "Manual/DM prepared
override" title, its `Prepared — manual or DM override` accessible label, its state mutation,
and its dirty-state behavior — including a manual override's documented meaning under §4.3.

C2-D is presentation only: **no prepared picker, no Long Rest mutation, no new prepared
state, no schema change, no migration, no persisted field, no acknowledgement, and no
load-time cleanup.** `rest.preparedByClass` remains authoritative for ordinary prepared
selections, and the shared-spell provenance limitation in §5 is unchanged.

Coverage is listed in §8.

---

## 5. P0 implementation coverage

- Short Rest spends available Hit Dice per class/die pool, rolls with Constitution, and
  applies only modeled short-rest recovery plus Pact Magic.
- Long Rest restores tracked HP, modeled slots/resources, eligible Hit Dice, and death
  saves; it requires at least 1 tracked current HP.
- Builder Cleric, Druid, Paladin, and Wizard prepared selections are made through the
  Long Rest flow. Known-spell casters and freeform characters do not use that selector.
- **Prepared Correctness C1 (2026-07-27)** completed §4's prepared rules: accurate
  current-versus-effective counts visible before the Yes/No choice, read-only granted
  spells that consume no capacity, per-class multiclass candidate levels, and a merging
  commit. See §4.1–§4.2.
- **Prepared Sheet Synchronization C1.1 (2026-07-28)** made the sheet agree with that
  commit — a deselected ordinary row now clears — and narrowed the Long Rest seed to
  spells only. See §4.3.
- **Creation Prepared Correctness C2-A (2026-07-28)** made creation consume the same plan,
  enforced `effectiveCapacity`, and added defensive pre-Finish validation so creation can no
  longer persist a list Long Rest would reject. See §4.4.
- **Prepared Underfill and Summary C2-B (2026-07-28)** made a legal short list deliberate at
  creation Finish and on every Long Rest path, added the creation Summary review/return
  surface, and announced live prepared counts without persisting acknowledgement. See §4.5.
- **Level Up Prepared Capacity C2-C (2026-07-29)** removed the last competing capacity
  formula: Level Up now reports the shared plan's `effectiveCapacity` before and after the
  pending level, including ability adjustments, the pending ASI or feat, a wizard's real
  spellbook, and a multiclass class the appended level does not touch. See §4.6.
- **Granted-Spell Presentation C2-D (2026-07-30)** made the sheet stop contradicting the
  rules above: no `builderGranted` row offers the manual/DM `Prepared` override any more, and
  each carries a visible explanation that it uses no ordinary preparation capacity, on both
  the Character and Combat Spells surfaces. The wording is live-derived from the registry
  rather than from the stored `prepared` boolean — granted leveled spells read `Always
  Prepared`, granted cantrips read `Granted Cantrip`, and an unresolvable record falls soft to
  `Granted Spell`. See §4.7.

**Still open after C2-D:** the dead `getPreparedSpellCapacity()` accessor; and the duplicate
`deriveCharacter()` call in the Long Rest patch path.

**Known limitation (pre-existing, documented not fixed):** the sheet stores one `prepared`
boolean per spell row with no per-class attribution, while `rest.preparedByClass` is
per class. A manual `Prepared` override on a builder-managed row that is also an ordinary
candidate of a *different* class can therefore be cleared when that other class is actively
recommitted (§4.3's projection is union-based by design, which is what keeps a shared
multiclass spell prepared while either class still holds it). Resolving it honestly needs
per-row provenance — a data-model expansion, not a prepared-closeout fix.

---

## 6. Spell slot field naming

The internal spell slot field is named `used`, but it stores **currently available**
slots, not spent ones (`used === total` means "full"). This is confirmed in
`js/domain/characterRest.js` and `js/pages/character/panels/spellsPanel.js`.

- **Do not rename this field** as part of rest or Level Up work.
- **Do** fix any user-facing label or example that reads "Used" while showing available
  slots.
- An internal rename is a separate, isolated cleanup change with its own migration
  considerations.

---

## 7. Resource recovery vocabulary

The `recovery` metadata on `resources[]`, on `manualFeatureCards[].limitedUse`, and on
derived `featureUses` is a **closed set**, defined in `js/domain/characterRest.js`:

```text
"shortRest" | "longRest" | "shortOrLongRest" | "manual" | "none"
```

Apply semantics (`recoveryMatchesRest()`):

- Short Rest resets `shortRest` and `shortOrLongRest`.
- Long Rest resets `longRest` and `shortOrLongRest`.
- `manual`, `none`, missing, and unrecognized values **never reset silently**. Leave them
  unchanged rather than guessing.

> There is no `anyRest` or `daily` recovery mode. Older planning prompts named them; they
> have never existed in the code. Do not introduce them as a side effect of rest work —
> adding a mode is a schema change and needs a migration.

---

## 8. Required tests when rest behavior is implemented

- Short Rest can spend Hit Dice and heal without exceeding max HP.
- Short Rest cannot spend unavailable Hit Dice.
- Short Rest does not fully heal by default.
- Short Rest restores Pact Magic slots and modeled short-rest resources.
- Long Rest restores current HP to max HP.
- Long Rest resets death saves, if tracked.
- Long Rest restores ordinary spell slots and Pact Magic slots.
- Long Rest restores modeled long-rest and short-or-long-rest resources.
- Long Rest recovers spent Hit Dice up to half total, never above max.
- Long Rest preserves notes, inventory, equipment, pockets, manual overrides, and
  prepared/known spells unless changed through the prepared-spell flow.
- The prepared-spell prompt appears for Cleric, Druid, Paladin, and Wizard.
- Choosing **No** preserves prepared spells; choosing **Yes** applies prepared changes and
  rest effects together.
- Prepared-spell changes preserve spell notes and descriptions.
- Rest actions are character-specific and stay correct across character switching.
- Rest is safe for both builder-created and freeform/manual characters.
- Long Rest does not persist or enforce a 24-hour timestamp; that rule stays with the table/DM.

Prepared-plan coverage (C1) lives in `tests/preparedSpells.test.js` and
`tests/restFlow.test.js`, with the merge contract in `tests/characterRest.test.js` and the
granted-access guarantee in `tests/builderSheetSeeding.test.js`:

- Cleric / Druid / Paladin / Wizard formula capacity, and the minimum-1 clamp.
- Unknown capacity stays `null`; the picker is not offered as a usable control.
- A wizard spellbook smaller than the formula bounds `effectiveCapacity`.
- Granted spells are excluded from candidates, from counts, and from capacity.
- Granted spell access survives a redundant stored id disappearing on recommit.
- Each multiclass caster uses its own class table; combined slots never widen candidates.
- Custom prepared classes with zero candidates, custom granted spells, deleted custom
  classes, and malformed/unresolvable ids all fail soft.
- "No" and a no-edit "Yes" both preserve the stored map verbatim; changing one class
  preserves every untouched class.

Sheet-projection coverage (C1.1) lives in `tests/preparedSheetSync.test.js`, with the page
wiring in `tests/characterPage.test.js` and the real-surface pass in
`tests/smoke/characterRest.smoke.js`:

- Deselect, deselect-all, and reselect move the row's flag in both directions.
- Granted rows, manual rows, and freeform characters are never written.
- A shared multiclass spell stays prepared until every prepared caster drops it.
- Recommitting one class never rewrites rows owned only by an untouched class.
- Row ids and every non-`prepared` field survive; no row is created or deleted by the sync.
- Default seeding callers are byte-identical (no sync ids means no projection).
- A Long Rest does not restore deleted features, proficiencies, attacks, inventory, or
  resources, and does not rewrite AC or calculation metadata.
- The Character and Combat Spells surfaces agree after apply and after reload.
- The Long Rest dialog is keyboard-operable and free of horizontal overflow at 380px.

Creation coverage (C2-A) lives in `tests/preparedCreation.test.js`, with the real wizard
Finish path in `tests/characterPage.test.js`. Every negative case carries a positive control
so it cannot pass because the prepared group failed to render:

- Life Domain grants are read-only, absent from ordinary candidates, and consume no capacity.
- A Cleric 3 / Wizard 3 gets only each class's own legal spell levels, though the combined
  slot array reaches higher.
- Wizard effective capacity is bounded by the draft spellbook, with the limitation explained;
  changing the spellbook recomputes the candidates and the cap.
- Selection stops at effective capacity; deselecting at the cap frees a slot again.
- Unknown capacity stays unknown (never `0`), locks the picker, and cannot build a list.
- Invalid ordinary ids, redundant granted ids, above-ceiling ids, over-cap lists, and a
  non-empty list under unknown capacity each fail Finish before any mutation, leaving the
  stored draft exactly as found.
- Every rejected id is reachable: granted, above-ceiling, off-list, out-of-spellbook, and
  unresolvable ids each render a removal-only remediation row (an over-cap list needs none —
  its ids are ordinary candidates), unchecking one removes only that id, re-checking is
  refused, and cancelling afterwards leaves the stored build byte-identical.
- A cap-disabled candidate carries a visible state class; checked rows never do.
- Synthetic change events cannot add past capacity or while capacity is unknown, and the
  input's rendered state is restored when one is refused.
- A valid underfilled list still Finishes, with no confirmation.
- Finish adopts the exact validated ordinary list; granted rows stay always-prepared on the
  sheet without entering `rest.preparedByClass`.
- Edit in Builder does not overwrite an established runtime prepared list.
- Freeform characters are never written; cantrip/known-spell groups are pinned unchanged.

Underfill/summary coverage (C2-B) extends `tests/preparedSpells.test.js`,
`tests/restFlow.test.js`, `tests/characterPage.test.js`,
`tests/smoke/preparedCreation.smoke.js`, and `tests/smoke/characterRest.smoke.js`:

- the shared pure decision reports only legal ordinary shortfalls and skips full, zero, and
  unknown capacities without mutating its plan;
- creation's first underfilled Finish produces no character or dirty mark, Summary shows the
  neutral count and direct return path, and the second exact-list confirmation succeeds;
- Long Rest confirms preselected No, edited Yes, and no-edit Yes, while full/unknown lists
  pass directly and a changed result invalidates a stale confirmation;
- live counts carry the polite atomic status semantics in both flows;
- the real keyboard paths, 380px layout, active-character isolation, sheet synchronization,
  and reload persistence remain covered in both dev and production-preview smoke gates.

Level Up capacity coverage (C2-C) lives in `tests/levelUpPreparedCapacity.test.js`, with the
plan contract pinned in `tests/progression.levelUp.test.js`, the byte-identity of prepared
play-state through a real Apply in `tests/characterPage.test.js`, and two real-browser cases in
`tests/smoke/levelUp.smoke.js`. Every negative case carries a positive control:

- a stored ability adjustment moves both the current and the resulting capacity;
- a pending ASI, and a pending ability-granting feat, each move the resulting capacity;
- a multiclass ASI moves another class's capacity and makes the informational Spells step
  available even though the appended level is non-spellcasting;
- each prepared class uses its own class level and progression (a half caster still halves);
- an under-filled wizard spellbook bounds the capacity below the formula, and a stocked one
  does not;
- selecting and deselecting pending spellbook additions moves the resulting capacity live and
  stops at the class formula;
- unknown capacity renders as `unknown`, never `0`;
- `getLevelUpPlan()` exposes no prepared capacity, no prepared ids, and no prepared map, and a
  capacity-only change produces no `spellcastingDelta` entry;
- `rest.preparedByClass` is byte-identical after cancel and after a successful Apply, which
  still marks dirty exactly once.

Granted-row presentation coverage (C2-D) lives in
`tests/spellsPanel.grantedPresentation.test.js` (14) and
`tests/smoke/grantedSpellPresentation.smoke.js` (3). Every negative assertion carries a
positive control, and the browser cases build real characters through the wizard — a Life
Domain cleric for leveled grants and a High Elf Life Domain cleric that carries a genuine
granted cantrip *and* granted leveled spells on one sheet — so the rows are true
Finish-seeded rows and both surfaces are proved through the shared production panel rather
than duplicated markup:

- a granted leveled row shows `Always Prepared`, explains the capacity rule in text that
  survives stripping every `title` / `aria-label` in the row, and shows it while the notes
  stay collapsed;
- a granted cantrip row (`fire-bolt`, seeded at `prepared: false`) shows `Granted Cantrip`,
  never `Always Prepared`, and never claims it "stays prepared", with the leveled grant
  beside it as the positive control;
- an unresolvable `builderSpellId` — a deleted registry record, and a granted row carrying no
  marker id at all — falls back to `Granted Spell` with the neutral sentence, without
  throwing, without coercing the missing level to `0`, and without mutating state;
- both stored booleans are set "wrong" for their kind in one fixture, proving the wording
  comes from the registry level rather than from `prepared`, and that neither boolean is
  rewritten to suit the label;
- no granted row of any kind exposes an interactive `Prepared` control or anything focusable
  inside the marker, while a manual row and an ordinary builder-managed row beside it keep
  the toggle, its title, its accessible label, its mutation, and its dirty mark;
- `Known` and `Cast` stay present, enabled, and keyboard-operable on granted leveled and
  granted cantrip rows alike, and each writes only its own field — `prepared` and
  `builderGranted` are unchanged;
- rendering every marker variant together mutates no state and calls no `markDirty()`;
- the row's name, SRD detail block, notes textarea, and move/delete controls are unchanged;
- the Combat embedded panel agrees with the Character sheet for both wordings, `Known`/`Cast`
  driven from Combat land on canonical data and show through on the Character sheet, both
  presentations survive reload, and 380px shows no page, panel, or row horizontal overflow
  and no clipped controls, with zero console or page errors.

Acceptance: no rest action silently fails, none affects the wrong character, unsupported
recovery modes are left unchanged rather than guessed, and `npm run verify` plus
`npm run test:smoke` pass.
