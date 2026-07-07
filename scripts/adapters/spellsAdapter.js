// @ts-check
// scripts/adapters/spellsAdapter.js
//
// Transforms dnd5eapi /api/2014/spells into the Lore Ledger spells.json
// schema. This is the shipped SRD 5.1 spell registry used for builder spell
// selection; the spells panel remains the manual-entry surface for anything
// outside it.
//
// Output schema per entry:
//   id            — stable kebab-case id ("fireball")
//   kind          — "spell"
//   name          — display name
//   source        — always "srd-5.1"
//   level         — 0 (cantrip) through 9
//   school        — school id ("evocation")
//   classIds      — class ids whose spell list includes the spell
//   subclassIds   — subclass ids that gain the spell (domain/patron lists)
//   castingTime, range, duration — display strings
//   components    — ["V","S","M"]
//   material      — material component text or null
//   ritual        — boolean
//   concentration — boolean
//   desc          — full rules text
//   higherLevel   — "At Higher Levels" text or null
//   attackType    — "melee" | "ranged" | null
//   saveAbility   — save ability id or null
//   damageType    — damage type id or null

import { apiFetch, apiFetchAll, joinDesc, normalizeRegistryId } from "./apiUtil.js";

/**
 * @param {any} raw
 * @returns {object}
 */
function transformSpell(raw) {
  return {
    id: normalizeRegistryId(raw.index),
    kind: "spell",
    name: raw.name,
    source: "srd-5.1",
    level: Number.isInteger(Number(raw.level)) ? Number(raw.level) : 0,
    school: normalizeRegistryId(raw.school?.index),
    classIds: (raw.classes ?? [])
      .map((entry) => normalizeRegistryId(entry?.index))
      .filter(Boolean),
    subclassIds: (raw.subclasses ?? [])
      .map((entry) => normalizeRegistryId(entry?.index))
      .filter(Boolean),
    castingTime: typeof raw.casting_time === "string" ? raw.casting_time : "",
    range: typeof raw.range === "string" ? raw.range : "",
    duration: typeof raw.duration === "string" ? raw.duration : "",
    components: Array.isArray(raw.components) ? raw.components.filter((c) => typeof c === "string") : [],
    material: typeof raw.material === "string" && raw.material.trim() ? raw.material.trim() : null,
    ritual: raw.ritual === true,
    concentration: raw.concentration === true,
    desc: joinDesc(raw.desc),
    higherLevel: joinDesc(raw.higher_level) || null,
    attackType: typeof raw.attack_type === "string" ? raw.attack_type : null,
    saveAbility: normalizeRegistryId(raw.dc?.dc_type?.index) ?? null,
    damageType: normalizeRegistryId(raw.damage?.damage_type?.index) ?? null
  };
}

/**
 * Main adapter function.
 * @returns {Promise<object[]>}
 */
export async function buildSpellsData() {
  console.log("Fetching spells list...");
  const list = await apiFetch("/spells");

  console.log(`Found ${list.count} spells. Fetching details (this takes a bit)...`);
  const details = await apiFetchAll(list.results.map((s) => `/spells/${s.index}`));

  return details
    .map(transformSpell)
    .sort((a, b) => (a.level - b.level) || String(a.name).localeCompare(String(b.name)));
}
