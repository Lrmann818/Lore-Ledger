// @ts-check
// scripts/adapters/languagesAdapter.js
//
// Transforms dnd5eapi /api/2014/languages into the Lore Ledger
// languages.json schema.
//
// Output schema per entry:
//   id       — stable kebab-case id ("draconic")
//   kind     — "language"
//   name     — display name
//   source   — always "srd-5.1"
//   type     — "Standard" | "Exotic"
//   script   — script name or null

import { apiFetch, apiFetchAll, normalizeRegistryId } from "./apiUtil.js";

/**
 * Main adapter function.
 * @returns {Promise<object[]>}
 */
export async function buildLanguagesData() {
  console.log("Fetching languages list...");
  const list = await apiFetch("/languages");

  console.log(`Found ${list.count} languages. Fetching details...`);
  const details = await apiFetchAll(list.results.map((l) => `/languages/${l.index}`));

  return details
    .map((raw) => ({
      id: normalizeRegistryId(raw.index),
      kind: "language",
      name: raw.name,
      source: "srd-5.1",
      type: typeof raw.type === "string" ? raw.type : null,
      script: typeof raw.script === "string" && raw.script.trim() ? raw.script : null
    }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}
