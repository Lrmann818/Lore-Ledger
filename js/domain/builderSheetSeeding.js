// @ts-check
// Finish-time sheet seeding for builder characters.
//
// Seeded content lands in the character's normal editable sheet homes and
// becomes user-owned immediately (see docs/reference/content-registry-plan.md
// "Seeded Editable Content Ownership"). All seeding is additive and
// duplicate-aware: existing text lines, attacks, spells, and inventory
// entries are preserved; numeric vitals are only filled when empty. Running
// the wizard again in edit mode re-seeds safely.

import { isBuilderCharacter } from "./characterHelpers.js";
import { buildSeededWeaponAttack, getAttackSourceWeaponId } from "./attackCalculation.js";
import {
  buildDerivedSpellcastingCalc,
  getSpellcastingDisplayModel,
  normalizeSpellcastingCalc
} from "./spellcastingCalculation.js";
import { buildDerivedAcCalc, normalizeAcCalc } from "./armorClassCalculation.js";
import { buildDerivedHpMaxCalc, clampCurrentHpToMax, normalizeHpMaxCalc } from "./hpMaxCalculation.js";
import { deriveCharacter } from "./rules/deriveCharacter.js";
import { getActiveContentRegistry, getContentByKind, listContentByKind } from "./rules/registry.js";
import { normalizeBuildLevels } from "./rules/progression.js";
import { classResourceSeedMarker } from "./rules/classResources.js";
import { getPreparedSpellPlan } from "./rules/preparedSpells.js";

/** @typedef {import("./rules/registry.js").ContentRegistry} ContentRegistry */

const SPELL_LEVEL_LABELS = Object.freeze([
  "Cantrips", "1st Level", "2nd Level", "3rd Level", "4th Level",
  "5th Level", "6th Level", "7th Level", "8th Level", "9th Level"
]);

