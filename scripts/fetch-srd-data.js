// @ts-check
// scripts/fetch-srd-data.js
//
// Orchestrator script — fetches SRD data from dnd5eapi and writes
// the output JSON files to game-data/srd/.
//
// Usage:
//   node scripts/fetch-srd-data.js races
//   node scripts/fetch-srd-data.js draconic-ancestries
//   node scripts/fetch-srd-data.js traits
//   node scripts/fetch-srd-data.js classes
//   node scripts/fetch-srd-data.js all
//
// Run from the repo root. Requires Node 18+ (native fetch).

import { writeFile } from "fs/promises";
import { join } from "path";
import { buildBackgroundsData } from "./adapters/backgroundsAdapter.js";
import { buildClassesData } from "./adapters/classesAdapter.js";
import { buildDraconicAncestriesData } from "./adapters/draconicAncestriesAdapter.js";
import { buildArmorData, buildWeaponsData } from "./adapters/equipmentAdapter.js";
import { buildPacksData } from "./adapters/equipmentPacksAdapter.js";
import { buildFeatsData } from "./adapters/featsAdapter.js";
import { buildFeaturesData } from "./adapters/featuresAdapter.js";
import { buildLanguagesData } from "./adapters/languagesAdapter.js";
import { buildRacesData } from "./adapters/racesAdapter.js";
import { buildSkillsData } from "./adapters/skillsAdapter.js";
import { buildSpellsData } from "./adapters/spellsAdapter.js";
import { buildSubclassesData } from "./adapters/subclassesAdapter.js";
import { buildTraitsData } from "./adapters/traitsAdapter.js";

const OUTPUT_DIR = "game-data/srd";

const ADAPTERS = {
  races: {
    fn: buildRacesData,
    file: "races.json",
  },
  "draconic-ancestries": {
    fn: buildDraconicAncestriesData,
    file: "draconic-ancestries.json",
  },
  traits: {
    fn: buildTraitsData,
    file: "traits.json",
  },
  classes: {
    fn: buildClassesData,
    file: "classes.json",
  },
  subclasses: {
    fn: buildSubclassesData,
    file: "subclasses.json",
  },
  features: {
    fn: buildFeaturesData,
    file: "features.json",
  },
  backgrounds: {
    fn: buildBackgroundsData,
    file: "backgrounds.json",
  },
  feats: {
    fn: buildFeatsData,
    file: "feats.json",
  },
  armor: {
    fn: buildArmorData,
    file: "equipment.armor.json",
  },
  weapons: {
    fn: buildWeaponsData,
    file: "equipment.weapons.json",
  },
  packs: {
    fn: buildPacksData,
    file: "equipment.packs.json",
  },
  spells: {
    fn: buildSpellsData,
    file: "spells.json",
  },
  languages: {
    fn: buildLanguagesData,
    file: "languages.json",
  },
  skills: {
    fn: buildSkillsData,
    file: "skills.json",
  },
};

async function run() {
  const target = process.argv[2];

  if (!target) {
    console.error("Usage: node scripts/fetch-srd-data.js <adapter> | all");
    console.error(`Available: ${Object.keys(ADAPTERS).join(", ")}`);
    process.exit(1);
  }

  const targets =
    target === "all" ? Object.keys(ADAPTERS) : [target];

  for (const key of targets) {
    const adapter = ADAPTERS[key];
    if (!adapter) {
      console.error(`Unknown adapter: "${key}". Available: ${Object.keys(ADAPTERS).join(", ")}`);
      process.exit(1);
    }

    console.log(`\n── Running adapter: ${key} ──`);
    const data = await adapter.fn();

    const outputPath = join(OUTPUT_DIR, adapter.file);
    await writeFile(outputPath, JSON.stringify(data, null, 2) + "\n", "utf-8");
    console.log(`✓ Written to ${outputPath} (${data.length} entries)`);
  }

  console.log("\nDone.");
}

run().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
