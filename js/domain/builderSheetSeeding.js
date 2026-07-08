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
import { deriveCharacter } from "./rules/deriveCharacter.js";
import { getActiveContentRegistry, getContentByKind } from "./rules/registry.js";
import { normalizeBuildLevels } from "./rules/progression.js";

/** @typedef {import("./rules/registry.js").ContentRegistry} ContentRegistry */

const SPELL_LEVEL_LABELS = Object.freeze([
  "Cantrips", "1st Level", "2nd Level", "3rd Level", "4th Level",
  "5th Level", "6th Level", "7th Level", "8th Level", "9th Level"
]);

// Stable marker stamped on the inventory pocket seeded from starting equipment
// so re-seeds and edits find it again even after the user renames the pocket.
const STARTING_GEAR_SEED_MARKER = "starting-gear";

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
  const existingNames = new Set(
    existing
      .filter(isPlainObject)
      .map((attack) => cleanString(attack.name).toLowerCase())
      .filter(Boolean)
  );

  const strMod = derived.abilities.str?.modifier;
  const dexMod = derived.abilities.dex?.modifier;
  const prof = derived.proficiencyBonus ?? 0;

  /** @type {Array<Record<string, unknown>>} */
  const additions = [];
  const seen = new Set();
  for (const weaponId of weaponIds) {
    const weapon = getContentByKind(registry, "weapon", cleanString(weaponId));
    if (!weapon || seen.has(weapon.id)) continue;
    seen.add(weapon.id);
    if (existingNames.has(weapon.name.toLowerCase())) continue;
    const data = weapon.data || {};
    const properties = Array.isArray(data.properties) ? data.properties : [];
    const isRanged = data.attackType === "ranged";
    const finesse = properties.includes("finesse");
    /** @type {number | null} */
    let mod = null;
    if (isRanged) mod = dexMod ?? null;
    else if (finesse && strMod != null && dexMod != null) mod = Math.max(strMod, dexMod);
    else mod = strMod ?? null;

    const bonus = mod != null ? signedNumber(mod + prof) : "";
    const damageDice = cleanString(data.damage);
    const damageType = titleCaseWords(cleanString(data.damageType));
    const damage = damageDice
      ? `${damageDice}${mod ? signedNumber(mod) : ""}`
      : "";
    let range = "Melee";
    if (isRanged && isPlainObject(data.range) && data.range.normal != null) {
      range = `${data.range.normal}${data.range.long != null ? `/${data.range.long}` : ""} ft.`;
    } else if (isPlainObject(data.throwRange) && data.throwRange.normal != null) {
      range = `Melee, thrown ${data.throwRange.normal}${data.throwRange.long != null ? `/${data.throwRange.long}` : ""} ft.`;
    }
    additions.push({
      id: newSeedId("atk"),
      name: weapon.name,
      bonus,
      damage,
      range,
      type: damageType
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
 * Seeds the sheet spells model: slot totals per level plus chosen and
 * granted spells. Existing levels/spells and slot usage are preserved.
 * @param {Record<string, unknown>} source
 * @param {ReturnType<typeof deriveCharacter>} derived
 * @param {ContentRegistry} registry
 * @returns {Record<string, unknown> | null} full replacement spells object or null when unchanged
 */
function getSeededSpells(source, derived, registry) {
  const spellcasting = derived.spellcasting;
  if (!spellcasting) return null;
  const build = isPlainObject(source.build) ? source.build : {};
  const selections = isPlainObject(build.spellcasting) ? build.spellcasting : {};

  /** @type {Map<number, { names: Map<string, { prepared: boolean }> }>} */
  const seedByLevel = new Map();
  const addSpell = (spellId, { prepared }) => {
    const spellEntry = getContentByKind(registry, "spell", cleanString(spellId));
    if (!spellEntry) return;
    const level = Number(spellEntry.data?.level) || 0;
    if (!seedByLevel.has(level)) seedByLevel.set(level, { names: new Map() });
    const bucket = /** @type {{ names: Map<string, { prepared: boolean }> }} */ (seedByLevel.get(level));
    const existingSeed = bucket.names.get(spellEntry.name);
    bucket.names.set(spellEntry.name, { prepared: (existingSeed?.prepared ?? false) || prepared });
  };

  for (const selection of Object.values(selections)) {
    if (!isPlainObject(selection)) continue;
    for (const id of Array.isArray(selection.cantripIds) ? selection.cantripIds : []) addSpell(id, { prepared: false });
    for (const id of Array.isArray(selection.knownIds) ? selection.knownIds : []) addSpell(id, { prepared: false });
    for (const id of Array.isArray(selection.preparedIds) ? selection.preparedIds : []) addSpell(id, { prepared: true });
  }
  for (const grant of derived.grantedSpells) addSpell(grant.spellId, { prepared: true });

  const slotLevels = spellcasting.slots
    .map((count, index) => ({ level: index + 1, count }))
    .filter((slot) => slot.count > 0);

  if (!seedByLevel.size && !slotLevels.length && !spellcasting.pact) return null;

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
  if (spellcasting.pact) {
    const level = ensureLevel(`Pact Magic (${SPELL_LEVEL_LABELS[spellcasting.pact.slotLevel]})`, true);
    if (finiteNumberOrNull(level.total) == null) {
      level.total = spellcasting.pact.slots;
      if (finiteNumberOrNull(level.used) == null) level.used = spellcasting.pact.slots;
      changed = true;
    }
  }

  for (const [spellLevel, bucket] of [...seedByLevel.entries()].sort((a, b) => a[0] - b[0])) {
    const isPact = spellcasting.pact && spellcasting.classes.length === 1 &&
      spellcasting.classes[0].progression === "pact" && spellLevel > 0;
    const label = isPact && spellcasting.pact
      ? `Pact Magic (${SPELL_LEVEL_LABELS[spellcasting.pact.slotLevel]})`
      : SPELL_LEVEL_LABELS[spellLevel];
    const level = ensureLevel(label, spellLevel > 0);
    const spells = Array.isArray(level.spells) ? level.spells : [];
    const existingNames = new Set(
      spells.filter(isPlainObject).map((spell) => cleanString(spell.name).toLowerCase())
    );
    for (const [name, meta] of bucket.names) {
      if (existingNames.has(name.toLowerCase())) continue;
      spells.push({
        id: newSeedId("spell"),
        name,
        notesCollapsed: true,
        known: true,
        prepared: meta.prepared,
        expended: false
      });
      changed = true;
    }
    level.spells = spells;
  }

  // Enforce cantrips-first, then ascending level order (pact after its number)
  // for the seeded/derived levels; unrecognized custom levels stay put.
  const ordered = sortSpellLevelsCanonically(nextLevels);

  if (!changed && !ordered.reordered) return null;
  return { ...existingSpells, levels: ordered.levels };
}

/**
 * Starting gear lines for the inventory "Starting Gear" tab.
 * @param {Record<string, unknown>} source
 * @param {ContentRegistry} registry
 * @returns {string[]}
 */
function getStartingGearLines(source, registry) {
  const build = isPlainObject(source.build) ? source.build : {};
  const equipment = isPlainObject(build.equipment) ? build.equipment : {};
  /** @type {string[]} */
  const lines = [];

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
      const name = cleanString(item.name) || cleanString(item.itemId);
      if (!name) continue;
      const quantity = Number(item.quantity) > 1 ? ` ×${item.quantity}` : "";
      lines.push(`${name}${quantity}`);
    }
  }

  const startingChoices = isPlainObject(equipment.startingChoices) ? equipment.startingChoices : {};
  for (const choice of Object.values(startingChoices)) {
    if (!isPlainObject(choice)) continue;
    const label = cleanString(choice.label);
    if (label) lines.push(label);
  }

  const armorEntry = getContentByKind(registry, "armor", cleanString(equipment.armorId));
  if (armorEntry) lines.push(armorEntry.name);
  if (equipment.shield === true) lines.push("Shield");
  for (const weaponId of Array.isArray(equipment.weaponIds) ? equipment.weaponIds : []) {
    const weapon = getContentByKind(registry, "weapon", cleanString(weaponId));
    if (weapon) lines.push(weapon.name);
  }
  for (const note of cleanString(equipment.notes).split(/\r?\n/)) {
    if (note.trim()) lines.push(note.trim());
  }
  return lines;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isPackName(value) {
  return typeof value === "string" && value.trim().toLowerCase().endsWith(" pack");
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isPackItemId(value) {
  return typeof value === "string" && /-pack$/.test(value.trim().toLowerCase());
}

/**
 * Distinct equipment-pack names (e.g. "Explorer's Pack") seeded from the first
 * class and background — fixed starting equipment and chosen options both.
 * @param {Record<string, unknown>} source
 * @param {ContentRegistry} registry
 * @returns {string[]}
 */
function getStartingGearPackNames(source, registry) {
  const build = isPlainObject(source.build) ? source.build : {};
  const equipment = isPlainObject(build.equipment) ? build.equipment : {};
  /** @type {string[]} */
  const packs = [];
  const seen = new Set();
  const addPack = (name) => {
    const clean = cleanString(name);
    if (!clean || seen.has(clean.toLowerCase())) return;
    seen.add(clean.toLowerCase());
    packs.push(clean);
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
      if (isPackItemId(item.itemId) || isPackName(item.name)) addPack(cleanString(item.name) || cleanString(item.itemId));
    }
  }

  const startingChoices = isPlainObject(equipment.startingChoices) ? equipment.startingChoices : {};
  for (const choice of Object.values(startingChoices)) {
    if (!isPlainObject(choice)) continue;
    if (isPackItemId(choice.itemId) || isPackName(choice.label)) addPack(cleanString(choice.label));
  }

  return packs;
}

/**
 * Pocket title for seeded starting gear: the pack name when a single pack is
 * present, packs joined when several, else the generic fallback.
 * @param {string[]} packNames
 * @returns {string}
 */
function getStartingGearPocketTitle(packNames) {
  if (packNames.length === 1) return packNames[0];
  if (packNames.length > 1) return packNames.join(" & ");
  return "Starting Gear";
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
  if (derived.hp?.max != null && finiteNumberOrNull(source.hpMax) == null) {
    patch.hpMax = derived.hp.max;
    if (finiteNumberOrNull(source.hpCur) == null) patch.hpCur = derived.hp.max;
  }
  if (derived.ac?.value != null && finiteNumberOrNull(source.ac) == null) {
    patch.ac = derived.ac.value;
  }
  const primaryCaster = derived.spellcasting?.primary ?? null;
  if (primaryCaster) {
    if (primaryCaster.saveDc != null && finiteNumberOrNull(source.spellDC) == null) {
      patch.spellDC = primaryCaster.saveDc;
    }
    if (primaryCaster.attackBonus != null && finiteNumberOrNull(source.spellAttack) == null) {
      patch.spellAttack = primaryCaster.attackBonus;
    }
  }

  // Weapons → attack rows.
  const seededAttacks = getSeededAttacks(source, derived, registry);
  if (seededAttacks) patch.attacks = /** @type {import("../state.js").CharacterEntry["attacks"]} */ (seededAttacks);

  // Spell slots + chosen/granted spells → sheet spells model.
  const seededSpells = getSeededSpells(source, derived, registry);
  if (seededSpells) patch.spells = /** @type {import("../state.js").CharacterEntry["spells"]} */ (seededSpells);

  // Starting gear → dedicated inventory pocket, named after the source pack(s)
  // when known (e.g. "Explorer's Pack"), else the generic "Starting Gear".
  const gearLines = getStartingGearLines(source, registry);
  if (gearLines.length) {
    const existingItems = Array.isArray(source.inventoryItems) ? source.inventoryItems : [];
    const pocketTitle = getStartingGearPocketTitle(getStartingGearPackNames(source, registry));
    // Locate the previously seeded pocket by its stable marker first (survives
    // user renames), then fall back to the legacy "Starting Gear" title for
    // pockets seeded before the marker existed. User-created pockets are never
    // matched, so they are never touched or renamed.
    let gearIndex = existingItems.findIndex((item) =>
      isPlainObject(item) && cleanString(item.builderSeed) === STARTING_GEAR_SEED_MARKER);
    if (gearIndex < 0) {
      gearIndex = existingItems.findIndex((item) =>
        isPlainObject(item) && !cleanString(item.builderSeed)
        && cleanString(item.title).toLowerCase() === "starting gear");
    }
    const existingItem = gearIndex >= 0 && isPlainObject(existingItems[gearIndex])
      ? /** @type {Record<string, unknown>} */ (existingItems[gearIndex])
      : null;
    const existingNotes = existingItem ? existingText(existingItem.notes) : "";
    const nextNotes = appendMissingLines(existingNotes, gearLines);
    const needsMarker = !!existingItem && cleanString(existingItem.builderSeed) !== STARTING_GEAR_SEED_MARKER;
    if (nextNotes !== existingNotes || needsMarker) {
      const nextItems = existingItems.slice();
      if (existingItem) {
        // Keep the user's pocket title (never auto-rename); append missing gear
        // and stamp the marker so future re-seeds find it after a rename.
        nextItems[gearIndex] = { ...existingItem, notes: nextNotes, builderSeed: STARTING_GEAR_SEED_MARKER };
      } else {
        nextItems.push({ id: newSeedId("inv"), title: pocketTitle, notes: nextNotes, builderSeed: STARTING_GEAR_SEED_MARKER });
      }
      patch.inventoryItems = /** @type {import("../state.js").CharacterEntry["inventoryItems"]} */ (nextItems);
    }
  }

  return patch;
}
