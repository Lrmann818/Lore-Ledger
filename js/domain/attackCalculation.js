// @ts-check
// Canonical structured-attack model and calculator.
//
// This module owns ALL attack math (see
// docs/reference/character-calculation-contract.md → "Attack calculation
// ownership"). Builder Finish seeding, the attack editor, the character-page
// Attacks panel, and the combat embedded Weapons panel derive display values
// through `getAttackDisplayModel()` — there is no second formula anywhere.
//
// An attack row is structured when it carries a `calc` block:
//
//   calc: {
//     mode: "weapon" | "ability" | "spell" | "fixed",
//     weaponId,            // weapon mode: registry weapon (builtin or custom)
//     ability,             // "" = auto (weapon rule / primary spellcasting)
//     proficient,          // explicit stored input — never assumed
//     baseDamage,          // dice; "" = from the weapon record (weapon mode)
//     damageAbility,       // "" = same ability as the attack roll
//     addAbilityToDamage,
//     damageType, range,   // "" = from the weapon record (weapon mode)
//     attackAdjustment,    // explicit homebrew adjustments — stored separately
//     damageAdjustment     // so recalculation can never erase them
//   }
//
// Modes "weapon" / "ability" / "spell" derive live: displayed values are a
// pure function of current character state plus the calc inputs, so ability
// or proficiency changes update attacks automatically. Mode "fixed" is the
// intentional fixed override: the stored strings are the display. Rows with
// no calc block are legacy snapshots — they keep their stored strings until
// the user explicitly converts them (display names are never used to infer a
// source weapon). `name`, `notes`, `id`, and row order stay user-owned in
// every mode.

import { CHARACTER_ABILITY_KEYS } from "./characterHelpers.js";
import { deriveCharacter } from "./rules/deriveCharacter.js";
import { getContentByKind } from "./rules/registry.js";

/** @typedef {import("./rules/registry.js").ContentRegistry} ContentRegistry */
/** @typedef {import("./rules/builtinContent.js").BuiltinContentEntry} ContentEntry */
/** @typedef {import("../state.js").AttackEntry} AttackEntry */

/**
 * Marker prefix stamped on weapon-linked attack rows (the
 * inventoryItems[].builderSeed precedent — an optional extra key, no schema
 * change). Survives renames, so the source weapon stays resolvable even
 * after the user edits the name.
 */
export const ATTACK_WEAPON_SEED_PREFIX = "weapon:";

/** The closed calculation-mode vocabulary. */
export const ATTACK_CALC_MODES = Object.freeze(["weapon", "ability", "spell", "fixed"]);

/**
 * @param {string} weaponId
 * @returns {string}
 */
export function attackWeaponSeedMarker(weaponId) {
  return `${ATTACK_WEAPON_SEED_PREFIX}${weaponId}`;
}

/**
 * @param {unknown} attack
 * @returns {string} the linked weapon id, or "" when the attack is unlinked
 */
export function getAttackSourceWeaponId(attack) {
  if (!attack || typeof attack !== "object") return "";
  const marker = /** @type {{ builderSeed?: unknown }} */ (attack).builderSeed;
  if (typeof marker !== "string" || !marker.startsWith(ATTACK_WEAPON_SEED_PREFIX)) return "";
  return marker.slice(ATTACK_WEAPON_SEED_PREFIX.length).trim();
}

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
 * @returns {number}
 */
function finiteNumberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * @param {number} value
 * @returns {string}
 */
function signedNumber(value) {
  return value >= 0 ? `+${value}` : String(value);
}

/**
 * @param {string} value
 * @returns {string}
 */
