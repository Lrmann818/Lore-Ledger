// @ts-check
// Finish-time sheet seeding helpers for narrow builder slices.

import { isBuilderCharacter } from "./characterHelpers.js";
import { deriveCharacter } from "./rules/deriveCharacter.js";
import { BUILTIN_CONTENT_REGISTRY, getContentById } from "./rules/registry.js";

const DRAGONBORN_RACE_ID = "dragonborn";
const DRAGONBORN_LANGUAGE_LABELS = /** @type {Readonly<Record<string, string>>} */ (Object.freeze({
  common: "Common",
  draconic: "Draconic"
}));

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function existingText(value) {
  return typeof value === "string" ? value : "";
}

/**
 * @param {unknown} character
 * @returns {string}
 */
function getBuildRaceId(character) {
  if (!isPlainObject(character) || !isPlainObject(character.build)) return "";
  return cleanString(character.build.raceId || character.build.race);
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeLine(value) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * @param {string} existing
 * @param {string[]} seedLines
 * @param {(normalizedExistingLine: string, normalizedSeedLine: string) => boolean} hasEquivalent
 * @returns {string}
 */
function appendMissingLines(existing, seedLines, hasEquivalent) {
  const existingText = typeof existing === "string" ? existing : "";
  const normalizedExistingLines = existingText
    .split(/\r?\n/)
    .map(normalizeLine)
    .filter(Boolean);
  const missing = seedLines.filter((line) => {
    const normalizedSeed = normalizeLine(line);
    if (!normalizedSeed) return false;
    return !normalizedExistingLines.some((existingLine) => hasEquivalent(existingLine, normalizedSeed));
  });

  if (!missing.length) return existingText;
  if (!existingText) return missing.join("\n");
  return `${existingText}${/\r?\n$/.test(existingText) ? "" : "\n"}${missing.join("\n")}`;
}

/**
 * @param {string} existing
 * @param {string[]} seedLines
 * @returns {string}
 */
function appendMissingFeatureLines(existing, seedLines) {
  return appendMissingLines(existing, seedLines, (existingLine, seedLine) => {
    if (seedLine.startsWith("draconic ancestry:")) return existingLine.startsWith("draconic ancestry:");
    if (seedLine.startsWith("damage resistance:")) return existingLine.startsWith("damage resistance:");
    return existingLine === seedLine;
  });
}

/**
 * @param {unknown} value
 * @returns {Set<string>}
 */
function getExistingLanguageLabels(value) {
  if (typeof value !== "string") return new Set();
  return new Set(
    value
      .split(/[\r\n,;]+/)
      .map((entry) => entry.trim().replace(/\s+/g, " ").toLowerCase())
      .filter(Boolean)
  );
}

/**
 * @param {unknown[]} languageIds
 * @returns {string[]}
 */
function getDragonbornLanguageLabels(languageIds) {
  return languageIds
    .map((id) => DRAGONBORN_LANGUAGE_LABELS[cleanString(id)])
    .filter((label) => typeof label === "string" && label.length > 0);
}

/**
 * @param {string} existing
 * @param {string[]} seedLanguages
 * @returns {string}
 */
function appendMissingLanguages(existing, seedLanguages) {
  const existingText = typeof existing === "string" ? existing : "";
  const existingLabels = getExistingLanguageLabels(existingText);
  const missing = seedLanguages.filter((label) => !existingLabels.has(label.toLowerCase()));
  if (!missing.length) return existingText;
  if (!existingText) return missing.join("\n");
  return `${existingText}${/\r?\n$/.test(existingText) ? "" : "\n"}${missing.join("\n")}`;
}

/**
 * Returns the existing character field values that should be seeded during the
 * builder wizard Finish step. Seeded values are user-owned after creation.
 *
 * @param {unknown} character
 * @param {import("./rules/registry.js").ContentRegistry} [registry]
 * @returns {Partial<Pick<import("../state.js").CharacterEntry, "features" | "languages">>}
 */
export function getBuilderFinishSheetSeedPatch(character, registry = BUILTIN_CONTENT_REGISTRY) {
  if (!isBuilderCharacter(character)) return {};
  const source = /** @type {Record<string, unknown>} */ (character);
  const raceId = getBuildRaceId(source);
  if (raceId !== DRAGONBORN_RACE_ID) return {};

  const raceEntry = getContentById(registry, raceId);
  if (!raceEntry || raceEntry.kind !== "race" || raceEntry.id !== DRAGONBORN_RACE_ID) return {};

  let derived;
  try {
    derived = deriveCharacter(character, registry);
  } catch (err) {
    console.warn("Builder sheet seeding derivation failed:", err);
    return {};
  }

  const ancestry = derived.dragonbornAncestry;
  if (!ancestry) return {};

  const ancestryName = cleanString(ancestry.name);
  const damageType = cleanString(ancestry.damageResistance || ancestry.damageType).toLowerCase();
  if (!ancestryName || !damageType) return {};

  const patch = /** @type {Partial<Pick<import("../state.js").CharacterEntry, "features" | "languages">>} */ ({});
  const existingFeatures = existingText(source.features);
  const nextFeatures = appendMissingFeatureLines(existingFeatures, [
    "Dragonborn Traits",
    `Draconic Ancestry: ${ancestryName}`,
    `Damage Resistance: You have resistance to ${damageType} damage.`
  ]);
  if (nextFeatures !== existingFeatures) patch.features = nextFeatures;

  const languageIds = Array.isArray(raceEntry.data?.languages) ? raceEntry.data.languages : [];
  const languageLabels = getDragonbornLanguageLabels(languageIds);
  if (languageLabels.length) {
    const existingLanguages = existingText(source.languages);
    const nextLanguages = appendMissingLanguages(existingLanguages, languageLabels);
    if (nextLanguages !== existingLanguages) patch.languages = nextLanguages;
  }

  return patch;
}