// Stable markers stamped on seeded inventory pockets so re-seeds and edits find
// them again even after the user renames the pocket. Loose starting gear lands
// in the character's general inventory pocket; each equipment pack gets its own
// pocket holding that pack's SRD contents.
const STARTING_GEAR_SEED_MARKER = "starting-gear";
const PACK_SEED_MARKER_PREFIX = "pack:";

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function existingText(value) {
  return typeof value === "string" ? value : "";
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function finiteNumberOrNull(value) {
  if (value === "" || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {number} value
 * @returns {string}
 */
function signedNumber(value) {
  return value >= 0 ? `+${value}` : String(value);
}

/**
 * @param {string} value
 * @returns {string}
 */
function titleCaseWords(value) {
  return cleanString(value)
    .split(/[-\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeLine(value) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Collapses a (possibly multi-paragraph) description into a single line so it
 * can share one flat-textarea line with the feature name/source and stay
 * dedupe-safe.
 * @param {unknown} value
 * @returns {string}
 */
function oneLineText(value) {
  return (typeof value === "string" ? value : "").replace(/\s+/g, " ").trim();
}

// Separator between a feature's name/source head and its description on one
// seeded line. Kept distinct from the "Label:" separator used by the Dragonborn
// slice so both dedupe strategies stay unambiguous.
const FEATURE_DESC_SEPARATOR = " — ";

/**
 * Builds one seeded feature line: "Name (Source) — description" when a
 * description exists, otherwise just the name/source head.
 * @param {string} head
 * @param {unknown} description
 * @returns {string}
 */
function featureLine(head, description) {
  const desc = oneLineText(description);
  return desc ? `${head}${FEATURE_DESC_SEPARATOR}${desc}` : head;
}

/**
 * @param {string} existing
 * @param {string[]} seedLines
 * @param {(normalizedExistingLine: string, normalizedSeedLine: string) => boolean} hasEquivalent
 * @returns {string}
 */
function appendMissingLines(existing, seedLines, hasEquivalent = (a, b) => a === b) {
  const existingValue = typeof existing === "string" ? existing : "";
  const normalizedExistingLines = existingValue
    .split(/\r?\n/)
    .map(normalizeLine)
    .filter(Boolean);
  const missing = [];
  for (const line of seedLines) {
    const normalizedSeed = normalizeLine(line);
    if (!normalizedSeed) continue;
    if (normalizedExistingLines.some((existingLine) => hasEquivalent(existingLine, normalizedSeed))) continue;
    if (missing.some((pending) => normalizeLine(pending) === normalizedSeed)) continue;
    missing.push(line);
  }

  if (!missing.length) return existingValue;
  if (!existingValue) return missing.join("\n");
  return `${existingValue}${/\r?\n$/.test(existingValue) ? "" : "\n"}${missing.join("\n")}`;
}

/**
 * Reduces a normalized feature line to the head used for duplicate detection.
 * Feature lines carry their description inline ("Name (Source) — description"),
 * so re-seeding must compare only the name/source head; that keeps re-seeds
 * idempotent even after the user edits or rewrites the seeded description.
 * @param {string} normalizedLine
 * @returns {string}
 */
function featureLineDedupKey(normalizedLine) {
  if (normalizedLine.startsWith("draconic ancestry:")) return "draconic ancestry:";
  if (normalizedLine.startsWith("damage resistance:")) return "damage resistance:";
  const separatorIndex = normalizedLine.indexOf(FEATURE_DESC_SEPARATOR);
  return separatorIndex >= 0 ? normalizedLine.slice(0, separatorIndex).trim() : normalizedLine;
}

/**
 * @param {string} existing
 * @param {string[]} seedLines
 * @returns {string}
 */
function appendMissingFeatureLines(existing, seedLines) {
  return appendMissingLines(existing, seedLines,
    (existingLine, seedLine) => featureLineDedupKey(existingLine) === featureLineDedupKey(seedLine));
}

/**
 * @param {unknown} value
 * @returns {Set<string>}
 */
function getExistingListLabels(value) {
  if (typeof value !== "string") return new Set();
  return new Set(
    value
      .split(/[\r\n,;]+/)
      .map((entry) => entry.trim().replace(/\s+/g, " ").toLowerCase())
      .filter(Boolean)
  );
}

/**
 * @param {string} existing
 * @param {string[]} seedLabels
 * @returns {string}
 */
function appendMissingListLabels(existing, seedLabels) {
  const existingValue = typeof existing === "string" ? existing : "";
  const existingLabels = getExistingListLabels(existingValue);
  const missing = [];
  for (const label of seedLabels) {
    const clean = cleanString(label);
    if (!clean || existingLabels.has(clean.toLowerCase())) continue;
    if (missing.some((pending) => pending.toLowerCase() === clean.toLowerCase())) continue;
    missing.push(clean);
  }
  if (!missing.length) return existingValue;
  if (!existingValue) return missing.join("\n");
  return `${existingValue}${/\r?\n$/.test(existingValue) ? "" : "\n"}${missing.join("\n")}`;
}

/**
 * Dragonborn-specific passive text (the original Phase 3I slice, kept
 * byte-compatible with existing saves and tests).
 * @param {ReturnType<typeof deriveCharacter>} derived
 * @param {import("./rules/builtinContent.js").BuiltinContentEntry | null} raceEntry
 * @returns {string[]}
 */
function getDragonbornFeatureLines(derived, raceEntry) {
  if (!raceEntry || raceEntry.id !== "dragonborn") return [];
  const ancestry = derived.dragonbornAncestry;
  if (!ancestry) return [];
  const ancestryName = cleanString(ancestry.name);
  const damageType = cleanString(ancestry.damageResistance || ancestry.damageType).toLowerCase();
  if (!ancestryName || !damageType) return [];
  return [
    "Dragonborn Traits",
    `Draconic Ancestry: ${ancestryName}`,
    `Damage Resistance: You have resistance to ${damageType} damage.`
  ];
}

// Traits already surfaced by a dedicated seeded slice (getDragonbornFeatureLines)
// and/or the derived feature-action cards. Seeding their generic trait text too
// would duplicate the ancestry/breath-weapon presentation.
const SLICE_COVERED_TRAIT_IDS = new Set(["draconic-ancestry"]);

/**
 * Race trait lines for non-choice-derived traits (traits whose mechanics
 * depend on a build choice stay live-derived, not seeded text). Each seeded
 * line carries the trait's SRD description where available.
 * @param {ContentRegistry} registry
 * @param {import("./rules/builtinContent.js").BuiltinContentEntry | null} raceEntry
 * @param {import("./rules/builtinContent.js").BuiltinContentEntry | null} subraceEntry
 * @returns {string[]}
 */
function getRaceTraitLines(registry, raceEntry, subraceEntry) {
  /** @type {string[]} */
  const lines = [];
  for (const parent of [raceEntry, subraceEntry]) {
    if (!parent) continue;
    const traitIds = Array.isArray(parent.data?.traits) ? parent.data.traits : [];
    for (const traitId of traitIds) {
      const id = cleanString(traitId);
      if (SLICE_COVERED_TRAIT_IDS.has(id)) continue;
      const traitEntry = getContentByKind(registry, "trait", id);
      if (!traitEntry) continue;
      if (cleanString(traitEntry.data?.derivedFrom)) continue;
      lines.push(featureLine(`${traitEntry.name} (${parent.name})`, traitEntry.data?.description));
    }
  }
  return lines;
}

/**
 * @param {ReturnType<typeof deriveCharacter>} derived
 * @param {ContentRegistry} registry
 * @param {import("./rules/builtinContent.js").BuiltinContentEntry | null} backgroundEntry
 * @returns {string[]}
 */
function getClassAndBackgroundFeatureLines(derived, registry, backgroundEntry) {
  /** @type {string[]} */
  const lines = [];
  const seen = new Set();
  for (const feature of derived.features) {
    // A feature replaced by a chosen subfeature (e.g. Fighting Style →
    // Archery) seeds only the chosen option.
    if (feature.replacedBy && feature.replacedBy.length) continue;
    if (seen.has(feature.featureId)) continue;
    seen.add(feature.featureId);
    const classEntry = getContentByKind(registry, "class", feature.classId);
    const className = classEntry?.name || feature.classId;
    lines.push(featureLine(`${feature.name} (${className} ${feature.classLevel})`, feature.desc));
  }
  if (backgroundEntry && isPlainObject(backgroundEntry.data?.feature)) {
    const name = cleanString(backgroundEntry.data.feature.name);
    if (name) lines.push(featureLine(`${name} (${backgroundEntry.name})`, backgroundEntry.data.feature.desc));
  }
  for (const featId of derived.featIds) {
    const featEntry = getContentByKind(registry, "feat", featId);
    if (featEntry) lines.push(featureLine(`${featEntry.name} (Feat)`, featEntry.data?.desc));
  }
  return lines;
}

/**
 * @param {ReturnType<typeof deriveCharacter>} derived
 * @param {ContentRegistry} registry
 * @returns {{ armor: string[], weapons: string[], tools: string[] }}
 */
function getProficiencyLabels(derived, registry) {
  const armorLabelById = { light: "Light armor", medium: "Medium armor", heavy: "Heavy armor", shield: "Shields" };
  const weaponLabelById = { simple: "Simple weapons", martial: "Martial weapons" };
  return {
    armor: derived.proficiencies.armor.map((id) =>
      armorLabelById[/** @type {keyof typeof armorLabelById} */ (id)] || titleCaseWords(id)),
    weapons: derived.proficiencies.weapons.map((id) =>
      weaponLabelById[/** @type {keyof typeof weaponLabelById} */ (id)] || titleCaseWords(id)),
    tools: derived.proficiencies.tools.map((id) => {
      const entry = getContentByKind(registry, "language", id);
      return entry?.name || titleCaseWords(id);
    })
  };
}

/**
 * @returns {string}
 */
function newSeedId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Attack rows for the build's chosen weapons (proficiency assumed).
 * @param {Record<string, unknown>} source
 * @param {ReturnType<typeof deriveCharacter>} derived
 * @param {ContentRegistry} registry
 * @returns {Array<Record<string, unknown>> | null} full replacement array or null when unchanged
 */
function getSeededAttacks(source, derived, registry) {
  const build = isPlainObject(source.build) ? source.build : {};
  const equipment = isPlainObject(build.equipment) ? build.equipment : {};
  const weaponIds = Array.isArray(equipment.weaponIds) ? equipment.weaponIds : [];
  if (!weaponIds.length) return null;

  const existing = Array.isArray(source.attacks) ? source.attacks : [];
  // Duplicate-aware by the stable weapon marker, NOT by display name: a user
  // who renames a seeded attack must not get a fresh duplicate on re-seed
  // (Edit in Builder / Level Up). An unmarked manual row whose name matches
  // the weapon is still respected so we don't shadow the user's own entry.
  const existingWeaponMarkers = new Set(
    existing
      .filter(isPlainObject)
      .map((attack) => getAttackSourceWeaponId(attack))
      .filter(Boolean)
  );
  const existingUnmarkedNames = new Set(
    existing
      .filter((attack) => isPlainObject(attack) && !getAttackSourceWeaponId(attack))
      .map((attack) => cleanString(attack.name).toLowerCase())
      .filter(Boolean)
  );

  /** @type {Array<Record<string, unknown>>} */
  const additions = [];
  const seen = new Set();
  for (const weaponId of weaponIds) {
    const weapon = getContentByKind(registry, "weapon", cleanString(weaponId));
    if (!weapon || seen.has(weapon.id)) continue;
    seen.add(weapon.id);
    if (existingWeaponMarkers.has(weapon.id)) continue;
    if (existingUnmarkedNames.has(weapon.name.toLowerCase())) continue;
    // Canonical weapon → attack math lives in attackCalculation.js. Seeded
    // rows carry the structured calc block (mode "weapon", proficiency from
    // the character's derived proficiencies) plus the stable builderSeed
    // marker, so they derive live from creation onward while name/notes/order
    // stay user-owned.
    additions.push({
      id: newSeedId("atk"),
      ...buildSeededWeaponAttack(weapon, derived, registry)
    });
  }
  if (!additions.length) return null;
  return [...existing, ...additions];
}

/**
 * Canonical display rank for a spell-level label: cantrips first, then spell
 * levels 1–9 ascending, with a Pact Magic bucket placed just after the regular
 * level of the same number. Returns null for labels we do not recognize
 * (user-created custom levels), which keeps them anchored during the sort.
 * @param {unknown} label
 * @returns {number | null}
 */
function spellLevelRank(label) {
  const normalized = cleanString(label).toLowerCase();
  if (!normalized) return null;
  if (normalized.includes("cantrip")) return 0;
  const isPact = normalized.includes("pact");
  const match = normalized.match(/(\d+)\s*(?:st|nd|rd|th)?\s*level/);
  const value = match ? Number(match[1]) : NaN;
  if (!Number.isFinite(value)) return null;
  // Pact Magic sorts immediately after the same-numbered regular slot level.
  return isPact ? value + 0.5 : value;
}

/**
 * Reorders recognized spell levels into canonical order (cantrips, then 1–9,
 * pact after its numbered level) while leaving unrecognized custom levels in
 * their original slots. A stable sort preserves the relative order of levels
 * that share a rank, and user notes/prepared state travel with each level
 * object untouched.
 * @param {Array<Record<string, unknown>>} levels
 * @returns {{ levels: Array<Record<string, unknown>>, reordered: boolean }}
 */
function sortSpellLevelsCanonically(levels) {
  if (!Array.isArray(levels) || levels.length < 2) return { levels, reordered: false };
  const ranked = levels.map((level, index) => ({
    level,
    index,
    rank: spellLevelRank(isPlainObject(level) ? level.label : "")
  }));
  const knownPositions = ranked.filter((entry) => entry.rank != null).map((entry) => entry.index);
  if (knownPositions.length < 2) return { levels, reordered: false };
  const sortedKnown = ranked
    .filter((entry) => entry.rank != null)
    .sort((a, b) => (/** @type {number} */ (a.rank) - /** @type {number} */ (b.rank)) || (a.index - b.index));
  const result = levels.slice();
  let reordered = false;
  knownPositions.forEach((position, i) => {
    if (result[position] !== sortedKnown[i].level) reordered = true;
    result[position] = sortedKnown[i].level;
  });
  return reordered ? { levels: result, reordered: true } : { levels, reordered: false };
}

/**
 * Projects the authoritative `rest.preparedByClass` selection onto the
 * builder-managed **ordinary** spell rows of the classes a Long Rest actively
 * recommitted (Prepared Sheet Synchronization, C1.1).
 *
 * Seeding is otherwise additive-only: a deselected id simply stops appearing
 * in the seed set, so the additive reconcile below can never clear its row.
 * This pass closes that gap without introducing a second source of truth —
 * every id it reads comes from `getPreparedSpellPlan()`, the single owner of
 * the prepared rules.
 *
 * Scope rules, in order:
 *
 * - Only rows whose `builderSpellId` is an ordinary candidate of an
 *   **actively recommitted** class are eligible. A manual Prepared override on
 *   a class the player did not touch therefore survives.
 * - A row is prepared when **any** prepared caster currently prepares that
 *   spell, so a spell shared by two classes stays prepared while either one
 *   still holds it.
 * - Granted rows (`builderGranted`) and manual rows (no `builderSpellId`) are
 *   never eligible: grants are excluded from `ordinaryCandidateIds` by the plan
 *   itself, and the marker check is the second guard.
 * - Only the `prepared` boolean is written. No row is created or deleted, and
 *   no other field is touched.
 *
 * @param {Array<Record<string, unknown>>} levels
 * @param {Record<string, unknown>} source
 * @param {ContentRegistry} registry
 * @param {readonly string[]} classIds classes actively recommitted this rest
 * @returns {boolean} whether any row changed
 */
function syncPreparedSpellRows(levels, source, registry, classIds) {
  const plan = getPreparedSpellPlan(/** @type {any} */ (source), registry);
  if (!plan.length) return false;

  // Rows this sync may touch: the ordinary candidates of the recommitted
  // classes. A class with no plan entry (deleted custom content, no longer a
  // prepared caster) contributes nothing and fails soft.
  const recommitted = new Set(classIds);
  /** @type {Set<string>} */
  const scoped = new Set();
  /** @type {Set<string>} */
  const preparedNow = new Set();
  for (const entry of plan) {
    for (const id of entry.selectedIds) preparedNow.add(id);
    if (!recommitted.has(entry.classId)) continue;
    for (const id of entry.ordinaryCandidateIds) scoped.add(id);
  }
  if (!scoped.size) return false;

  let changed = false;
  for (const level of levels) {
    if (!isPlainObject(level)) continue;
    const spells = Array.isArray(level.spells) ? level.spells : [];
    for (const spell of spells) {
      if (!isPlainObject(spell)) continue;
      if (spell.builderGranted === true) continue;
      const spellId = cleanString(spell.builderSpellId);
      if (!spellId || !scoped.has(spellId)) continue;
      const prepared = preparedNow.has(spellId);
      if (spell.prepared !== prepared) {
        spell.prepared = prepared;
        changed = true;
      }
    }
  }
  return changed;
}

/**
 * Seeds the sheet spells model: slot totals per level plus chosen and
 * granted spells. Existing levels/spells and slot usage are preserved.
 *
 * `syncPreparedClassIds` is opt-in and used only by the Long Rest prepared
 * commit. Every other caller passes nothing and gets byte-identical
 * additive-only behavior.
 *
 * @param {Record<string, unknown>} source
 * @param {ReturnType<typeof deriveCharacter>} derived
 * @param {ContentRegistry} registry
 * @param {readonly string[] | null} [syncPreparedClassIds]
 * @returns {Record<string, unknown> | null} full replacement spells object or null when unchanged
 */
function getSeededSpells(source, derived, registry, syncPreparedClassIds = null) {
  const spellcasting = derived.spellcasting;
  const grantedSpells = Array.isArray(derived.grantedSpells) ? derived.grantedSpells : [];
  // Non-casters can still receive a granted spell (e.g. a High Elf Fighter's
  // chosen wizard cantrip). Only bail when there is nothing at all to seed.
  if (!spellcasting && !grantedSpells.length) return null;
  const build = isPlainObject(source.build) ? source.build : {};
  const selections = isPlainObject(build.spellcasting) ? build.spellcasting : {};
  const rest = isPlainObject(source.rest) ? source.rest : {};
  const preparedByClass = isPlainObject(rest.preparedByClass) ? rest.preparedByClass : {};

  /** @type {Map<number, { names: Map<string, { prepared: boolean, builderSpellId: string, granted: boolean }> }>} */
  const seedByLevel = new Map();
  const addSpell = (spellId, { prepared, granted = false }) => {
    const spellEntry = getContentByKind(registry, "spell", cleanString(spellId));
    if (!spellEntry) return;
    const level = Number(spellEntry.data?.level) || 0;
    if (!seedByLevel.has(level)) seedByLevel.set(level, { names: new Map() });
    const bucket = /** @type {{ names: Map<string, { prepared: boolean, builderSpellId: string, granted: boolean }> }} */ (seedByLevel.get(level));
    const existingSeed = bucket.names.get(spellEntry.name);
    bucket.names.set(spellEntry.name, {
      prepared: (existingSeed?.prepared ?? false) || prepared,
      builderSpellId: existingSeed?.builderSpellId || spellEntry.id,
      granted: (existingSeed?.granted ?? false) || granted
    });
  };

  for (const [classId, selection] of Object.entries(selections)) {
    if (!isPlainObject(selection)) continue;
    for (const id of Array.isArray(selection.cantripIds) ? selection.cantripIds : []) addSpell(id, { prepared: false });
    for (const id of Array.isArray(selection.knownIds) ? selection.knownIds : []) addSpell(id, { prepared: false });
    const preparedIds = Array.isArray(preparedByClass[classId])
      ? preparedByClass[classId]
      : (Array.isArray(selection.preparedIds) ? selection.preparedIds : []);
    for (const id of preparedIds) addSpell(id, { prepared: true });
  }
  // Granted cantrips are always-known (not "prepared"); granted leveled spells
  // are always-prepared. This keeps a granted cantrip from showing a spurious
  // prepared checkmark and from implying it consumes a prepared slot.
  for (const grant of grantedSpells) {
    addSpell(grant.spellId, { prepared: grant.grantType !== "known_cantrip", granted: true });
  }

  const slotLevels = (spellcasting ? spellcasting.slots : [])
    .map((count, index) => ({ level: index + 1, count }))
    .filter((slot) => slot.count > 0);

  if (!seedByLevel.size && !slotLevels.length && !spellcasting?.pact) return null;

  const existingSpells = isPlainObject(source.spells) ? source.spells : {};
  const existingLevels = Array.isArray(existingSpells.levels) ? existingSpells.levels : [];
  /** @type {Array<Record<string, unknown>>} */
  const nextLevels = existingLevels.map((level) => (isPlainObject(level)
    ? { ...level, spells: Array.isArray(level.spells) ? level.spells.slice() : [] }
    : level));

  /**
   * @param {string} label
   * @param {boolean} hasSlots
   * @returns {Record<string, unknown>}
   */
  const ensureLevel = (label, hasSlots) => {
    const normalized = label.toLowerCase();
    let found = nextLevels.find((level) =>
      isPlainObject(level) && cleanString(level.label).toLowerCase() === normalized);
    if (found && isPlainObject(found)) return found;
    const created = {
      id: newSeedId("spellLevel"),
      label,
      hasSlots,
      used: null,
      total: null,
      collapsed: false,
      spells: []
    };
    nextLevels.push(created);
    return created;
  };

  let changed = false;

  for (const slot of slotLevels) {
    const level = ensureLevel(SPELL_LEVEL_LABELS[slot.level], true);
    if (finiteNumberOrNull(level.total) == null) {
      level.total = slot.count;
      if (finiteNumberOrNull(level.used) == null) level.used = slot.count;
      changed = true;
    }
  }
  if (spellcasting?.pact) {
    const level = ensureLevel(`Pact Magic (${SPELL_LEVEL_LABELS[spellcasting.pact.slotLevel]})`, true);
    if (finiteNumberOrNull(level.total) == null) {
      level.total = spellcasting.pact.slots;
      if (finiteNumberOrNull(level.used) == null) level.used = spellcasting.pact.slots;
      changed = true;
    }
  }

  for (const [spellLevel, bucket] of [...seedByLevel.entries()].sort((a, b) => a[0] - b[0])) {
    const isPact = spellcasting?.pact && spellcasting.classes.length === 1 &&
      spellcasting.classes[0].progression === "pact" && spellLevel > 0;
    const label = isPact && spellcasting.pact
      ? `Pact Magic (${SPELL_LEVEL_LABELS[spellcasting.pact.slotLevel]})`
      : SPELL_LEVEL_LABELS[spellLevel];
    const level = ensureLevel(label, spellLevel > 0);
    const spells = Array.isArray(level.spells) ? level.spells : [];
    for (const [name, meta] of bucket.names) {
      const managedSpell = spells.find((spell) => (
        isPlainObject(spell) && cleanString(spell.builderSpellId) === meta.builderSpellId
      ));
      if (managedSpell) {
        if (managedSpell.prepared !== meta.prepared) {
          managedSpell.prepared = meta.prepared;
          changed = true;
        }
        if (meta.granted && managedSpell.builderGranted !== true) {
          managedSpell.builderGranted = true;
          changed = true;
        }
        continue;
      }
      // An unmarked matching name is a user-owned/manual spell. Preserve it
      // rather than adopting or changing its prepared flag. New builder-managed
      // rows carry a stable registry marker so later Long Rests can project
      // selections without touching manual content.
      const hasManualName = spells.some((spell) => (
        isPlainObject(spell) && cleanString(spell.name).toLowerCase() === name.toLowerCase()
      ));
      if (hasManualName) continue;
      spells.push({
        id: newSeedId("spell"),
        name,
        notesCollapsed: true,
        known: true,
        prepared: meta.prepared,
        expended: false,
        builderSpellId: meta.builderSpellId,
        ...(meta.granted ? { builderGranted: true } : {})
      });
      changed = true;
    }
    level.spells = spells;
  }

  // Long Rest only: project the recommitted classes' prepared selection onto
  // their existing ordinary rows. Runs after the additive pass so rows created
  // above are already correct and are simply confirmed here.
  if (syncPreparedClassIds?.length &&
    syncPreparedSpellRows(nextLevels, source, registry, syncPreparedClassIds)) {
    changed = true;
  }

  // Enforce cantrips-first, then ascending level order (pact after its number)
  // for the seeded/derived levels; unrecognized custom levels stay put.
  const ordered = sortSpellLevelsCanonically(nextLevels);

  if (!changed && !ordered.reordered) return null;
  return { ...existingSpells, levels: ordered.levels };
}

/**
 * @param {unknown} name
 * @param {unknown} quantity
 * @returns {string}
 */
function itemLine(name, quantity) {
  const clean = cleanString(name);
  if (!clean) return "";
  return Number(quantity) > 1 ? `${clean} ×${quantity}` : clean;
}

/**
 * Resolves an equipment pack from the registry by id, falling back to an exact
 * name match (starting-equipment choices persist only the option label).
 * @param {ContentRegistry} registry
 * @param {unknown} itemId
 * @param {unknown} name
 * @returns {import("./rules/builtinContent.js").BuiltinContentEntry | null}
 */
function resolvePackEntry(registry, itemId, name) {
  const id = cleanString(itemId);
  if (id) {
    const byId = getContentByKind(registry, "pack", id);
    if (byId) return byId;
  }
  const label = cleanString(name).toLowerCase();
  if (!label) return null;
  return listContentByKind(registry, "pack").find((entry) => entry.name.toLowerCase() === label) || null;
}

/**
 * @param {import("./rules/builtinContent.js").BuiltinContentEntry} packEntry
 * @returns {string[]}
 */
function getPackContentLines(packEntry) {
  const contents = Array.isArray(packEntry.data?.contents) ? packEntry.data.contents : [];
  /** @type {string[]} */
  const lines = [];
  for (const item of contents) {
    if (!isPlainObject(item)) continue;
    const line = itemLine(cleanString(item.name) || cleanString(item.itemId), item.quantity);
    if (line) lines.push(line);
  }
  return lines;
}

/**
 * Splits the build's starting equipment into loose gear (weapons, armor, gear
 * items, notes) and the equipment packs that carry their own SRD contents.
 * Loose gear seeds into the general inventory pocket; each pack becomes its own
 * pocket. A pack we cannot resolve in the registry degrades to a loose line.
 *
 * @param {Record<string, unknown>} source
 * @param {ContentRegistry} registry
 * @returns {{ looseLines: string[], packs: Array<{ id: string, name: string, lines: string[] }> }}
 */
function getStartingEquipment(source, registry) {
  const build = isPlainObject(source.build) ? source.build : {};
  const equipment = isPlainObject(build.equipment) ? build.equipment : {};
  /** @type {string[]} */
  const looseLines = [];
  /** @type {Array<{ id: string, name: string, lines: string[] }>} */
  const packs = [];
  const seenPackIds = new Set();

  /** @param {import("./rules/builtinContent.js").BuiltinContentEntry} packEntry */
  const addPack = (packEntry) => {
    if (seenPackIds.has(packEntry.id)) return;
    seenPackIds.add(packEntry.id);
    packs.push({ id: packEntry.id, name: packEntry.name, lines: getPackContentLines(packEntry) });
  };

  const levels = normalizeBuildLevels(build);
  const firstClassId = levels.length ? levels[0].classId : "";
  const sources = [
    firstClassId ? getContentByKind(registry, "class", firstClassId) : null,
    getContentByKind(registry, "background", cleanString(build.backgroundId))
  ];
  for (const parent of sources) {
    if (!parent) continue;
    const fixed = Array.isArray(parent.data?.startingEquipment) ? parent.data.startingEquipment : [];
    for (const item of fixed) {
      if (!isPlainObject(item)) continue;
      const packEntry = resolvePackEntry(registry, item.itemId, item.name);
      if (packEntry) {
        addPack(packEntry);
        continue;
      }
      const line = itemLine(cleanString(item.name) || cleanString(item.itemId), item.quantity);
      if (line) looseLines.push(line);
    }
  }

  const startingChoices = isPlainObject(equipment.startingChoices) ? equipment.startingChoices : {};
  for (const choice of Object.values(startingChoices)) {
    if (!isPlainObject(choice)) continue;
    const label = cleanString(choice.label);
    const packEntry = resolvePackEntry(registry, choice.itemId, label);
    if (packEntry) {
      addPack(packEntry);
      continue;
    }
    if (label) looseLines.push(label);
  }

  const armorEntry = getContentByKind(registry, "armor", cleanString(equipment.armorId));
  if (armorEntry) looseLines.push(armorEntry.name);
  if (equipment.shield === true) looseLines.push("Shield");
  for (const weaponId of Array.isArray(equipment.weaponIds) ? equipment.weaponIds : []) {
    const weapon = getContentByKind(registry, "weapon", cleanString(weaponId));
    if (weapon) looseLines.push(weapon.name);
  }
  for (const note of cleanString(equipment.notes).split(/\r?\n/)) {
    if (note.trim()) looseLines.push(note.trim());
  }
  return { looseLines, packs };
}

/**
 * Locates the pocket that owns loose starting gear: the marker first (survives
 * a user rename), then a legacy seeded "Starting Gear" pocket, then the
 * character's default general "Inventory" pocket. Pockets carrying a different
 * seed marker (i.e. pack pockets) and user-created pockets are never matched.
 * @param {unknown[]} items
 * @returns {number}
 */
function findLooseGearPocketIndex(items) {
  const marked = items.findIndex((item) =>
    isPlainObject(item) && cleanString(item.builderSeed) === STARTING_GEAR_SEED_MARKER);
  if (marked >= 0) return marked;
  const legacy = items.findIndex((item) =>
    isPlainObject(item) && !cleanString(item.builderSeed)
    && cleanString(item.title).toLowerCase() === "starting gear");
  if (legacy >= 0) return legacy;
  return items.findIndex((item) =>
    isPlainObject(item) && !cleanString(item.builderSeed)
    && cleanString(item.title).toLowerCase() === "inventory");
}

/**
 * Locates the resource entry that owns one derived class pool: the stable
 * `builderSeed` marker first (survives a user rename), then an unmarked
 * entry whose name matches case-insensitively — adopting a hand-made "Rage"
 * tracker instead of duplicating it. User-created entries with other names
 * and entries carrying a different marker are never matched.
 * @param {unknown[]} items
 * @param {{ id: string, name: string }} resource
 * @returns {number}
 */
function findClassResourceIndex(items, resource) {
  const marker = classResourceSeedMarker(resource.id);
  const marked = items.findIndex((item) =>
    isPlainObject(item) && cleanString(item.builderSeed) === marker);
  if (marked >= 0) return marked;
  const nameKey = resource.name.toLowerCase();
  return items.findIndex((item) =>
    isPlainObject(item) && !cleanString(item.builderSeed) &&
    cleanString(item.name).toLowerCase() === nameKey);
}

/**
 * Finish/Edit-time class-resource seeding: appends missing pools and fills
 * only empty fields on existing ones. Stored `name`, `cur`, a user-set
 * `max`, and a user-set `recovery` are never overwritten here — the
 * fill-only-when-empty contract that all Finish seeding follows. Unlimited
 * pools (Rage at barbarian 20) seed with `max: null` so nothing false is
 * written. Returns a full replacement array or null when unchanged.
 * @param {Record<string, unknown>} source
 * @param {ReturnType<typeof deriveCharacter>} derived
 * @returns {Array<Record<string, unknown>> | null}
 */
function getSeededResources(source, derived) {
  const derivedResources = Array.isArray(derived.derivedResources) ? derived.derivedResources : [];
  if (!derivedResources.length) return null;
  const existing = Array.isArray(source.resources) ? source.resources : [];
  const next = existing.slice();
  let changed = false;

  for (const resource of derivedResources) {
    const marker = classResourceSeedMarker(resource.id);
    const index = findClassResourceIndex(next, resource);
    if (index < 0) {
      const max = resource.unlimited ? null : resource.max;
      next.push({
        id: newSeedId("res"),
        name: resource.name,
        cur: max,
        max,
        recovery: resource.recovery,
        builderSeed: marker
      });
      changed = true;
      continue;
    }
    const item = /** @type {Record<string, unknown>} */ ({ ...next[index] });
    let itemChanged = false;
    if (cleanString(item.builderSeed) !== marker) {
      item.builderSeed = marker;
      itemChanged = true;
    }
    if (!resource.unlimited && resource.max != null && finiteNumberOrNull(item.max) == null) {
      item.max = resource.max;
      itemChanged = true;
      if (finiteNumberOrNull(item.cur) == null) item.cur = resource.max;
    }
    if (!cleanString(item.recovery)) {
      item.recovery = resource.recovery;
      itemChanged = true;
    }
    if (itemChanged) {
      next[index] = item;
      changed = true;
    }
  }
  return changed ? next : null;
}

/**
 * Level-up-specific class-resource growth. Newly unlocked pools arrive full;
 * pools the character already has move by the derived before→after delta so
 * spent uses stay spent (Rage 0/2 → 1/3, never 3/3). A manually offset
 * maximum keeps its offset. Recovery follows recompute-if-untouched: it
 * updates only while the stored value still matches the previous derived
 * cadence (the Bardic Inspiration upgrade at bard 5), otherwise the manual
 * setting is kept and reported. Unlimited pools stop receiving numeric
 * updates. Returns a full replacement array or null when unchanged.
 * @param {Record<string, unknown>} source
 * @param {ReturnType<typeof deriveCharacter>} derivedBefore
 * @param {ReturnType<typeof deriveCharacter>} derivedAfter
 * @param {{ preserved: string[] }} report
 * @returns {Array<Record<string, unknown>> | null}
 */
function accumulateClassResources(source, derivedBefore, derivedAfter, report) {
  const afterResources = Array.isArray(derivedAfter.derivedResources) ? derivedAfter.derivedResources : [];
  if (!afterResources.length) return null;
  const beforeById = new Map(
    (Array.isArray(derivedBefore.derivedResources) ? derivedBefore.derivedResources : [])
      .map((resource) => [resource.id, resource])
  );
  const existing = Array.isArray(source.resources) ? source.resources : [];
  const next = existing.slice();
  let changed = false;

  for (const after of afterResources) {
    const before = beforeById.get(after.id) ?? null;
    const marker = classResourceSeedMarker(after.id);
    const index = findClassResourceIndex(next, after);
    if (index < 0) {
      const max = after.unlimited ? null : after.max;
      next.push({
        id: newSeedId("res"),
        name: after.name,
        cur: max,
        max,
        recovery: after.recovery,
        builderSeed: marker
      });
      changed = true;
      continue;
    }
    const item = /** @type {Record<string, unknown>} */ ({ ...next[index] });
    let itemChanged = false;
    if (cleanString(item.builderSeed) !== marker) {
      item.builderSeed = marker;
      itemChanged = true;
    }
    if (!after.unlimited && after.max != null) {
      const storedMax = finiteNumberOrNull(item.max);
      if (storedMax == null) {
        item.max = after.max;
        itemChanged = true;
        if (finiteNumberOrNull(item.cur) == null) item.cur = after.max;
      } else if (before && !before.unlimited && before.max != null) {
        const delta = after.max - before.max;
        if (delta !== 0) {
          const nextMax = storedMax + delta;
          item.max = nextMax;
          itemChanged = true;
          const storedCur = finiteNumberOrNull(item.cur);
          if (storedCur != null) item.cur = Math.max(0, Math.min(nextMax, storedCur + delta));
        }
      }
      // No derived-before value (adopted manual pool or content that changed
      // out from under the character): leave the stored maximum alone.
    }
    const storedRecovery = cleanString(item.recovery);
    if (after.recovery && storedRecovery !== after.recovery) {
      const beforeRecovery = before ? before.recovery : "";
      if (!storedRecovery || storedRecovery === beforeRecovery) {
        item.recovery = after.recovery;
        itemChanged = true;
      } else {
        report.preserved.push(`${cleanString(item.name) || after.name} recovery — manual setting kept`);
      }
    }
    if (itemChanged) {
      next[index] = item;
      changed = true;
    }
  }
  return changed ? next : null;
}

/**
 * Level-up-specific slot growth: raises each slot row's `total` by the
 * before→after derived delta and moves `used` (which stores currently
 * AVAILABLE slots) by the same delta, clamped to the new total — so spent
 * slots stay spent and only the newly gained capacity arrives available.
 * Pact Magic rows are matched separately (canonical label first, then any
 * "pact" label) because the pact slot level itself can rise on a level-up.
 * Rows the sheet does not have yet are left for the fill-when-empty seeding
 * pass to create. Returns null when nothing changed.
 *
 * @param {Record<string, unknown>} source
 * @param {ReturnType<typeof deriveCharacter>} derivedBefore
 * @param {ReturnType<typeof deriveCharacter>} derivedAfter
 * @returns {Record<string, unknown> | null}
 */
function accumulateSpellSlotTotals(source, derivedBefore, derivedAfter) {
  const after = derivedAfter.spellcasting;
  if (!after) return null;
  const before = derivedBefore.spellcasting;
  const existingSpells = isPlainObject(source.spells) ? source.spells : {};
  const existingLevels = Array.isArray(existingSpells.levels) ? existingSpells.levels : [];
  if (!existingLevels.length) return null;

  const nextLevels = existingLevels.slice();
  let changed = false;

  /**
   * @param {number} index
   * @param {number} delta
   * @param {string | null} nextLabel canonical label rename (pact level rise) or null
   */
  const growRow = (index, delta, nextLabel) => {
    const row = nextLevels[index];
    if (!isPlainObject(row)) return;
    const total = finiteNumberOrNull(row.total);
    if (total == null) return; // untracked row: fill-when-empty seeding owns it
    const nextTotal = total + delta;
    const used = finiteNumberOrNull(row.used);
    /** @type {Record<string, unknown>} */
    const nextRow = { ...row, total: nextTotal };
    if (used != null) {
      nextRow.used = Math.max(0, Math.min(nextTotal, used + delta));
    }
    if (nextLabel && cleanString(row.label) !== nextLabel) nextRow.label = nextLabel;
    nextLevels[index] = nextRow;
    changed = true;
  };

  const findRowByLabel = (label) => {
    const normalized = label.toLowerCase();
    return nextLevels.findIndex((row) =>
      isPlainObject(row) && cleanString(row.label).toLowerCase() === normalized);
  };

  // Standard slot rows.
  for (let slotLevel = 1; slotLevel <= 9; slotLevel += 1) {
    const beforeCount = before?.slots[slotLevel - 1] ?? 0;
    const afterCount = after.slots[slotLevel - 1] ?? 0;
    const delta = afterCount - beforeCount;
    if (!delta) continue;
    const index = findRowByLabel(SPELL_LEVEL_LABELS[slotLevel]);
    if (index >= 0) growRow(index, delta, null);
  }

  // Pact Magic row.
  if (after.pact) {
    const beforePact = before?.pact ?? null;
    const delta = after.pact.slots - (beforePact?.slots ?? 0);
    const labelAfter = `Pact Magic (${SPELL_LEVEL_LABELS[after.pact.slotLevel]})`;
    let index = findRowByLabel(labelAfter);
    if (index < 0 && beforePact) {
      index = findRowByLabel(`Pact Magic (${SPELL_LEVEL_LABELS[beforePact.slotLevel]})`);
    }
    if (index < 0) {
      index = nextLevels.findIndex((row) =>
        isPlainObject(row) && row.hasSlots === true &&
        cleanString(row.label).toLowerCase().includes("pact"));
    }
    if (index >= 0 && delta) growRow(index, delta, labelAfter);
    else if (index >= 0 && !delta && beforePact && beforePact.slotLevel !== after.pact.slotLevel) {
      growRow(index, 0, labelAfter);
    }
  }

  if (!changed) return null;
  return { ...existingSpells, levels: nextLevels };
}

/**
 * Feature text lines gained at exactly the appended character level, plus any
 * feat chosen at that level. Formatted identically to Finish-time seeding so
 * `featureLineDedupKey` keeps re-appends idempotent.
 *
 * @param {ReturnType<typeof deriveCharacter>} derivedBefore
 * @param {ReturnType<typeof deriveCharacter>} derivedAfter
 * @param {number} newCharacterLevel
 * @param {ContentRegistry} registry
 * @returns {string[]}
 */
function getNewLevelFeatureLines(derivedBefore, derivedAfter, newCharacterLevel, registry) {
  /** @type {string[]} */
  const lines = [];
  const seen = new Set();
  for (const feature of derivedAfter.features) {
    if (feature.characterLevel !== newCharacterLevel) continue;
    if (feature.replacedBy && feature.replacedBy.length) continue;
    if (seen.has(feature.featureId)) continue;
    seen.add(feature.featureId);
    const classEntry = getContentByKind(registry, "class", feature.classId);
    const className = classEntry?.name || feature.classId;
    lines.push(featureLine(`${feature.name} (${className} ${feature.classLevel})`, feature.desc));
  }
  const beforeFeatIds = new Set(derivedBefore.featIds);
  for (const featId of derivedAfter.featIds) {
    if (beforeFeatIds.has(featId)) continue;
    const featEntry = getContentByKind(registry, "feat", featId);
    if (featEntry) lines.push(featureLine(`${featEntry.name} (Feat)`, featEntry.data?.desc));
  }
  return lines;
}

/**
 * The Level Up apply patch: exactly the documented level-up deltas, computed
 * as a pure before/after diff. `before` is the character as it exists prior
 * to Apply; `after` is the same character with the leveled-up build swapped
 * in (sheet fields identical). Two update policies apply (level-up spec §6):
 *
 * - **Accumulate** — `hpMax`/`hpCur` and spell-slot `total`/`used` move by
 *   the derived delta, preserving injury, spent slots, and manual offsets.
 * - **Recompute-if-untouched** — `ac`/`spellDC`/`spellAttack` update only
 *   when the stored value still matches the previous derived value; diverged
 *   manual values are kept and reported in `preserved`.
 *
 * Everything else is additive and duplicate-aware: new-level feature text,
 * multiclass proficiency labels, and newly chosen/granted spells append via
 * the same primitives as Finish-time seeding. Nothing here rewrites
 * user-owned content, prepared selections, rest state, or resources.
 *
 * This function must stay separate from `getBuilderFinishSheetSeedPatch` —
 * the accumulate policy is correct only for the Level Up entry point, while
 * Finish/Edit seeding must keep its fill-only-when-empty behavior.
 *
 * @param {unknown} before
 * @param {unknown} after
 * @param {ContentRegistry} [registry]
 * @returns {{
 *   patch: Partial<import("../state.js").CharacterEntry>,
 *   preserved: string[],
 *   warnings: string[]
 * }}
 */
export function getLevelUpSheetSeedPatch(before, after, registry = getActiveContentRegistry()) {
  /** @type {{ patch: Partial<import("../state.js").CharacterEntry>, preserved: string[], warnings: string[] }} */
  const result = { patch: {}, preserved: [], warnings: [] };
  if (!isBuilderCharacter(before) || !isBuilderCharacter(after)) return result;
  const source = /** @type {Record<string, unknown>} */ (after);

  let derivedBefore;
  let derivedAfter;
  try {
    derivedBefore = deriveCharacter(before, registry);
    derivedAfter = deriveCharacter(after, registry);
  } catch (err) {
    console.warn("Level Up sheet patch derivation failed:", err);
    result.warnings.push("Derivation failed — no sheet fields were changed.");
    return result;
  }
  const patch = result.patch;

  // --- HP: calc-aware policies (contract "Structured Vitals"). Legacy
  // characters keep the accumulate-by-derived-delta policy (covers retroactive
  // Con increases, because computeMaxHp applies the Con modifier at every
  // level). A `derived` hpMaxCalc re-derives the flat mirror (adjustment
  // included) and moves current HP by the same delta so a wound gap survives;
  // a `fixed` max is left alone and reported as preserved. Current HP always
  // clamps to a lowered max and temp HP is never touched (it lives in combat
  // state).
  const beforeMax = derivedBefore.hp?.max ?? null;
  const afterMax = derivedAfter.hp?.max ?? null;
  const hpMaxCalc = normalizeHpMaxCalc(source.hpMaxCalc);
  if (hpMaxCalc?.mode === "fixed") {
    const storedMax = finiteNumberOrNull(source.hpMax);
    if (storedMax != null) result.preserved.push(`Max HP ${storedMax} — fixed value kept`);
  } else if (beforeMax != null && afterMax != null) {
    const storedMax = finiteNumberOrNull(source.hpMax);
    if (hpMaxCalc?.mode === "derived") {
      const nextMax = afterMax + hpMaxCalc.adjustment;
      if (nextMax !== storedMax) {
        patch.hpMax = nextMax;
        const storedCur = finiteNumberOrNull(source.hpCur);
        if (storedCur != null) {
          const prevMax = storedMax != null ? storedMax : beforeMax + hpMaxCalc.adjustment;
          const movedCur = storedCur + (nextMax - prevMax);
          patch.hpCur = Math.max(0, Math.min(movedCur, nextMax));
        }
      }
    } else if (storedMax == null) {
      patch.hpMax = afterMax;
      if (finiteNumberOrNull(source.hpCur) == null) patch.hpCur = afterMax;
    } else {
      const delta = afterMax - beforeMax;
      if (delta !== 0) {
        patch.hpMax = storedMax + delta;
        const storedCur = finiteNumberOrNull(source.hpCur);
        if (storedCur != null) patch.hpCur = storedCur + delta;
      }
    }
  } else {
    result.warnings.push("Constitution modifier is not set — max HP was left unchanged.");
  }

  // --- AC / Spell DC / Spell Attack: recompute only when untouched. ---
  /**
   * @param {"ac" | "spellDC" | "spellAttack"} field
   * @param {number | null | undefined} beforeValue
   * @param {number | null | undefined} afterValue
   * @param {string} label
   */
  const recomputeIfUntouched = (field, beforeValue, afterValue, label) => {
    if (afterValue == null) return;
    const stored = finiteNumberOrNull(source[field]);
    if (stored == null) {
      patch[field] = afterValue;
      return;
    }
    if (stored === afterValue) return;
    if (beforeValue != null && stored === beforeValue) {
      patch[field] = afterValue;
      return;
    }
    result.preserved.push(`${label} ${stored} — manual value kept`);
  };
  // Armor Class: calc-aware policies (contract "Structured Vitals") — derived
  // re-derives the flat mirror (adjustment included), fixed is left alone and
  // reported as preserved, and legacy keeps recompute-if-untouched.
  const acCalc = normalizeAcCalc(source.acCalc);
  if (!acCalc) {
    recomputeIfUntouched("ac", derivedBefore.ac?.value, derivedAfter.ac?.value, "Armor Class");
  } else if (acCalc.mode === "derived") {
    if (derivedAfter.ac?.value != null) {
      const acMirror = derivedAfter.ac.value + acCalc.adjustment;
      if (acMirror !== finiteNumberOrNull(source.ac)) patch.ac = acMirror;
    }
  } else {
    const storedAc = finiteNumberOrNull(source.ac);
    if (storedAc != null) result.preserved.push(`Armor Class ${storedAc} — fixed value kept`);
  }

  // Spell DC / attack: characters carrying a structured `spellcastingCalc`
  // block follow the calculation contract instead of recompute-if-untouched —
  // "derived" re-derives (the tiles already display live; this refreshes the
  // flat back-compat mirror, adjustments included), and "fixed" is left alone
  // and reported as preserved. Legacy characters keep the snapshot policy.
  const spellCalc = normalizeSpellcastingCalc(source.spellcastingCalc);
  if (!spellCalc) {
    recomputeIfUntouched("spellDC", derivedBefore.spellcasting?.primary?.saveDc,
      derivedAfter.spellcasting?.primary?.saveDc, "Spell Save DC");
    recomputeIfUntouched("spellAttack", derivedBefore.spellcasting?.primary?.attackBonus,
      derivedAfter.spellcasting?.primary?.attackBonus, "Spell Attack");
  } else {
    const spellModel = getSpellcastingDisplayModel(source, derivedAfter);
    if (spellCalc.mode === "derived") {
      if (spellModel.flat.dc != null && spellModel.flat.dc !== finiteNumberOrNull(source.spellDC)) {
        patch.spellDC = spellModel.flat.dc;
      }
      if (spellModel.flat.attack != null && spellModel.flat.attack !== finiteNumberOrNull(source.spellAttack)) {
        patch.spellAttack = spellModel.flat.attack;
      }
    } else {
      if (spellModel.flat.dc != null) result.preserved.push(`Spell Save DC ${spellModel.flat.dc} — fixed value kept`);
      if (spellModel.flat.attack != null) result.preserved.push(`Spell Attack ${spellModel.flat.attack} — fixed value kept`);
    }
  }

  // --- Spell slots: accumulate existing rows by delta, then run the additive
  // fill-when-empty seeding pass for new rows and newly chosen/granted spells.
  const accumulated = accumulateSpellSlotTotals(source, derivedBefore, derivedAfter);
  const interim = accumulated ? { ...source, spells: accumulated } : source;
  const seededSpells = getSeededSpells(interim, derivedAfter, registry);
  if (seededSpells) {
    patch.spells = /** @type {import("../state.js").CharacterEntry["spells"]} */ (seededSpells);
  } else if (accumulated) {
    patch.spells = /** @type {import("../state.js").CharacterEntry["spells"]} */ (accumulated);
  }

  // --- Class resources: new pools arrive full; existing seeded pools grow by
  // the derived delta with spent uses preserved.
  const accumulatedResources = accumulateClassResources(source, derivedBefore, derivedAfter, result);
  if (accumulatedResources) {
    patch.resources = /** @type {import("../state.js").CharacterEntry["resources"]} */ (accumulatedResources);
  }

  // --- Feature text: only the appended level's features (and new feats). ---
  const newCharacterLevel = normalizeBuildLevels(
    isPlainObject(source.build) ? source.build : {}
  ).length;
  const featureLines = getNewLevelFeatureLines(derivedBefore, derivedAfter, newCharacterLevel, registry);
  if (featureLines.length) {
    const existingFeatures = existingText(source.features);
    const nextFeatures = appendMissingFeatureLines(existingFeatures, featureLines);
    if (nextFeatures !== existingFeatures) patch.features = nextFeatures;
  }

  // --- Proficiency labels: additive; new entries only appear when the level
  // added a class with multiclass proficiencies or a new skill-backed grant.
  const proficiencyLabels = getProficiencyLabels(derivedAfter, registry);
  const proficiencyFields = /** @type {const} */ ([
    ["armorProf", proficiencyLabels.armor],
    ["weaponProf", proficiencyLabels.weapons],
    ["toolProf", proficiencyLabels.tools]
  ]);
  for (const [field, labels] of proficiencyFields) {
    if (!labels.length) continue;
    const existingValue = existingText(source[field]);
    const nextValue = appendMissingListLabels(existingValue, labels);
    if (nextValue !== existingValue) patch[field] = nextValue;
  }

  return result;
}

/**
 * Returns the **spells-only** patch for a Long Rest that actively recommitted
 * one or more prepared classes (Prepared Sheet Synchronization, C1.1).
 *
 * This deliberately does *not* run the full Finish seed patch. A Long Rest is
 * play-state, not creation: it must never restore or alter features,
 * languages, proficiencies, attacks, inventory pockets, resources, HP, AC, or
 * calculation metadata that the player has since edited or deleted. Only the
 * spells bucket — the thing the player just changed — is returned.
 *
 * Within that bucket the behavior is the established seeding contract: newly
 * prepared spells gain a row, slot rows/totals fill when empty, and the
 * recommitted classes' ordinary rows are synchronized in both directions.
 *
 * Call with the character **after** the prepared commit, so the plan reads the
 * new `rest.preparedByClass`.
 *
 * @param {unknown} character post-commit character
 * @param {readonly string[]} preparedClassIds classes actively recommitted
 * @param {ContentRegistry} [registry]
 * @returns {{ spells: import("../state.js").CharacterEntry["spells"] } | null} null when nothing changed
 */
export function getLongRestPreparedSheetPatch(character, preparedClassIds, registry = getActiveContentRegistry()) {
  if (!isBuilderCharacter(character)) return null;
  const classIds = [...new Set(
    (Array.isArray(preparedClassIds) ? preparedClassIds : []).map(cleanString).filter(Boolean)
  )];
  if (!classIds.length) return null;

  let derived;
  try {
    derived = deriveCharacter(character, registry);
  } catch (err) {
    console.warn("Long Rest prepared sheet sync derivation failed:", err);
    return null;
  }

  const source = /** @type {Record<string, unknown>} */ (character);
  const seededSpells = getSeededSpells(source, derived, registry, classIds);
  if (!seededSpells) return null;
  return { spells: /** @type {import("../state.js").CharacterEntry["spells"]} */ (seededSpells) };
}

/**
 * Returns the **spells-only** patch for a max-level spellbook correction — the
 * Add Spellbook Choices flow (`js/pages/character/spellbookChoicesFlow.js`).
 *
 * Same reasoning as `getLongRestPreparedSheetPatch()` above, for the same
 * reason: the full Finish patch would silently restore features, languages,
 * proficiencies, attacks, inventory pockets, resources, HP, AC, or calculation
 * metadata the player has since edited or deleted (the C1.1 defect). A
 * spellbook correction changes exactly one thing — which spells are in the
 * spellbook — so only the spells bucket is returned.
 *
 * Within that bucket the behavior is the established additive seeding contract:
 * a newly stored spellbook id gains a row carrying its `builderSpellId` marker
 * at `prepared: false`, existing rows keep every field, and no row is created
 * for anything the build does not hold. No prepared-row synchronization is
 * requested (`syncPreparedClassIds` stays null), so `rest.preparedByClass` is
 * neither read as an authority here nor projected onto rows.
 *
 * Call with the character **after** the `build.spellcasting[classId].knownIds`
 * write, so the seeder sees the new entries.
 *
 * @param {unknown} character post-write character
 * @param {ContentRegistry} [registry]
 * @returns {{ spells: import("../state.js").CharacterEntry["spells"] } | null} null when nothing changed
 */
export function getSpellbookAdditionSheetPatch(character, registry = getActiveContentRegistry()) {
  if (!isBuilderCharacter(character)) return null;

  let derived;
  try {
    derived = deriveCharacter(character, registry);
  } catch (err) {
    console.warn("Spellbook addition sheet seeding derivation failed:", err);
    return null;
  }

  const source = /** @type {Record<string, unknown>} */ (character);
  const seededSpells = getSeededSpells(source, derived, registry);
  if (!seededSpells) return null;
  return { spells: /** @type {import("../state.js").CharacterEntry["spells"]} */ (seededSpells) };
}

/**
 * Returns the character field values to seed at wizard Finish (create and
 * edit). Seeded values are user-owned after creation; the patch only adds
 * missing content and fills empty vitals.
 *
 * @param {unknown} character
 * @param {ContentRegistry} [registry]
 * @returns {Partial<import("../state.js").CharacterEntry>}
 */
export function getBuilderFinishSheetSeedPatch(character, registry = getActiveContentRegistry()) {
  if (!isBuilderCharacter(character)) return {};
  const source = /** @type {Record<string, unknown>} */ (character);
  const build = isPlainObject(source.build) ? source.build : {};

  let derived;
  try {
    derived = deriveCharacter(character, registry);
  } catch (err) {
    console.warn("Builder sheet seeding derivation failed:", err);
    return {};
  }

  const raceEntry = getContentByKind(registry, "race", cleanString(build.raceId).replace(/^race_/, ""));
  const subraceEntry = getContentByKind(registry, "subrace", cleanString(build.subraceId));
  const backgroundEntry = getContentByKind(
    registry,
    "background",
    cleanString(build.backgroundId).replace(/^background_/, "")
  );

  const patch = /** @type {Partial<import("../state.js").CharacterEntry>} */ ({});

  // Features text: Dragonborn slice first (existing contract), then race
  // trait names, class/subclass/feat features, and the background feature.
  const featureLines = [
    ...getDragonbornFeatureLines(derived, raceEntry),
    ...getRaceTraitLines(registry, raceEntry, subraceEntry),
    ...getClassAndBackgroundFeatureLines(derived, registry, backgroundEntry)
  ];
  if (featureLines.length) {
    const existingFeatures = existingText(source.features);
    const nextFeatures = appendMissingFeatureLines(existingFeatures, featureLines);
    if (nextFeatures !== existingFeatures) patch.features = nextFeatures;
  }

  // Languages (race fixed + chosen).
  const languageLabels = derived.proficiencies.languages
    .map((id) => getContentByKind(registry, "language", id)?.name || titleCaseWords(id))
    .filter(Boolean);
  if (languageLabels.length) {
    const existingLanguages = existingText(source.languages);
    const nextLanguages = appendMissingListLabels(existingLanguages, languageLabels);
    if (nextLanguages !== existingLanguages) patch.languages = nextLanguages;
  }

  // Armor / weapon / tool proficiency text fields.
  const proficiencyLabels = getProficiencyLabels(derived, registry);
  const proficiencyFields = /** @type {const} */ ([
    ["armorProf", proficiencyLabels.armor],
    ["weaponProf", proficiencyLabels.weapons],
    ["toolProf", proficiencyLabels.tools]
  ]);
  for (const [field, labels] of proficiencyFields) {
    if (!labels.length) continue;
    const existingValue = existingText(source[field]);
    const nextValue = appendMissingListLabels(existingValue, labels);
    if (nextValue !== existingValue) patch[field] = nextValue;
  }

  // Vitals: fill only when empty; existing user values are never replaced.
  // Max HP (calculation contract "Structured Vitals"): builder characters get
  // a derived `hpMaxCalc` block stamped so the tile derives live — but only
  // when doing so cannot change the displayed value (stored max empty or equal
  // to the derivation). A diverged legacy max (a manual edit under the old
  // snapshot model) stays a legacy snapshot until adopted through the editor.
  // In derived mode the flat `hpMax` is refreshed as the displayed-value
  // mirror; when that lowers the max below current HP, current HP clamps down.
  const existingHpMaxCalc = normalizeHpMaxCalc(source.hpMaxCalc);
  const storedHpMax = finiteNumberOrNull(source.hpMax);
  if (derived.hp?.max != null && !existingHpMaxCalc && (storedHpMax == null || storedHpMax === derived.hp.max)) {
    patch.hpMaxCalc = /** @type {import("../state.js").CharacterEntry["hpMaxCalc"]} */ (buildDerivedHpMaxCalc());
  }
  if (existingHpMaxCalc?.mode === "derived" && derived.hp?.max != null) {
    const hpMirror = derived.hp.max + existingHpMaxCalc.adjustment;
    if (hpMirror !== storedHpMax) {
      patch.hpMax = hpMirror;
      const storedCur = finiteNumberOrNull(source.hpCur);
      const clamped = clampCurrentHpToMax(storedCur, hpMirror);
      if (clamped !== storedCur) patch.hpCur = clamped;
    }
  } else if (derived.hp?.max != null && storedHpMax == null) {
    patch.hpMax = derived.hp.max;
    if (finiteNumberOrNull(source.hpCur) == null) patch.hpCur = derived.hp.max;
  }
  // Armor Class (calculation contract "Structured Vitals"): builder characters
  // get a derived `acCalc` block stamped so the AC tile derives live from
  // creation onward — but only when doing so cannot change what the user sees:
  // the flat `ac` must be empty or already equal to the current derived value.
  // A diverged legacy value (a manual edit under the old snapshot model) stays
  // a legacy snapshot until the user adopts a calculation through the editor.
  // An existing block (adopted fixed/derived, edited adjustment) is never
  // overwritten; in derived mode the flat field is refreshed as the
  // displayed-value mirror (Edit in Builder can change Dex/armor/shield).
  const existingAcCalc = normalizeAcCalc(source.acCalc);
  const storedAc = finiteNumberOrNull(source.ac);
  if (derived.ac?.value != null && !existingAcCalc && (storedAc == null || storedAc === derived.ac.value)) {
    patch.acCalc = /** @type {import("../state.js").CharacterEntry["acCalc"]} */ (buildDerivedAcCalc());
  }
  if (existingAcCalc?.mode === "derived" && derived.ac?.value != null) {
    const acMirror = derived.ac.value + existingAcCalc.adjustment;
    if (acMirror !== storedAc) patch.ac = acMirror;
  } else if (derived.ac?.value != null && storedAc == null) {
    patch.ac = derived.ac.value;
  }
  // Spell DC / attack (calculation contract "Structured Vitals"). Builder
  // casters — and non-casters with a granted-spell source such as a High Elf's
  // Intelligence cantrip — get a derived `spellcastingCalc` block stamped so
  // the tiles derive live from creation onward (the attack-`calc` precedent) —
  // but only when doing so cannot change what the user sees: each flat field
  // must be empty or already equal to the current derived primary value.
  // Diverged legacy values (manual edits under the old snapshot model) stay
  // legacy snapshots until adopted through the editor. An existing block is
  // never overwritten on a re-seed. The flat spellDC/spellAttack fields stay a
  // fill-when-empty back-compat mirror of the primary profile.
  const spellcastingModel = getSpellcastingDisplayModel(
    { ...source, spellcastingCalc: normalizeSpellcastingCalc(source.spellcastingCalc) || buildDerivedSpellcastingCalc() },
    derived
  );
  if (spellcastingModel.hasDerivableSources) {
    const existingSpellCalc = normalizeSpellcastingCalc(source.spellcastingCalc);
    const storedDc = finiteNumberOrNull(source.spellDC);
    const storedAttack = finiteNumberOrNull(source.spellAttack);
    const dcAdoptable = storedDc == null || storedDc === spellcastingModel.flat.dc;
    const attackAdoptable = storedAttack == null || storedAttack === spellcastingModel.flat.attack;
    if (!existingSpellCalc && dcAdoptable && attackAdoptable) {
      patch.spellcastingCalc = /** @type {import("../state.js").CharacterEntry["spellcastingCalc"]} */ (
        buildDerivedSpellcastingCalc()
      );
    }
    if (existingSpellCalc?.mode === "derived") {
      // Displayed-value mirror refresh: Edit in Builder can change the
      // spellcasting ability scores or sources.
      if (spellcastingModel.flat.dc != null && spellcastingModel.flat.dc !== storedDc) {
        patch.spellDC = spellcastingModel.flat.dc;
      }
      if (spellcastingModel.flat.attack != null && spellcastingModel.flat.attack !== storedAttack) {
        patch.spellAttack = spellcastingModel.flat.attack;
      }
    } else {
      if (spellcastingModel.flat.dc != null && storedDc == null) {
        patch.spellDC = spellcastingModel.flat.dc;
      }
      if (spellcastingModel.flat.attack != null && storedAttack == null) {
        patch.spellAttack = spellcastingModel.flat.attack;
      }
    }
  }

  // Weapons → attack rows.
  const seededAttacks = getSeededAttacks(source, derived, registry);
  if (seededAttacks) patch.attacks = /** @type {import("../state.js").CharacterEntry["attacks"]} */ (seededAttacks);

  // Spell slots + chosen/granted spells → sheet spells model.
  const seededSpells = getSeededSpells(source, derived, registry);
  if (seededSpells) patch.spells = /** @type {import("../state.js").CharacterEntry["spells"]} */ (seededSpells);

  // Class-resource pools → Vitals resource tiles (additive, fill-when-empty).
  const seededResources = getSeededResources(source, derived);
  if (seededResources) {
    patch.resources = /** @type {import("../state.js").CharacterEntry["resources"]} */ (seededResources);
  }

  // Starting equipment → inventory pockets. Loose gear joins the general
  // inventory pocket; each equipment pack becomes its own pocket listing that
  // pack's SRD contents. Seeding is additive and pocket titles are never
  // auto-renamed, so user edits survive re-seeding in edit mode.
  const { looseLines, packs } = getStartingEquipment(source, registry);
  if (looseLines.length || packs.length) {
    const existingItems = Array.isArray(source.inventoryItems) ? source.inventoryItems : [];
    const nextItems = existingItems.slice();
    let inventoryChanged = false;

    /**
     * @param {number} index
     * @param {string[]} lines
     * @param {string} marker
     * @param {string} newPocketTitle
     */
    const seedPocket = (index, lines, marker, newPocketTitle) => {
      if (!lines.length) return;
      if (index >= 0) {
        const existingItem = /** @type {Record<string, unknown>} */ (nextItems[index]);
        const existingNotes = existingText(existingItem.notes);
        const nextNotes = appendMissingLines(existingNotes, lines);
        const needsMarker = cleanString(existingItem.builderSeed) !== marker;
        if (nextNotes === existingNotes && !needsMarker) return;
        // Keep the user's pocket title; only append gear and stamp the marker.
        nextItems[index] = { ...existingItem, notes: nextNotes, builderSeed: marker };
      } else {
        nextItems.push({ id: newSeedId("inv"), title: newPocketTitle, notes: lines.join("\n"), builderSeed: marker });
      }
      inventoryChanged = true;
    };

    seedPocket(findLooseGearPocketIndex(nextItems), looseLines, STARTING_GEAR_SEED_MARKER, "Inventory");

    for (const pack of packs) {
      const marker = `${PACK_SEED_MARKER_PREFIX}${pack.id}`;
      const index = nextItems.findIndex((item) =>
        isPlainObject(item) && cleanString(item.builderSeed) === marker);
      seedPocket(index, pack.lines, marker, pack.name);
    }

    if (inventoryChanged) {
      patch.inventoryItems = /** @type {import("../state.js").CharacterEntry["inventoryItems"]} */ (nextItems);
    }
  }

  return patch;
}
