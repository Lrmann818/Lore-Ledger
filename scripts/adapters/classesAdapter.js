// @ts-check
// scripts/adapters/classesAdapter.js
//
// Transforms dnd5eapi /api/2014/classes (+ per-class /levels) into the
// Lore Ledger classes.json schema.
//
// Output schema per entry:
//   id                       — stable kebab-case id ("wizard")
//   kind                     — "class"
//   name                     — display name
//   source                   — always "srd-5.1"
//   hitDie                   — 6 | 8 | 10 | 12
//   savingThrowProficiencies — ["int", "wis"]
//   armorProficiencies       — normalized ("light" | "medium" | "heavy" | "shield")
//   weaponProficiencies      — "simple" | "martial" | specific weapon ids
//   toolProficiencies        — tool proficiency ids
//   skillChoices             — { choose, from: [skill ids] }
//   subclassIds              — subclass ids for this class
//   subclassLevel            — class level at which the subclass is chosen
//   asiLevels                — class levels granting an Ability Score Improvement
//   featuresByLevel          — { "<classLevel>": [feature ids] }
//   classSpecificByLevel     — { "<classLevel>": { rage_count: … } } (only levels with data)
//   spellcasting             — null, or:
//     { ability, startLevel, preparationMode, progression, ritualCasting,
//       cantripsKnownByLevel, spellsKnownByLevel, slotsByLevel }
//     slotsByLevel is a 20-entry array of 9-entry arrays (slot counts by slot level).
//   multiclassing            — { prerequisites, prerequisiteOptions, proficiencies:
//                                { armor, weapons, tools }, skillChoices }
//   startingEquipment        — [{ itemId, name, quantity }]
//   startingEquipmentOptions — [{ desc, choose, options: [EquipmentOption] }]
//     EquipmentOption is one of:
//       { itemId, name, quantity }
//       { categoryId, categoryName, itemOptions: [{ itemId, name }] }
//       { items: [{ itemId, name, quantity }] }  (bundle picked as one option)

import {
  apiFetch,
  apiFetchAll,
  classifyProficiencies,
  joinDesc,
  normalizeAbilityPrerequisites,
  normalizeRegistryId,
  skillIdFromProficiency
} from "./apiUtil.js";

// SRD 5.1 spellcasting behavior that is not derivable from the API data
// alone. Build-time, auditable mapping — see docs/reference/content-registry-plan.md.
const SPELLCASTING_META = {
  bard: { preparationMode: "known", progression: "full", ritualCasting: true },
  cleric: { preparationMode: "prepared", progression: "full", ritualCasting: true },
  druid: { preparationMode: "prepared", progression: "full", ritualCasting: true },
  paladin: { preparationMode: "prepared", progression: "half", ritualCasting: false },
  ranger: { preparationMode: "known", progression: "half", ritualCasting: false },
  sorcerer: { preparationMode: "known", progression: "full", ritualCasting: false },
  warlock: { preparationMode: "known", progression: "pact", ritualCasting: false },
  wizard: { preparationMode: "spellbook", progression: "full", ritualCasting: true }
};

/**
 * @param {any} skillChoiceRaw
 * @returns {{ choose: number, from: string[] } | null}
 */
function normalizeSkillChoice(skillChoiceRaw) {
  const choose = Number(skillChoiceRaw?.choose);
  const options = skillChoiceRaw?.from?.options;
  if (!Number.isInteger(choose) || choose < 1 || !Array.isArray(options)) return null;
  const from = [];
  for (const option of options) {
    const skill = skillIdFromProficiency(option?.item?.index);
    if (skill && !from.includes(skill)) from.push(skill);
  }
  return from.length ? { choose, from } : null;
}

/**
 * Resolve an equipment-category reference into an inline option list so the
 * app never needs the network at runtime.
 * @param {Map<string, Array<{ itemId: string, name: string }>>} categoryCache
 * @param {any} categoryRef
 * @returns {Promise<{ categoryId: string, categoryName: string, itemOptions: Array<{ itemId: string, name: string }> } | null>}
 */
