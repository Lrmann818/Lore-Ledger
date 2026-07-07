// @ts-check
// Shipped builtin SRD 5.1 content, loaded from the generated registry files
// in game-data/srd/. Those files are produced by scripts/fetch-srd-data.js —
// never hand-edited. See docs/reference/content-registry-plan.md.

import backgrounds from "../../../game-data/srd/backgrounds.json";
import classes from "../../../game-data/srd/classes.json";
import draconicAncestries from "../../../game-data/srd/draconic-ancestries.json";
import armor from "../../../game-data/srd/equipment.armor.json";
import weapons from "../../../game-data/srd/equipment.weapons.json";
import feats from "../../../game-data/srd/feats.json";
import features from "../../../game-data/srd/features.json";
import languages from "../../../game-data/srd/languages.json";
import races from "../../../game-data/srd/races.json";
import skills from "../../../game-data/srd/skills.json";
import spells from "../../../game-data/srd/spells.json";
import subclasses from "../../../game-data/srd/subclasses.json";
import traits from "../../../game-data/srd/traits.json";

/**
 * @typedef {"race" | "subrace" | "class" | "subclass" | "background" | "feat"
 *   | "trait" | "ancestry" | "armor" | "weapon" | "spell" | "language"
 *   | "skill" | "feature"} BuiltinContentKind
 * @typedef {{
 *   id: string,
 *   kind: BuiltinContentKind,
 *   name: string,
 *   source: string,
 *   ruleset: "srd-5.1",
 *   data: Record<string, unknown>
 * }} BuiltinContentEntry
 */

const RULESET = "srd-5.1";

/** @type {ReadonlySet<string>} */
export const CONTENT_KINDS = new Set([
  "race", "subrace", "class", "subclass", "background", "feat", "trait",
  "ancestry", "armor", "weapon", "spell", "language", "skill", "feature"
]);

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Wrap a generated registry record into the runtime entry shape.
 * Records missing required base fields are skipped defensively.
 * @param {unknown} record
 * @returns {BuiltinContentEntry | null}
 */
export function toContentEntry(record) {
  if (!isRecord(record)) return null;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const kind = typeof record.kind === "string" ? record.kind.trim() : "";
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const source = typeof record.source === "string" && record.source.trim()
    ? record.source.trim()
    : "srd-5.1";
  if (!id || !name || !CONTENT_KINDS.has(kind)) return null;
  return Object.freeze({
    id,
    kind: /** @type {BuiltinContentKind} */ (kind),
    name,
    source,
    ruleset: RULESET,
    data: /** @type {Record<string, unknown>} */ (record)
  });
}

/**
 * @param {unknown} records
 * @returns {BuiltinContentEntry[]}
 */
function toContentEntries(records) {
  if (!Array.isArray(records)) return [];
  /** @type {BuiltinContentEntry[]} */
  const out = [];
  for (const record of records) {
    const entry = toContentEntry(record);
    if (entry) out.push(entry);
  }
  return out;
}

/** @type {readonly BuiltinContentEntry[]} */
export const BUILTIN_CONTENT = Object.freeze([
  ...toContentEntries(races),
  ...toContentEntries(classes),
  ...toContentEntries(subclasses),
  ...toContentEntries(backgrounds),
  ...toContentEntries(feats),
  ...toContentEntries(traits),
  ...toContentEntries(draconicAncestries),
  ...toContentEntries(armor),
  ...toContentEntries(weapons),
  ...toContentEntries(spells),
  ...toContentEntries(languages),
  ...toContentEntries(skills),
  ...toContentEntries(features)
]);
