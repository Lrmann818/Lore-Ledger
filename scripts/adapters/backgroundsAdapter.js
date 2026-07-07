// @ts-check
// scripts/adapters/backgroundsAdapter.js
//
// Transforms dnd5eapi /api/2014/backgrounds into the Lore Ledger
// backgrounds.json schema. SRD 5.1 ships exactly one background (Acolyte);
// additional backgrounds arrive via the custom content system.
//
// Output schema per entry:
//   id                 — stable kebab-case id ("acolyte")
//   kind               — "background"
//   name               — display name
//   source             — always "srd-5.1"
//   skillProficiencies — [skill ids]
//   choices            — build-time choices array (language picks)
//   startingEquipment  — [{ itemId, name, quantity }]
//   startingEquipmentOptions — same shape as classes.json options
//   feature            — { name, desc }

import { apiFetch, apiFetchAll, joinDesc, normalizeRegistryId, skillIdFromProficiency } from "./apiUtil.js";

/**
 * @param {any} raw
 * @returns {object}
 */
function transformBackground(raw) {
  const id = normalizeRegistryId(raw.index);

  /** @type {object[]} */
  const choices = [];
  const langOptions = raw.language_options;
  const langChoose = Number(langOptions?.choose);
  if (Number.isInteger(langChoose) && langChoose > 0) {
    const optionIds = Array.isArray(langOptions?.from?.options)
      ? langOptions.from.options
        .map((option) => normalizeRegistryId(option?.item?.index))
        .filter(Boolean)
      : [];
    choices.push({
      id: `${id}-language`,
      kind: "language",
      count: langChoose,
      from: optionIds.length ? { type: "list", options: optionIds } : { type: "any" },
      source: `background:${id}`
    });
  }

  const startingEquipment = (raw.starting_equipment ?? [])
    .map((entry) => {
      const itemId = normalizeRegistryId(entry?.equipment?.index);
      if (!itemId) return null;
      return {
        itemId,
        name: String(entry?.equipment?.name ?? itemId),
        quantity: Number.isInteger(Number(entry?.quantity)) ? Number(entry.quantity) : 1
      };
    })
    .filter(Boolean);

  const startingEquipmentOptions = (raw.starting_equipment_options ?? [])
    .map((group) => {
      const choose = Number.isInteger(Number(group?.choose)) ? Number(group.choose) : 1;
      const categoryRef = group?.from?.equipment_category;
      if (group?.from?.option_set_type === "equipment_category" && categoryRef) {
        return {
          desc: `Choose ${choose} from ${String(categoryRef.name ?? categoryRef.index ?? "category")}`,
          choose,
          options: [{
            categoryId: normalizeRegistryId(categoryRef.index),
            categoryName: String(categoryRef.name ?? ""),
            itemOptions: []
          }]
        };
      }
      return null;
    })
    .filter(Boolean);

  return {
    id,
    kind: "background",
    name: raw.name,
    source: "srd-5.1",
    skillProficiencies: (raw.starting_proficiencies ?? [])
      .map((prof) => skillIdFromProficiency(prof?.index))
      .filter(Boolean),
    choices,
    startingEquipment,
    startingEquipmentOptions,
    feature: {
      name: String(raw.feature?.name ?? ""),
      desc: joinDesc(raw.feature?.desc)
    }
  };
}

/**
 * Main adapter function.
 * @returns {Promise<object[]>}
 */
export async function buildBackgroundsData() {
  console.log("Fetching backgrounds list...");
  const list = await apiFetch("/backgrounds");

  console.log(`Found ${list.count} backgrounds. Fetching details...`);
  const details = await apiFetchAll(list.results.map((b) => `/backgrounds/${b.index}`));

  return details
    .map(transformBackground)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}
