// @ts-check
// scripts/adapters/draconicAncestriesAdapter.js
//
// Transforms dnd5eapi /api/2014/traits/draconic-ancestry subtrait
// responses into the Lore Ledger draconic-ancestries.json schema.

const BASE_URL = "https://www.dnd5eapi.co/api/2014";
const API_ORIGIN = "https://www.dnd5eapi.co";
const PARENT_TRAIT_ID = "draconic-ancestry";
const ANCESTRY_PREFIX = `${PARENT_TRAIT_ID}-`;

// SRD 5.1 categorization is lore metadata for grouping. The API exposes the
// ancestry mechanics but not this grouping.
const ANCESTRY_CATEGORIES = new Map([
  ["black", "chromatic"],
  ["blue", "chromatic"],
  ["green", "chromatic"],
  ["red", "chromatic"],
  ["white", "chromatic"],
  ["brass", "metallic"],
  ["bronze", "metallic"],
  ["copper", "metallic"],
  ["gold", "metallic"],
  ["silver", "metallic"],
]);

/**
 * SRD 5.1 lists line breath weapons as "5 by 30 ft. line"; the API exposes
 * the 30 ft. line length as area_of_effect.size but not the 5 ft. width.
 */
const SRD_LINE_WIDTH_FEET = 5;

/**
 * Fetch JSON from the API with basic error handling.
 * @param {string} url
 * @returns {Promise<any>}
 */
async function apiFetch(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed: ${url} - ${res.status}`);
  return res.json();
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeRegistryId(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/[_\s]+/g, "-");
  return /^[a-z0-9-]+$/.test(normalized) ? normalized : null;
}

/**
 * @param {any} parentTrait
 * @returns {{ index: string, url: string }[]}
 */
function collectAncestryOptions(parentTrait) {
  const options = parentTrait?.trait_specific?.subtrait_options?.from?.options;
  const choose = parentTrait?.trait_specific?.subtrait_options?.choose;
  if (choose !== 1 || !Array.isArray(options)) {
    throw new Error("Draconic Ancestry trait is missing one-pick subtrait options.");
  }

  const refs = options.map((option) => option?.item).filter(Boolean);
  if (refs.length !== 10) {
    throw new Error(`Expected 10 Draconic Ancestry options, received ${refs.length}.`);
  }

  return refs.map((ref) => {
    if (typeof ref.index !== "string" || typeof ref.url !== "string") {
      throw new Error("Draconic Ancestry option is missing index or url.");
    }
    return { index: ref.index, url: ref.url };
  });
}

/**
 * @param {string} index
 * @returns {string}
 */
function ancestryIdFromIndex(index) {
  if (!index.startsWith(ANCESTRY_PREFIX)) {
    throw new Error(`Unexpected Draconic Ancestry subtrait id: ${index}`);
  }
  const id = normalizeRegistryId(index.slice(ANCESTRY_PREFIX.length));
  if (!id || !ANCESTRY_CATEGORIES.has(id)) {
    throw new Error(`Unknown Draconic Ancestry id: ${id ?? index}`);
  }
  return id;
}

/**
 * @param {string} url
 * @returns {string}
 */
function toApiUrl(url) {
  return url.startsWith("http") ? url : `${API_ORIGIN}${url}`;
}

/**
 * @param {string} name
 * @param {string} id
 * @returns {string}
 */
function normalizeAncestryName(name, id) {
  const match = /^Draconic Ancestry \(([^)]+)\)$/.exec(name);
  if (match) return match[1];
  return id.charAt(0).toUpperCase() + id.slice(1);
}

/**
 * @param {any} raw
 * @returns {object}
 */
function transformAncestry(raw) {
  const id = ancestryIdFromIndex(raw?.index);
  const breathWeapon = raw?.trait_specific?.breath_weapon;
  const area = breathWeapon?.area_of_effect;
  const shape = normalizeRegistryId(area?.type);
  const size = area?.size;
  const damageType = normalizeRegistryId(raw?.trait_specific?.damage_type?.index);
  const saveAbility = normalizeRegistryId(breathWeapon?.dc?.dc_type?.index);
  const category = ANCESTRY_CATEGORIES.get(id);

  if (!damageType) {
    throw new Error(`Draconic Ancestry ${id} is missing damage type.`);
  }
  if (shape !== "line" && shape !== "cone") {
    throw new Error(`Draconic Ancestry ${id} has unsupported breath weapon shape: ${shape}`);
  }
  if (!Number.isInteger(size) || size <= 0) {
    throw new Error(`Draconic Ancestry ${id} is missing breath weapon size.`);
  }
  if (saveAbility !== "dex" && saveAbility !== "con") {
    throw new Error(`Draconic Ancestry ${id} has unsupported save ability: ${saveAbility}`);
  }
  if (!category) {
    throw new Error(`Draconic Ancestry ${id} is missing category.`);
  }

  const breathWeaponShape = shape === "line"
    ? { shape, width: SRD_LINE_WIDTH_FEET, length: size }
    : { shape, size };

  return {
    id,
    kind: "ancestry",
    name: normalizeAncestryName(raw?.name, id),
    source: "srd-5.1",
    sourceTraitId: PARENT_TRAIT_ID,
    category,
    damageType,
    breathWeapon: breathWeaponShape,
    saveAbility,
  };
}

/**
 * Main adapter function. Fetches Draconic Ancestry trait options from the API
 * and returns normalized ancestry records ready to write to JSON.
 * @returns {Promise<object[]>}
 */
export async function buildDraconicAncestriesData() {
  console.log("Fetching Draconic Ancestry trait...");
  const parentTrait = await apiFetch(`${BASE_URL}/traits/${PARENT_TRAIT_ID}`);
  const options = collectAncestryOptions(parentTrait);

  console.log(`Found ${options.length} Draconic Ancestry options. Fetching details...`);
  const details = await Promise.all(
    options.map((option) => apiFetch(toApiUrl(option.url)))
  );

  return details.map(transformAncestry);
}
