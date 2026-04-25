// @ts-check
// scripts/adapters/traitsAdapter.js
//
// Transforms dnd5eapi /api/2014/traits responses into the Lore Ledger
// traits.json schema for the current SRD race/subrace slice.

import { readFile } from "fs/promises";

const BASE_URL = "https://www.dnd5eapi.co/api/2014";
const API_ORIGIN = "https://www.dnd5eapi.co";
const RACES_DATA_URL = new URL("../../game-data/srd/races.json", import.meta.url);

const DERIVED_TRAITS = new Map([
  ["breath-weapon", "dragonborn-ancestry"],
  ["damage-resistance", "dragonborn-ancestry"],
]);

/**
 * Fetch JSON from the API with basic error handling.
 * @param {string} url
 * @returns {Promise<any>}
 */
async function apiFetch(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed: ${url} - ${res.status}`);
  return res.json();
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeRegistryId(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/[_\s]+/g, "-");
  return /^[a-z0-9-]+$/.test(normalized) ? normalized : null;
}

/**
 * @param {string} url
 * @returns {string}
 */
function toApiUrl(url) {
  return url.startsWith("http") ? url : `${API_ORIGIN}${url}`;
}

/**
 * @returns {Promise<string[]>}
 */
async function collectReferencedTraitIds() {
  const rawData = await readFile(RACES_DATA_URL, "utf-8");
  const raceRecords = JSON.parse(rawData);
  if (!Array.isArray(raceRecords)) {
    throw new Error("Expected races.json to contain an array of records.");
  }
  return collectTraitIdsFromRaceRecords(raceRecords);
}

/**
 * @param {any[]} raceRecords
 * @returns {string[]}
 */
function collectTraitIdsFromRaceRecords(raceRecords) {
  const seen = new Set();
  const traitIds = [];

  for (const record of raceRecords) {
    const traits = record?.traits;
    if (!Array.isArray(traits)) continue;

    for (const traitId of traits) {
      const id = normalizeRegistryId(traitId);
      if (!id || id !== traitId) {
        throw new Error(`Malformed trait reference in races.json: ${String(traitId)}`);
      }
      if (seen.has(id)) continue;
      seen.add(id);
      traitIds.push(id);
    }
  }

  return traitIds;
}

/**
 * @param {any} traitsList
 * @param {string[]} referencedTraitIds
 * @returns {{ index: string, url: string }[]}
 */
function selectTraitRefs(traitsList, referencedTraitIds) {
  const referenced = new Set(referencedTraitIds);
  const results = traitsList?.results;
  if (!Array.isArray(results)) {
    throw new Error("Traits list is missing results.");
  }

  const refs = [];
  const found = new Set();
  for (const ref of results) {
    const id = validateTraitRef(ref);
    if (!referenced.has(id)) continue;
    refs.push({ index: id, url: ref.url });
    found.add(id);
  }

  const missing = referencedTraitIds.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new Error(`Referenced trait IDs missing from SRD API: ${missing.join(", ")}`);
  }

  return refs;
}

/**
 * @param {any} ref
 * @returns {string}
 */
function validateTraitRef(ref) {
  const id = normalizeRegistryId(ref?.index);
  if (!id || id !== ref.index) {
    throw new Error(`Trait list entry has malformed index: ${String(ref?.index)}`);
  }
  if (typeof ref.url !== "string" || ref.url.trim().length === 0) {
    throw new Error(`Trait list entry ${id} is missing url.`);
  }
  return id;
}

/**
 * @param {any} raw
 * @param {string} expectedId
 * @returns {object}
 */
function transformTrait(raw, expectedId) {
  const id = normalizeRegistryId(raw?.index);
  if (!id || id !== raw.index) {
    throw new Error(`Trait ${expectedId} has malformed index: ${String(raw?.index)}`);
  }
  if (id !== expectedId) {
    throw new Error(`Expected trait ${expectedId}, received ${id}.`);
  }

  const name = normalizeRequiredString(raw?.name, `Trait ${id} is missing name.`);
  const description = normalizeDescription(raw?.desc, id);

  const entry = {
    id,
    kind: "trait",
    name,
    source: "srd-5.1",
    description,
  };

  const derivedFrom = DERIVED_TRAITS.get(id);
  if (derivedFrom) {
    entry.derivedFrom = derivedFrom;
  }

  return entry;
}

/**
 * @param {unknown} value
 * @param {string} errorMessage
 * @returns {string}
 */
function normalizeRequiredString(value, errorMessage) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(errorMessage);
  }
  return value.trim();
}

/**
 * @param {unknown} value
 * @param {string} id
 * @returns {string}
 */
function normalizeDescription(value, id) {
  if (!Array.isArray(value)) {
    throw new Error(`Trait ${id} is missing description.`);
  }

  const paragraphs = value.map((paragraph) => normalizeRequiredString(
    paragraph,
    `Trait ${id} has malformed description text.`
  ));
  if (paragraphs.length === 0) {
    throw new Error(`Trait ${id} is missing description.`);
  }

  return paragraphs.join("\n\n");
}

/**
 * Main adapter function. Fetches SRD trait records referenced by current
 * races/subraces and returns normalized trait records ready to write to JSON.
 * @param {{ referencedTraitIds?: string[] }} [options]
 * @returns {Promise<object[]>}
 */
export async function buildTraitsData(options = {}) {
  const referencedTraitIds = options.referencedTraitIds ?? await collectReferencedTraitIds();

  console.log("Fetching traits list...");
  const traitsList = await apiFetch(`${BASE_URL}/traits`);
  const traitRefs = selectTraitRefs(traitsList, referencedTraitIds);

  console.log(`Found ${traitRefs.length} referenced traits. Fetching details...`);
  const details = await Promise.all(
    traitRefs.map((ref) => apiFetch(toApiUrl(ref.url)))
  );

  const entries = details.map((raw, index) => transformTrait(raw, traitRefs[index].index));
  return entries.toSorted((a, b) => String(a.name).localeCompare(String(b.name)));
}
