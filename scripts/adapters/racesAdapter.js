// @ts-check
// scripts/adapters/racesAdapter.js
//
// Transforms dnd5eapi /api/2014/races and /api/2014/subraces responses
// into the Lore Ledger races.json schema.
//
// Output schema per entry:
//   id             — stable kebab-case id (from API index)
//   kind           — "race" or "subrace"
//   name           — display name
//   source         — always "srd-5.1"
//   parentRace     — (subrace only) id of parent race
//   size           — "Small" | "Medium" etc.
//   speed          — base walking speed in feet (race only; subraces inherit)
//   abilityScoreIncreases — array of { ability, bonus }
//   traits         — array of trait ids (look up full text from traits.json)
//   languages      — array of language ids (race only)
//   subraceIds     — array of subrace ids (race only, may be empty)
//   choices        — array of build-time choices, only present when needed
//   lore           — { age, alignment, sizeDescription, languageDesc, desc }
//                    all optional, only present if API provides them

const BASE_URL = "https://www.dnd5eapi.co/api/2014";
const DRAGONBORN_RACE_ID = "dragonborn";
const HIGH_ELF_SUBRACE_ID = "high-elf";

/**
 * Fetch JSON from the API with basic error handling.
 * @param {string} url
 * @returns {Promise<any>}
 */
async function apiFetch(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed: ${url} — ${res.status}`);
  return res.json();
}

/**
 * Transform a raw API race entry into our schema.
 * @param {any} raw
 * @returns {object}
 */
function transformRace(raw) {
  const entry = {
    id: raw.index,
    kind: "race",
    name: raw.name,
    source: "srd-5.1",
    size: raw.size ?? null,
    speed: raw.speed ?? null,
    abilityScoreIncreases: (raw.ability_bonuses ?? []).map((b) => ({
      ability: b.ability_score.index,
      bonus: b.bonus,
    })),
    traits: (raw.traits ?? []).map((t) => t.index),
    languages: (raw.languages ?? []).map((l) => l.index),
    subraceIds: (raw.subraces ?? []).map((s) => s.index),
    lore: buildLore({
      age: raw.age,
      alignment: raw.alignment,
      sizeDescription: raw.size_description,
      languageDesc: raw.language_desc,
    }),
  };

  const choices = buildRaceChoices(raw);
  if (choices.length > 0) {
    entry.choices = choices;
  }

  return entry;
}

/**
 * Transform a raw API subrace entry into our schema.
 * @param {any} raw
 * @returns {object}
 */
function transformSubrace(raw) {
  const entry = {
    id: raw.index,
    kind: "subrace",
    name: raw.name,
    source: "srd-5.1",
    parentRace: raw.race?.index ?? null,
    abilityScoreIncreases: (raw.ability_bonuses ?? []).map((b) => ({
      ability: b.ability_score.index,
      bonus: b.bonus,
    })),
    traits: (raw.racial_traits ?? []).map((t) => t.index),
    lore: buildLore({
      desc: raw.desc,
    }),
  };

  const choices = buildSubraceChoices(raw);
  if (choices.length > 0) {
    entry.choices = choices;
  }

  return entry;
}

/**
 * Build-time choices a subrace grants. Like Dragonborn's ancestry choice on
 * the race side, the High Elf wizard-cantrip choice is a fixed SRD 5.1 grant
 * (the API models it as `trait_specific.spell_options` on the high-elf-cantrip
 * trait: choose 1 from the wizard cantrip list, Intelligence casts it). It is
 * emitted here as a filtered spell-list choice rather than a hand-enumerated
 * options list so the choice stays correct if the wizard cantrip registry
 * changes.
 * @param {any} raw
 * @returns {object[]}
 */
function buildSubraceChoices(raw) {
  const choices = [];
  if (normalizeRegistryId(raw?.index) === HIGH_ELF_SUBRACE_ID) {
    choices.push({
      id: "high-elf-cantrip",
      kind: "cantrip",
      count: 1,
      from: { type: "list", source: "spells", filter: { classId: "wizard", maxLevel: 0 } },
      source: "subrace:high-elf",
      spellcastingAbility: "int",
    });
  }
  return choices;
}

/**
 * Build a lore object, omitting any fields that are empty/missing.
 * @param {Record<string, string | undefined>} fields
 * @returns {Record<string, string> | null}
 */
function buildLore(fields) {
  const lore = /** @type {Record<string, string>} */ ({});
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === "string" && value.trim().length > 0) {
      lore[key] = value.trim();
    }
  }
  return Object.keys(lore).length > 0 ? lore : null;
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
 * @param {any} raw
 * @returns {object[]}
 */
function buildRaceChoices(raw) {
  const choices = [];
  const languageChoice = buildLanguageChoice(raw);
  if (languageChoice) choices.push(languageChoice);

  if (normalizeRegistryId(raw?.index) === DRAGONBORN_RACE_ID) {
    choices.push({
      id: "dragonborn-ancestry",
      kind: "ancestry",
      count: 1,
      from: { type: "list", source: "draconic-ancestries" },
      source: "race:dragonborn",
    });
  }

  return choices;
}

/**
 * @param {any} raw
 * @returns {object | null}
 */
function buildLanguageChoice(raw) {
  const raceId = normalizeRegistryId(raw?.index);
  const languageOptions = raw?.language_options;
  const count = Number(languageOptions?.choose);

  if (!raceId || languageOptions?.type !== "languages" || !Number.isInteger(count) || count < 1) {
    return null;
  }

  const optionIds = collectLanguageOptionIds(languageOptions);

  return {
    id: `${raceId}-language`,
    kind: "language",
    count,
    from: optionIds.length > 0
      ? { type: "list", options: optionIds }
      : { type: "any" },
    source: `race:${raceId}`,
  };
}

/**
 * @param {any} languageOptions
 * @returns {string[]}
 */
function collectLanguageOptionIds(languageOptions) {
  const options = languageOptions?.from?.options;
  if (!Array.isArray(options)) return [];

  const seen = new Set();
  const ids = [];
  for (const option of options) {
    const id = normalizeRegistryId(option?.item?.index);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/**
 * Main adapter function. Fetches all races and subraces from the API
 * and returns a combined array ready to write to races.json.
 * @returns {Promise<object[]>}
 */
export async function buildRacesData() {
  console.log("Fetching races list...");
  const racesList = await apiFetch(`${BASE_URL}/races`);

  console.log(`Found ${racesList.count} races. Fetching details...`);
  const raceDetails = await Promise.all(
    racesList.results.map((r) => apiFetch(`${BASE_URL}/races/${r.index}`))
  );

  console.log("Fetching subraces list...");
  const subracesList = await apiFetch(`${BASE_URL}/subraces`);

  console.log(`Found ${subracesList.count} subraces. Fetching details...`);
  const subraceDetails = await Promise.all(
    subracesList.results.map((s) => apiFetch(`${BASE_URL}/subraces/${s.index}`))
  );

  const races = raceDetails.map(transformRace);
  const subraces = subraceDetails.map(transformSubrace);

  // Races first, then subraces — keeps the file readable
  return [...races, ...subraces];
}
