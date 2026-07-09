// @ts-check
// scripts/adapters/equipmentPacksAdapter.js
//
// Transforms the dnd5eapi "equipment-packs" gear category into the Lore Ledger
// equipment.packs.json schema.
//
// Packs are the containers referenced by class/background starting equipment
// (e.g. "explorers-pack"). Only the pack records themselves are shipped — the
// individual adventuring-gear items they contain are captured inline as
// {itemId, name, quantity} rows rather than as separate registry entries, which
// keeps the shipped builtin scope limited to what starting-equipment seeding
// actually needs.
//
// Output schema per entry:
//   id, kind: "pack", name, source: "srd-5.1",
//   cost      — { quantity, unit } | null
//   contents  — [{ itemId, name, quantity }] sorted as the SRD lists them

import { apiFetch, apiFetchAll, normalizeCost, normalizeRegistryId } from "./apiUtil.js";

/**
 * @param {any} raw
 * @returns {Array<{ itemId: string, name: string, quantity: number }>}
 */
function transformContents(raw) {
  const contents = Array.isArray(raw?.contents) ? raw.contents : [];
  /** @type {Array<{ itemId: string, name: string, quantity: number }>} */
  const out = [];
  for (const entry of contents) {
    const itemId = normalizeRegistryId(entry?.item?.index);
    const name = typeof entry?.item?.name === "string" ? entry.item.name.trim() : "";
    const quantity = Number(entry?.quantity);
    if (!itemId || !name || !Number.isFinite(quantity) || quantity < 1) continue;
    out.push({ itemId, name, quantity: Math.trunc(quantity) });
  }
  return out;
}

/**
 * @param {any} raw
 * @returns {object | null}
 */
function transformPack(raw) {
  const id = normalizeRegistryId(raw.index);
  if (!id) return null;
  const contents = transformContents(raw);
  // A pack with no resolvable contents carries no seeding value.
  if (!contents.length) return null;
  return {
    id,
    kind: "pack",
    name: raw.name,
    source: "srd-5.1",
    cost: normalizeCost(raw.cost),
    contents
  };
}

/**
 * Builds equipment.packs.json.
 * @returns {Promise<object[]>}
 */
export async function buildPacksData() {
  console.log("Fetching equipment-packs category...");
  const category = await apiFetch("/equipment-categories/equipment-packs");
  const paths = (category.equipment ?? [])
    .filter((item) => typeof item?.url === "string" && item.url.startsWith("/api/2014/equipment/"))
    .map((item) => item.url);
  const records = await apiFetchAll(paths);
  console.log(`Found ${records.length} equipment pack records.`);
  return records
    .map(transformPack)
    .filter(Boolean)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}