function titleCaseWords(value) {
  return value.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

/**
 * @param {unknown} value
 * @returns {string} a valid ability key or ""
 */
function abilityKeyOrEmpty(value) {
  const key = cleanString(value);
  return CHARACTER_ABILITY_KEYS.includes(/** @type {typeof CHARACTER_ABILITY_KEYS[number]} */ (key)) ? key : "";
}

/**
 * @typedef {{
 *   mode: "weapon" | "ability" | "spell" | "fixed",
 *   weaponId: string,
 *   ability: string,
 *   proficient: boolean,
 *   baseDamage: string,
 *   damageAbility: string,
 *   addAbilityToDamage: boolean,
 *   damageType: string,
 *   range: string,
 *   attackAdjustment: number,
 *   damageAdjustment: number
 * }} AttackCalc
 */

/**
 * Defensive read of a persisted `calc` block. Returns null for anything that
 * is not a structured calc (missing, malformed, unknown mode) — such rows are
 * legacy snapshots and keep their stored strings.
 *
 * @param {unknown} value
 * @returns {AttackCalc | null}
 */
export function normalizeAttackCalc(value) {
  if (!isPlainObject(value)) return null;
  const mode = cleanString(value.mode);
  if (!ATTACK_CALC_MODES.includes(/** @type {AttackCalc["mode"]} */ (mode))) return null;
  return {
    mode: /** @type {AttackCalc["mode"]} */ (mode),
    weaponId: cleanString(value.weaponId),
    ability: abilityKeyOrEmpty(value.ability),
    proficient: value.proficient === true,
    baseDamage: cleanString(value.baseDamage),
    damageAbility: abilityKeyOrEmpty(value.damageAbility),
    addAbilityToDamage: value.addAbilityToDamage === true,
    damageType: cleanString(value.damageType),
    range: cleanString(value.range),
    attackAdjustment: finiteNumberOrZero(value.attackAdjustment),
    damageAdjustment: finiteNumberOrZero(value.damageAdjustment)
  };
}

/**
 * The calc block Finish seeding and explicit weapon linking stamp onto a row.
 * @param {string} weaponId
 * @param {{ proficient?: boolean }} [options]
 * @returns {AttackCalc}
 */
export function buildWeaponAttackCalc(weaponId, options = {}) {
  return {
    mode: "weapon",
    weaponId: cleanString(weaponId),
    ability: "",
    proficient: options.proficient !== false,
    baseDamage: "",
    damageAbility: "",
    addAbilityToDamage: true,
    damageType: "",
    range: "",
    attackAdjustment: 0,
    damageAdjustment: 0
  };
}

/**
 * Whether the character's derived proficiencies cover a weapon record.
 * Class lists mix categories ("simple", "martial") with specific pluralized
 * weapon tokens ("longswords", "crossbows-light"); weapon ids are singular.
 * This is a **default suggestion** for seeding and the editor — the stored
 * `calc.proficient` input is always authoritative, because some grants
 * (race-trait text like Elf Weapon Training, homebrew) are not structured.
 *
 * @param {ReturnType<typeof deriveCharacter>} derived
 * @param {ContentEntry | null | undefined} weaponEntry
 * @returns {boolean}
 */
export function isWeaponProficient(derived, weaponEntry) {
  if (!weaponEntry) return false;
  const tokens = Array.isArray(derived?.proficiencies?.weapons) ? derived.proficiencies.weapons : [];
  if (!tokens.length) return false;
  const category = cleanString(weaponEntry.data?.weaponCategory);
  const weaponId = cleanString(weaponEntry.id);
  const singularize = (/** @type {string} */ token) =>
    token.split("-").map((word) => word.replace(/s$/, "")).join("-");
  const weaponKey = singularize(weaponId);
  for (const raw of tokens) {
    const token = cleanString(raw);
    if (!token) continue;
    if (token === category) return true;
    if (token === weaponId || singularize(token) === weaponKey) return true;
  }
  return false;
}

/**
 * @typedef {{
 *   mode: "legacy" | AttackCalc["mode"],
 *   derived: boolean,
 *   bonus: string,
 *   damage: string,
 *   range: string,
 *   type: string,
 *   weaponId: string,
 *   weaponName: string,
 *   breakdown: {
 *     abilityKey: string,
 *     abilityModifier: number | null,
 *     proficient: boolean,
 *     proficiencyBonus: number | null,
 *     attackAdjustment: number,
 *     calculatedBonus: number | null,
 *     baseDamage: string,
 *     damageAbilityKey: string,
 *     damageModifier: number | null,
 *     damageAdjustment: number
 *   } | null,
 *   warnings: string[]
 * }} AttackDisplayModel
 */

/**
 * @param {ReturnType<typeof deriveCharacter>} derived
 * @param {string} key
 * @returns {number | null}
 */
function abilityModifierFor(derived, key) {
  if (!key) return null;
  const value = derived?.abilities?.[key]?.modifier;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Resolves which ability the attack roll uses. Weapon rule: ranged uses DEX,
 * finesse uses the better of STR/DEX, everything else STR. Spell attacks use
 * the primary spellcasting ability unless the calc names one. An explicit
 * `calc.ability` always wins.
 *
 * @param {AttackCalc} calc
 * @param {Record<string, unknown> | null} weaponData
 * @param {ReturnType<typeof deriveCharacter>} derived
 * @returns {string} ability key or ""
 */
function resolveAttackAbilityKey(calc, weaponData, derived) {
  if (calc.ability) return calc.ability;
  if (calc.mode === "spell") {
    return abilityKeyOrEmpty(derived?.spellcasting?.primary?.ability);
  }
  if (calc.mode === "weapon" && weaponData) {
    const properties = Array.isArray(weaponData.properties) ? weaponData.properties : [];
    if (weaponData.attackType === "ranged") return "dex";
    if (properties.includes("finesse")) {
      const strMod = abilityModifierFor(derived, "str");
      const dexMod = abilityModifierFor(derived, "dex");
      if (strMod != null && dexMod != null) return dexMod > strMod ? "dex" : "str";
      if (dexMod != null) return "dex";
      return "str";
    }
    return "str";
  }
  return calc.mode === "ability" ? "str" : "";
}

/**
 * @param {Record<string, unknown>} data weapon record data
 * @returns {string}
 */
function weaponRangeLabel(data) {
  if (data.attackType === "ranged" && isPlainObject(data.range) && data.range.normal != null) {
    return `${data.range.normal}${data.range.long != null ? `/${data.range.long}` : ""} ft.`;
  }
  if (isPlainObject(data.throwRange) && data.throwRange.normal != null) {
    return `Melee, thrown ${data.throwRange.normal}${data.throwRange.long != null ? `/${data.throwRange.long}` : ""} ft.`;
  }
  return "Melee";
}

/**
 * @param {string} dice
 * @param {number} modifier combined ability modifier + adjustment
 * @returns {string}
 */
function formatDamage(dice, modifier) {
  if (dice) return `${dice}${modifier ? signedNumber(modifier) : ""}`;
  return modifier ? signedNumber(modifier) : "";
}

/**
 * The one attack display derivation. Pure: nothing is mutated. Structured
 * modes compute from calc inputs + the derived character; when a needed input
 * is missing (unset ability score, deleted weapon record) the affected fields
 * fall back to the row's stored strings and a warning explains why.
 *
 * @param {unknown} attack
 * @param {ReturnType<typeof deriveCharacter>} derived
 * @param {ContentRegistry} registry
 * @param {{ weaponEntry?: ContentEntry | null }} [options] pre-resolved weapon
 *   record (skips the registry lookup; used by seeding-time derivation)
 * @returns {AttackDisplayModel}
 */
export function getAttackDisplayModel(attack, derived, registry, options = {}) {
  const row = isPlainObject(attack) ? attack : {};
  const stored = {
    bonus: cleanString(row.bonus),
    damage: cleanString(row.damage),
    range: cleanString(row.range),
    type: cleanString(row.type)
  };
  const calc = normalizeAttackCalc(row.calc);

  /** @type {AttackDisplayModel} */
  const model = {
    mode: calc ? calc.mode : "legacy",
    derived: false,
    ...stored,
    weaponId: "",
    weaponName: "",
    breakdown: null,
    warnings: []
  };
  if (!calc || calc.mode === "fixed") return model;

  /** @type {ContentEntry | null} */
  let weaponEntry = null;
  /** @type {Record<string, unknown> | null} */
  let weaponData = null;
  if (calc.mode === "weapon") {
    const weaponId = calc.weaponId || getAttackSourceWeaponId(row);
    model.weaponId = weaponId;
    weaponEntry = options.weaponEntry && options.weaponEntry.id === weaponId
      ? options.weaponEntry
      : (weaponId ? getContentByKind(registry, "weapon", weaponId) : null);
    if (!weaponEntry) {
      model.warnings.push(weaponId
        ? `The linked weapon "${weaponId}" isn't available any more — showing the saved values.`
        : "This entry has no linked weapon — showing the saved values.");
      return model;
    }
    model.weaponName = weaponEntry.name;
    weaponData = isPlainObject(weaponEntry.data) ? weaponEntry.data : {};
  }

  const abilityKey = resolveAttackAbilityKey(calc, weaponData, derived);
  const abilityModifier = abilityModifierFor(derived, abilityKey);
  const proficiencyBonus = typeof derived?.proficiencyBonus === "number" && Number.isFinite(derived.proficiencyBonus)
    ? derived.proficiencyBonus
    : null;

  if (calc.mode === "spell" && !abilityKey) {
    model.warnings.push("No spellcasting ability is set for this attack — showing the saved values.");
  }
  if (abilityKey && abilityModifier == null) {
    model.warnings.push(`The ${abilityKey.toUpperCase()} score is not set — showing the saved attack bonus.`);
  }
  if (calc.proficient && proficiencyBonus == null) {
    model.warnings.push("No proficiency bonus is set — it was counted as 0.");
  }

  const damageAbilityKey = calc.addAbilityToDamage ? (calc.damageAbility || abilityKey) : "";
  const damageModifier = calc.addAbilityToDamage ? abilityModifierFor(derived, damageAbilityKey) : 0;
  const baseDamage = calc.baseDamage || cleanString(weaponData?.damage);

  const calculatedBonus = abilityModifier == null
    ? null
    : abilityModifier + (calc.proficient ? (proficiencyBonus ?? 0) : 0);

  model.derived = true;
  model.breakdown = {
    abilityKey,
    abilityModifier,
    proficient: calc.proficient,
    proficiencyBonus,
    attackAdjustment: calc.attackAdjustment,
    calculatedBonus,
    baseDamage,
    damageAbilityKey,
    damageModifier,
    damageAdjustment: calc.damageAdjustment
  };

  model.bonus = calculatedBonus == null
    ? stored.bonus
    : signedNumber(calculatedBonus + calc.attackAdjustment);

  if (calc.addAbilityToDamage && damageAbilityKey && damageModifier == null) {
    model.warnings.push(`The ${damageAbilityKey.toUpperCase()} score is not set — showing the saved damage.`);
    model.damage = stored.damage;
  } else {
    model.damage = formatDamage(baseDamage, (damageModifier ?? 0) + calc.damageAdjustment);
  }

  model.range = calc.range || (weaponData ? weaponRangeLabel(weaponData) : "");
  model.type = calc.damageType || (weaponData ? titleCaseWords(cleanString(weaponData.damageType)) : "");
  return model;
}

/**
 * Weapon → attack-row values, kept as the seeding-facing shape (`name` +
 * display strings). A thin wrapper over `getAttackDisplayModel`, so seeding
 * and live display can never drift.
 *
 * @param {ContentEntry} weapon
 * @param {ReturnType<typeof deriveCharacter>} derived
 * @param {{ proficient?: boolean }} [options] defaults to proficient
 * @returns {{ name: string, bonus: string, damage: string, range: string, type: string }}
 */
export function deriveWeaponAttack(weapon, derived, options = {}) {
  const calc = buildWeaponAttackCalc(weapon.id, options);
  const model = getAttackDisplayModel({ calc }, derived, /** @type {ContentRegistry} */ (null), { weaponEntry: weapon });
  return { name: weapon.name, bonus: model.bonus, damage: model.damage, range: model.range, type: model.type };
}

/**
 * The full seeded attack row for a chosen build weapon: display strings, the
 * structured calc block (so the row derives live from then on), and the
 * stable provenance marker. Proficiency is seeded from the character's
 * derived proficiencies — never assumed from being weapon-backed.
 *
 * @param {ContentEntry} weapon
 * @param {ReturnType<typeof deriveCharacter>} derived
 * @param {ContentRegistry} registry
 * @returns {Record<string, unknown>} row fields (id is the caller's job)
 */
export function buildSeededWeaponAttack(weapon, derived, registry) {
  const calc = buildWeaponAttackCalc(weapon.id, { proficient: isWeaponProficient(derived, weapon) });
  const model = getAttackDisplayModel({ calc }, derived, registry, { weaponEntry: weapon });
  return {
    name: weapon.name,
    bonus: model.bonus,
    damage: model.damage,
    range: model.range,
    type: model.type,
    calc,
    builderSeed: attackWeaponSeedMarker(weapon.id)
  };
}
