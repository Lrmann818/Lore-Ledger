// @ts-check
// scripts/fetch-srd-data.js
//
// Orchestrator script — fetches SRD data from dnd5eapi and writes
// the output JSON files to game-data/srd/.
//
// Usage:
//   node scripts/fetch-srd-data.js races
//   node scripts/fetch-srd-data.js draconic-ancestries
//   node scripts/fetch-srd-data.js classes
//   node scripts/fetch-srd-data.js all
//
// Run from the repo root. Requires Node 18+ (native fetch).

import { writeFile } from "fs/promises";
import { join } from "path";
import { buildDraconicAncestriesData } from "./adapters/draconicAncestriesAdapter.js";
import { buildRacesData } from "./adapters/racesAdapter.js";

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
  // Add more adapters here as they are built:
  // classes: { fn: buildClassesData, file: "classes.json" },
  // backgrounds: { fn: buildBackgroundsData, file: "backgrounds.json" },
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
