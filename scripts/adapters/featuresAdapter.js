// @ts-check
// scripts/adapters/featuresAdapter.js
//
// Transforms dnd5eapi /api/2014/features into the Lore Ledger features.json
// schema. Features are the descriptive records referenced by
// classes.json/subclasses.json featuresByLevel ids.
//
// Output schema per entry:
//   id                — stable kebab-case id ("second-wind")
//   kind              — "feature"
//   name              — display name
//   source            — always "srd-5.1"
//   classId           — owning class id
//   subclassId        — owning subclass id or null
//   level             — class level the feature is gained
//   desc              — full feature text
//   prerequisites     — [{ ability, minimum }] (rarely present; e.g. some invocations use level/spell prereqs which are kept as desc-only)
//   subfeatureOptions — { choose, from: [feature ids] } | null
//                       (e.g. Fighting Style choices)

import { apiFetch, apiFetchAll, joinDesc, normalizeAbilityPrerequisites, normalizeRegistryId } from "./apiUtil.js";

/**
 * @param {any} raw
 * @returns {object}
 */
function transformFeature(raw) {
  /** @type {{ choose: number, from: string[] } | null} */
  let subfeatureOptions = null;
  const sub = raw.feature_specific?.subfeature_options;
  if (sub && Array.isArray(sub.from?.options)) {
    const from = sub.from.options
      .map((option) => normalizeRegistryId(option?.item?.index))
      .filter(Boolean);
    const choose = Number(sub.choose);
    if (from.length && Number.isInteger(choose) && choose > 0) {
      subfeatureOptions = { choose, from: /** @type {string[]} */ (from) };
    }
  }

  return {
    id: normalizeRegistryId(raw.index),
    kind: "feature",
    name: raw.name,
    source: "srd-5.1",
    classId: normalizeRegistryId(raw.class?.index),
    subclassId: normalizeRegistryId(raw.subclass?.index) ?? null,
    level: Number.isInteger(Number(raw.level)) ? Number(raw.level) : null,
    desc: joinDesc(raw.desc),
    prerequisites: normalizeAbilityPrerequisites(raw.prerequisites),
    subfeatureOptions
  };
}

/**
 * Main adapter function.
 * @returns {Promise<object[]>}
 */
export async function buildFeaturesData() {
  console.log("Fetching features list...");
  const list = await apiFetch("/features");

  console.log(`Found ${list.count} features. Fetching details...`);
  const details = await apiFetchAll(list.results.map((f) => `/features/${f.index}`));

  return details
    .map(transformFeature)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
}
