// @ts-check
// scripts/adapters/skillsAdapter.js
//
// Transforms dnd5eapi /api/2014/skills into the Lore Ledger skills.json
// schema.
//
// Output schema per entry:
//   id      — stable kebab-case id ("sleight-of-hand")
//   kind    — "skill"
//   name    — display name
//   source  — always "srd-5.1"
//   ability — governing ability id ("dex")
//   desc    — short rules text

import { apiFetch, apiFetchAll, joinDesc, normalizeRegistryId } from "./apiUtil.js";

/**
 * Main adapter function.
 * @returns {Promise<object[]>}
 */
export async function buildSkillsData() {
  console.log("Fetching skills list...");
  const list = await apiFetch("/skills");

  console.log(`Found ${list.count} skills. Fetching details...`);
  const details = await apiFetchAll(list.results.map((s) => `/skills/${s.index}`));

  return details
    .map((raw) => ({
      id: normalizeRegistryId(raw.index),
      kind: "skill",
      name: raw.name,
      source: "srd-5.1",
      ability: normalizeRegistryId(raw.ability_score?.index),
      desc: joinDesc(raw.desc)
    }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}
