// @ts-check
// scripts/adapters/featsAdapter.js
//
// Transforms dnd5eapi /api/2014/feats into the Lore Ledger feats.json schema.
// SRD 5.1 ships exactly one feat (Grappler); additional feats arrive via the
// custom content system.
//
// Output schema per entry:
//   id            — stable kebab-case id ("grappler")
//   kind          — "feat"
//   name          — display name
//   source        — always "srd-5.1"
//   prerequisites — [{ ability, minimum }]
//   desc          — full feat text
//   effects       — structured effects for rules derivation (empty when the
//                   feat has no mechanical hooks the engine models)

import { apiFetch, apiFetchAll, joinDesc, normalizeAbilityPrerequisites, normalizeRegistryId } from "./apiUtil.js";

/**
 * @param {any} raw
 * @returns {object}
 */
function transformFeat(raw) {
  return {
    id: normalizeRegistryId(raw.index),
    kind: "feat",
    name: raw.name,
    source: "srd-5.1",
    prerequisites: normalizeAbilityPrerequisites(raw.prerequisites),
    desc: joinDesc(raw.desc),
    effects: []
  };
}

/**
 * Main adapter function.
 * @returns {Promise<object[]>}
 */
export async function buildFeatsData() {
  console.log("Fetching feats list...");
  const list = await apiFetch("/feats");

  console.log(`Found ${list.count} feats. Fetching details...`);
  const details = await apiFetchAll(list.results.map((f) => `/feats/${f.index}`));

  return details
    .map(transformFeat)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}
