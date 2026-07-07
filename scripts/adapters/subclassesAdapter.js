// @ts-check
// scripts/adapters/subclassesAdapter.js
//
// Transforms dnd5eapi /api/2014/subclasses (+ per-subclass /levels) into the
// Lore Ledger subclasses.json schema.
//
// Output schema per entry:
//   id              — stable kebab-case id ("life")
//   kind            — "subclass"
//   name            — display name ("Life")
//   source          — always "srd-5.1"
//   classId         — parent class id ("cleric")
//   subclassFlavor  — the class's subclass label ("Divine Domain")
//   desc            — descriptive text
//   featuresByLevel — { "<classLevel>": [feature ids] }
//   grantedSpells   — [{ spellId, classLevel, grantType: "always_prepared" }]
//                     (domain/patron-style granted spells; empty when none)

import { apiFetch, apiFetchAll, joinDesc, normalizeRegistryId } from "./apiUtil.js";

/**
 * @param {any} raw
 * @param {any[]} levelsRaw
 * @returns {object}
 */
function transformSubclass(raw, levelsRaw) {
  /** @type {Record<string, string[]>} */
  const featuresByLevel = {};
  for (const row of levelsRaw ?? []) {
    const level = Number(row?.level);
    if (!Number.isInteger(level)) continue;
    const featureIds = (row.features ?? [])
      .map((feature) => normalizeRegistryId(feature?.index))
      .filter(Boolean);
    if (featureIds.length) featuresByLevel[String(level)] = /** @type {string[]} */ (featureIds);
  }

  /** @type {Array<{ spellId: string, classLevel: number, grantType: string }>} */
  const grantedSpells = [];
  for (const grant of raw.spells ?? []) {
    const spellId = normalizeRegistryId(grant?.spell?.index);
    if (!spellId) continue;
    let classLevel = 1;
    for (const prereq of grant?.prerequisites ?? []) {
      if (prereq?.type !== "level") continue;
      const match = String(prereq?.index ?? "").match(/-(\d+)$/);
      if (match) classLevel = Number(match[1]);
    }
    grantedSpells.push({ spellId, classLevel, grantType: "always_prepared" });
  }

  return {
    id: normalizeRegistryId(raw.index),
    kind: "subclass",
    name: raw.name,
    source: "srd-5.1",
    classId: normalizeRegistryId(raw.class?.index),
    subclassFlavor: typeof raw.subclass_flavor === "string" ? raw.subclass_flavor : "",
    desc: joinDesc(raw.desc),
    featuresByLevel,
    grantedSpells
  };
}

/**
 * Main adapter function.
 * @returns {Promise<object[]>}
 */
export async function buildSubclassesData() {
  console.log("Fetching subclasses list...");
  const list = await apiFetch("/subclasses");

  console.log(`Found ${list.count} subclasses. Fetching details...`);
  const details = await apiFetchAll(list.results.map((s) => `/subclasses/${s.index}`));
  const levels = await apiFetchAll(list.results.map((s) => `/subclasses/${s.index}/levels`));

  return details
    .map((raw, i) => transformSubclass(raw, levels[i]))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}