async function resolveEquipmentCategory(categoryCache, categoryRef) {
  const categoryId = normalizeRegistryId(categoryRef?.index);
  const categoryName = typeof categoryRef?.name === "string" ? categoryRef.name : "";
  if (!categoryId) return null;
  if (!categoryCache.has(categoryId)) {
    const raw = await apiFetch(`/equipment-categories/${categoryId}`);
    const itemOptions = [];
    for (const item of raw?.equipment ?? []) {
      // Magic items live under /magic-items/ and are out of builder scope.
      if (typeof item?.url === "string" && !item.url.startsWith("/api/2014/equipment/")) continue;
      const itemId = normalizeRegistryId(item?.index);
      if (!itemId) continue;
      itemOptions.push({ itemId, name: String(item?.name ?? itemId) });
    }
    categoryCache.set(categoryId, itemOptions);
  }
  return {
    categoryId,
    categoryName,
    itemOptions: categoryCache.get(categoryId) ?? []
  };
}

/**
 * Normalize one starting-equipment option (recursive over API option types).
 * @param {Map<string, Array<{ itemId: string, name: string }>>} categoryCache
 * @param {any} option
 * @returns {Promise<object | null>}
 */
async function normalizeEquipmentOption(categoryCache, option) {
  const type = option?.option_type;
  if (type === "reference") {
    const itemId = normalizeRegistryId(option?.item?.index);
    if (!itemId) return null;
    return { itemId, name: String(option?.item?.name ?? itemId), quantity: 1 };
  }
  if (type === "counted_reference") {
    const itemId = normalizeRegistryId(option?.of?.index);
    if (!itemId) return null;
    const quantity = Number.isInteger(Number(option?.count)) ? Number(option.count) : 1;
    return { itemId, name: String(option?.of?.name ?? itemId), quantity };
  }
  if (type === "choice") {
    const categoryRef = option?.choice?.from?.equipment_category;
    if (categoryRef) return resolveEquipmentCategory(categoryCache, categoryRef);
    return option?.choice?.desc ? { desc: String(option.choice.desc) } : null;
  }
  if (type === "multiple") {
    const items = [];
    for (const nested of option?.items ?? []) {
      const normalized = await normalizeEquipmentOption(categoryCache, nested);
      if (normalized) items.push(normalized);
    }
    return items.length ? { items } : null;
  }
  return null;
}

/**
 * @param {Map<string, Array<{ itemId: string, name: string }>>} categoryCache
 * @param {any[]} optionsRaw
 * @returns {Promise<object[]>}
 */
async function normalizeStartingEquipmentOptions(categoryCache, optionsRaw) {
  const out = [];
  for (const group of optionsRaw ?? []) {
    const choose = Number.isInteger(Number(group?.choose)) ? Number(group.choose) : 1;
    const desc = typeof group?.desc === "string" ? group.desc : "";
    const fromRaw = group?.from;
    /** @type {object[]} */
    const options = [];
    if (fromRaw?.option_set_type === "options_array") {
      for (const option of fromRaw.options ?? []) {
        const normalized = await normalizeEquipmentOption(categoryCache, option);
        if (normalized) options.push(normalized);
      }
    } else if (fromRaw?.option_set_type === "equipment_category") {
      const category = await resolveEquipmentCategory(categoryCache, fromRaw.equipment_category);
      if (category) options.push(category);
    }
    if (options.length || desc) out.push({ desc, choose, options });
  }
  return out;
}

/**
 * @param {any} multiRaw
 * @returns {object}
 */
function normalizeMulticlassing(multiRaw) {
  const prerequisites = normalizeAbilityPrerequisites(multiRaw?.prerequisites);
  /** @type {Array<{ ability: string, minimum: number }>} */
  const prerequisiteOptions = [];
  const optionsRaw = multiRaw?.prerequisite_options?.from?.options;
  if (Array.isArray(optionsRaw)) {
    for (const option of optionsRaw) {
      const ability = normalizeRegistryId(option?.ability_score?.index);
      const minimum = Number(option?.minimum_score);
      if (ability && Number.isFinite(minimum)) prerequisiteOptions.push({ ability, minimum });
    }
  }
  const buckets = classifyProficiencies(multiRaw?.proficiencies ?? []);
  const skillChoices = Array.isArray(multiRaw?.proficiency_choices)
    ? multiRaw.proficiency_choices.map(normalizeSkillChoice).find(Boolean) ?? null
    : null;
  return {
    prerequisites,
    prerequisiteOptions,
    proficiencies: {
      armor: buckets.armor,
      weapons: buckets.weapons,
      tools: buckets.tools
    },
    skillChoices
  };
}

