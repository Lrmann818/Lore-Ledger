// @ts-check
// scripts/adapters/apiUtil.js
//
// Shared helpers for dnd5eapi adapter scripts. Build-time only — never
// shipped to the app runtime.

export const BASE_URL = "https://www.dnd5eapi.co/api/2014";

/**
 * Fetch JSON from the API with basic error handling.
 * @param {string} path — either a full URL or a path like "/classes/wizard"
 * @returns {Promise<any>}
 */
export async function apiFetch(path) {
  let url;
  if (path.startsWith("http")) {
    url = path;
  } else if (path.startsWith("/api/")) {
    // Raw API urls (as returned inside API payloads) already carry /api/2014.
    url = `https://www.dnd5eapi.co${path}`;
  } else {
    url = `${BASE_URL}${path.startsWith("/") ? "" : "/"}${path}`;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed: ${url} — ${res.status}`);
  return res.json();
}

/**
 * Fetch many API paths with limited concurrency (politeness + stability).
 * @param {string[]} paths
 * @param {number} [concurrency]
 * @returns {Promise<any[]>}
 */
export async function apiFetchAll(paths, concurrency = 12) {
  const results = new Array(paths.length);
  let next = 0;
  async function worker() {
    while (next < paths.length) {
      const i = next;
      next += 1;
      results[i] = await apiFetch(paths[i]);
    }
  }
  const workers = [];
  for (let i = 0; i < Math.min(concurrency, paths.length); i += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

/**
 * Normalize an API index into the registry id charset (lowercase ASCII
 * letters, digits, hyphens).
 * @param {unknown} value
 * @returns {string | null}
 */
export function normalizeRegistryId(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/[_\s]+/g, "-");
  return /^[a-z0-9-]+$/.test(normalized) ? normalized : null;
}

/**
 * Join an API desc array into a single readable string.
 * @param {unknown} desc
 * @returns {string}
 */
export function joinDesc(desc) {
  if (typeof desc === "string") return desc.trim();
  if (!Array.isArray(desc)) return "";
  return desc
    .filter((line) => typeof line === "string")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * Strip the "skill-" prefix from a proficiency index ("skill-arcana" → "arcana").
 * Returns null for non-skill proficiencies.
 * @param {unknown} index
 * @returns {string | null}
 */
export function skillIdFromProficiency(index) {
  const id = normalizeRegistryId(index);
  if (!id || !id.startsWith("skill-")) return null;
  return id.slice("skill-".length);
}

/**
 * Classify and normalize a class proficiency list into armor / weapon / tool
 * buckets, dropping saving-throw entries (represented separately).
 * @param {Array<{ index?: string }>} proficiencies
 * @returns {{ armor: string[], weapons: string[], tools: string[], skills: string[] }}
 */
export function classifyProficiencies(proficiencies) {
  /** @type {{ armor: string[], weapons: string[], tools: string[], skills: string[] }} */
  const out = { armor: [], weapons: [], tools: [], skills: [] };
  for (const prof of proficiencies ?? []) {
    const id = normalizeRegistryId(prof?.index);
    if (!id) continue;
    if (id.startsWith("saving-throw-")) continue;
    const skill = skillIdFromProficiency(id);
    if (skill) {
      out.skills.push(skill);
      continue;
    }
    if (id === "all-armor") {
      out.armor.push("light", "medium", "heavy");
      continue;
    }
    if (id === "light-armor") { out.armor.push("light"); continue; }
    if (id === "medium-armor") { out.armor.push("medium"); continue; }
    if (id === "heavy-armor") { out.armor.push("heavy"); continue; }
    if (id === "shields") { out.armor.push("shield"); continue; }
    if (id === "simple-weapons") { out.weapons.push("simple"); continue; }
    if (id === "martial-weapons") { out.weapons.push("martial"); continue; }
    // Specific weapon proficiencies keep their ids ("longswords", "daggers", …).
    if (isWeaponLikeProficiency(id)) { out.weapons.push(id); continue; }
    out.tools.push(id);
  }
  return out;
}

const WEAPON_LIKE_IDS = new Set([
  "daggers", "darts", "slings", "quarterstaffs", "clubs", "javelins", "maces",
  "spears", "handaxes", "light-hammers", "sickles", "crossbows-light",
  "shortbows", "shortswords", "longswords", "rapiers", "scimitars", "longbows",
  "battleaxes", "greataxes", "greatswords", "warhammers", "tridents", "whips",
  "blowguns", "crossbows-hand", "crossbows-heavy", "flails", "glaives",
  "greatclubs", "halberds", "lances", "mauls", "morningstars", "nets", "pikes",
  "war-picks", "unarmed-strikes"
]);

/**
 * @param {string} id
 * @returns {boolean}
 */
function isWeaponLikeProficiency(id) {
  return WEAPON_LIKE_IDS.has(id);
}

/**
 * Normalize an API ability-score prerequisite list.
 * @param {unknown} prerequisites
 * @returns {Array<{ ability: string, minimum: number }>}
 */
export function normalizeAbilityPrerequisites(prerequisites) {
  if (!Array.isArray(prerequisites)) return [];
  /** @type {Array<{ ability: string, minimum: number }>} */
  const out = [];
  for (const entry of prerequisites) {
    const ability = normalizeRegistryId(entry?.ability_score?.index);
    const minimum = Number(entry?.minimum_score);
    if (ability && Number.isFinite(minimum)) out.push({ ability, minimum });
  }
  return out;
}

/**
 * Normalize a cost object.
 * @param {unknown} cost
 * @returns {{ quantity: number, unit: string } | null}
 */
export function normalizeCost(cost) {
  const record = /** @type {{ quantity?: unknown, unit?: unknown }} */ (cost ?? {});
  const quantity = Number(record.quantity);
  const unit = typeof record.unit === "string" ? record.unit : "";
  if (!Number.isFinite(quantity) || !unit) return null;
  return { quantity, unit };
}
