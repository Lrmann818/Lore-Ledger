// @ts-check
// scripts/adapters/equipmentAdapter.js
//
// Transforms dnd5eapi armor and weapon equipment into the Lore Ledger
// equipment.armor.json and equipment.weapons.json schemas.
//
// Magic items are intentionally excluded (out of builder scope): the
// equipment-category listings mix magic items in, but those resolve to
// /api/2014/magic-items/ URLs, so we keep only /api/2014/equipment/ records.
//
// Armor output schema per entry:
//   id, kind: "armor", name, source: "srd-5.1",
//   armorCategory — "light" | "medium" | "heavy" | "shield"
//   baseAC        — base armor class (for shields: the +2 bonus as acBonus instead)
//   acBonus       — shield-style flat bonus (null for body armor)
//   addDex        — whether Dex modifier applies
//   maxDex        — Dex modifier cap or null
//   strengthRequirement — minimum Str score or null
//   stealthDisadvantage — boolean
//   weight, cost
//
// Weapon output schema per entry:
//   id, kind: "weapon", name, source: "srd-5.1",
//   weaponCategory — "simple" | "martial"
//   attackType     — "melee" | "ranged"
//   damage         — "1d8" (null for net)
//   damageType     — "slashing" etc. (null when no damage)
//   properties     — [property ids]
//   versatileDamage — "1d10" | null
//   range          — { normal, long } | null (ranged weapons)
//   throwRange     — { normal, long } | null (thrown property)
//   weight, cost

import { apiFetch, apiFetchAll, normalizeCost, normalizeRegistryId } from "./apiUtil.js";

/**
 * Fetch all mundane equipment records in a category.
 * @param {string} categoryId
 * @returns {Promise<any[]>}
 */
async function fetchMundaneCategory(categoryId) {
  const category = await apiFetch(`/equipment-categories/${categoryId}`);
  const paths = (category.equipment ?? [])
    .filter((item) => typeof item?.url === "string" && item.url.startsWith("/api/2014/equipment/"))
    .map((item) => item.url);
  return apiFetchAll(paths);
}

/**
 * @param {any} raw
 * @returns {object | null}
 */
function transformArmor(raw) {
  const id = normalizeRegistryId(raw.index);
  if (!id) return null;
  const categoryRaw = String(raw.armor_category ?? "").toLowerCase();
  const isShield = categoryRaw === "shield";
  const armorClass = raw.armor_class ?? {};
  return {
    id,
    kind: "armor",
    name: raw.name,
    source: "srd-5.1",
    armorCategory: isShield ? "shield" : categoryRaw,
    baseAC: isShield ? null : Number(armorClass.base) || null,
    acBonus: isShield ? Number(armorClass.base) || 2 : null,
    addDex: isShield ? false : armorClass.dex_bonus === true,
    maxDex: Number.isInteger(Number(armorClass.max_bonus)) && armorClass.max_bonus != null
      ? Number(armorClass.max_bonus)
      : null,
    strengthRequirement: Number(raw.str_minimum) > 0 ? Number(raw.str_minimum) : null,
    stealthDisadvantage: raw.stealth_disadvantage === true,
    weight: Number.isFinite(Number(raw.weight)) ? Number(raw.weight) : null,
    cost: normalizeCost(raw.cost)
  };
}

/**
 * @param {any} raw
 * @returns {object | null}
 */
function transformWeapon(raw) {
  const id = normalizeRegistryId(raw.index);
  if (!id) return null;
  const properties = (raw.properties ?? [])
    .map((property) => normalizeRegistryId(property?.index))
    .filter(Boolean);
  const isRanged = String(raw.weapon_range ?? "").toLowerCase() === "ranged";
  const range = raw.range && Number.isFinite(Number(raw.range.normal))
    ? {
      normal: Number(raw.range.normal),
      long: Number.isFinite(Number(raw.range.long)) ? Number(raw.range.long) : null
    }
    : null;
  const throwRange = raw.throw_range && Number.isFinite(Number(raw.throw_range.normal))
    ? {
      normal: Number(raw.throw_range.normal),
      long: Number.isFinite(Number(raw.throw_range.long)) ? Number(raw.throw_range.long) : null
    }
    : null;
  return {
    id,
    kind: "weapon",
    name: raw.name,
    source: "srd-5.1",
    weaponCategory: String(raw.weapon_category ?? "").toLowerCase(),
    attackType: isRanged ? "ranged" : "melee",
    damage: typeof raw.damage?.damage_dice === "string" ? raw.damage.damage_dice : null,
    damageType: normalizeRegistryId(raw.damage?.damage_type?.index) ?? null,
    properties,
    versatileDamage: typeof raw.two_handed_damage?.damage_dice === "string"
      ? raw.two_handed_damage.damage_dice
      : null,
    range: isRanged ? range : null,
    throwRange,
    weight: Number.isFinite(Number(raw.weight)) ? Number(raw.weight) : null,
    cost: normalizeCost(raw.cost)
  };
}

/**
 * Builds equipment.armor.json.
 * @returns {Promise<object[]>}
 */
export async function buildArmorData() {
  console.log("Fetching armor category...");
  const records = await fetchMundaneCategory("armor");
  console.log(`Found ${records.length} mundane armor records.`);
  return records
    .map(transformArmor)
    .filter(Boolean)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/**
 * Builds equipment.weapons.json.
 * @returns {Promise<object[]>}
 */
export async function buildWeaponsData() {
  console.log("Fetching weapon category...");
  const records = await fetchMundaneCategory("weapon");
  console.log(`Found ${records.length} mundane weapon records.`);
  return records
    .map(transformWeapon)
    .filter(Boolean)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}