/**
 * Build per-level structures from the /classes/{id}/levels payload.
 * Ignores subclass-specific level rows (they carry a "subclass" field).
 * @param {any[]} levelsRaw
 * @returns {{
 *   featuresByLevel: Record<string, string[]>,
 *   classSpecificByLevel: Record<string, Record<string, unknown>>,
 *   asiLevels: number[],
 *   cantripsKnownByLevel: number[] | null,
 *   spellsKnownByLevel: number[] | null,
 *   slotsByLevel: number[][] | null
 * }}
 */
function normalizeLevels(levelsRaw) {
  /** @type {Record<string, string[]>} */
  const featuresByLevel = {};
  /** @type {Record<string, Record<string, unknown>>} */
  const classSpecificByLevel = {};
  /** @type {number[]} */
  const asiLevels = [];
  /** @type {number[]} */
  const cantrips = [];
  /** @type {number[]} */
  const known = [];
  /** @type {number[][]} */
  const slots = [];
  let hasSpellcasting = false;
  let hasCantrips = false;
  let hasKnown = false;
  let previousAsiCount = 0;

  const classRows = (levelsRaw ?? [])
    .filter((row) => row && !row.subclass && Number.isInteger(Number(row.level)))
    .sort((a, b) => Number(a.level) - Number(b.level));

  for (const row of classRows) {
    const level = Number(row.level);
    const featureIds = (row.features ?? [])
      .map((feature) => normalizeRegistryId(feature?.index))
      .filter(Boolean);
    if (featureIds.length) featuresByLevel[String(level)] = /** @type {string[]} */ (featureIds);

    if (row.class_specific && typeof row.class_specific === "object") {
      classSpecificByLevel[String(level)] = row.class_specific;
    }

    const asiCount = Number(row.ability_score_bonuses);
    if (Number.isInteger(asiCount) && asiCount > previousAsiCount) {
      asiLevels.push(level);
      previousAsiCount = asiCount;
    }

    const sc = row.spellcasting;
    if (sc && typeof sc === "object") {
      hasSpellcasting = true;
      if (Number.isInteger(Number(sc.cantrips_known))) hasCantrips = true;
      if (Number.isInteger(Number(sc.spells_known))) hasKnown = true;
      cantrips[level - 1] = Number(sc.cantrips_known) || 0;
      known[level - 1] = Number(sc.spells_known) || 0;
      const perSlotLevel = [];
      for (let slotLevel = 1; slotLevel <= 9; slotLevel += 1) {
        perSlotLevel.push(Number(sc[`spell_slots_level_${slotLevel}`]) || 0);
      }
      slots[level - 1] = perSlotLevel;
    } else {
      cantrips[level - 1] = 0;
      known[level - 1] = 0;
      slots[level - 1] = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    }
  }

  return {
    featuresByLevel,
    classSpecificByLevel,
    asiLevels,
    cantripsKnownByLevel: hasSpellcasting && hasCantrips ? cantrips : null,
    spellsKnownByLevel: hasSpellcasting && hasKnown ? known : null,
    slotsByLevel: hasSpellcasting ? slots : null
  };
}

/**
 * Determine the class level at which the subclass is chosen: the lowest
 * class level whose subclass rows exist in the subclass levels payload.
 * @param {any[][]} subclassLevelsRawList
 * @returns {number | null}
 */
function detectSubclassLevel(subclassLevelsRawList) {
  let min = null;
  for (const rows of subclassLevelsRawList) {
    for (const row of rows ?? []) {
      const level = Number(row?.level);
      if (!Number.isInteger(level)) continue;
      if (min == null || level < min) min = level;
    }
  }
  return min;
}

/**
 * @param {Map<string, Array<{ itemId: string, name: string }>>} categoryCache
 * @param {any} raw
 * @param {any[]} levelsRaw
 * @param {any[][]} subclassLevelsRawList
 * @returns {Promise<object>}
 */
async function transformClass(categoryCache, raw, levelsRaw, subclassLevelsRawList) {
  const id = normalizeRegistryId(raw.index);
  const levels = normalizeLevels(levelsRaw);
  const buckets = classifyProficiencies(raw.proficiencies ?? []);
  const skillChoices = Array.isArray(raw.proficiency_choices)
    ? raw.proficiency_choices.map(normalizeSkillChoice).find(Boolean) ?? null
    : null;

  /** @type {object | null} */
  let spellcasting = null;
  const scRaw = raw.spellcasting;
  if (scRaw && typeof scRaw === "object" && id && id in SPELLCASTING_META) {
    const meta = SPELLCASTING_META[/** @type {keyof typeof SPELLCASTING_META} */ (id)];
    spellcasting = {
      ability: normalizeRegistryId(scRaw.spellcasting_ability?.index),
      startLevel: Number.isInteger(Number(scRaw.level)) ? Number(scRaw.level) : 1,
      preparationMode: meta.preparationMode,
      progression: meta.progression,
      ritualCasting: meta.ritualCasting,
      cantripsKnownByLevel: levels.cantripsKnownByLevel,
      spellsKnownByLevel: levels.spellsKnownByLevel,
      slotsByLevel: levels.slotsByLevel
    };
  }

  const startingEquipment = (raw.starting_equipment ?? [])
    .map((entry) => {
      const itemId = normalizeRegistryId(entry?.equipment?.index);
      if (!itemId) return null;
      return {
        itemId,
        name: String(entry?.equipment?.name ?? itemId),
        quantity: Number.isInteger(Number(entry?.quantity)) ? Number(entry.quantity) : 1
      };
    })
    .filter(Boolean);

  const startingEquipmentOptions = await normalizeStartingEquipmentOptions(
    categoryCache,
    raw.starting_equipment_options
  );

  return {
    id,
    kind: "class",
    name: raw.name,
    source: "srd-5.1",
    hitDie: Number(raw.hit_die),
    savingThrowProficiencies: (raw.saving_throws ?? [])
      .map((save) => normalizeRegistryId(save?.index))
      .filter(Boolean),
    armorProficiencies: buckets.armor,
    weaponProficiencies: buckets.weapons,
    toolProficiencies: buckets.tools,
    skillChoices,
    subclassIds: (raw.subclasses ?? [])
      .map((subclass) => normalizeRegistryId(subclass?.index))
      .filter(Boolean),
    subclassLevel: detectSubclassLevel(subclassLevelsRawList),
    asiLevels: levels.asiLevels,
    featuresByLevel: levels.featuresByLevel,
    classSpecificByLevel: levels.classSpecificByLevel,
    spellcasting,
    multiclassing: normalizeMulticlassing(raw.multi_classing),
    startingEquipment,
    startingEquipmentOptions
  };
}

/**
 * Main adapter function. Fetches all classes plus per-class level tables and
 * returns an array ready to write to classes.json.
 * @returns {Promise<object[]>}
 */
export async function buildClassesData() {
  console.log("Fetching classes list...");
  const list = await apiFetch("/classes");

  console.log(`Found ${list.count} classes. Fetching details...`);
  const details = await apiFetchAll(list.results.map((c) => `/classes/${c.index}`));
  const levels = await apiFetchAll(list.results.map((c) => `/classes/${c.index}/levels`));

  /** @type {Map<string, Array<{ itemId: string, name: string }>>} */
  const categoryCache = new Map();

  const out = [];
  for (let i = 0; i < details.length; i += 1) {
    const raw = details[i];
    const subclassIds = (raw.subclasses ?? []).map((s) => s.index);
    const subclassLevelsRawList = await apiFetchAll(
      subclassIds.map((sid) => `/subclasses/${sid}/levels`)
    );
    out.push(await transformClass(categoryCache, raw, levels[i], subclassLevelsRawList));
    console.log(`  ✓ ${raw.name}`);
  }
  return out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

export { joinDesc };
