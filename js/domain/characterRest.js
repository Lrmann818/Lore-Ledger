// @ts-check
// Character rest recovery helpers.

import {
  limitedUseRecoveryMatchesRest,
  normalizeManualFeatureCards
} from "./manualFeatureCards.js";
import { recoverDerivedFeatureUses } from "./featureUses.js";
import { deriveCharacter } from "./rules/deriveCharacter.js";

/** @typedef {import("../state.js").CharacterEntry} CharacterEntry */
/** @typedef {"shortRest" | "longRest"} CharacterRestType */
/** @typedef {"shortRest" | "longRest" | "shortOrLongRest" | "manual" | "none"} CharacterRecoveryMode */
/** @typedef {{ character: CharacterEntry, changed: boolean }} CharacterRestRecoveryResult */

/**
 * @param {unknown} value
 * @returns {value is CharacterRestType}
 */
function isSupportedRestType(value) {
  return value === "shortRest" || value === "longRest";
}

/**
 * @param {unknown} recovery
 * @param {CharacterRestType} restType
 * @returns {boolean}
 */
function recoveryMatchesRest(recovery, restType) {
  if (recovery === "shortOrLongRest") return true;
  if (restType === "shortRest") return recovery === "shortRest";
  if (restType === "longRest") return recovery === "longRest";
  return false;
}

/**
 * Whether a spell-slot level refills on the given rest. The v2 spells model has
 * no per-level recovery metadata, so recovery is inferred from the label:
 * every slot level refills on a long rest, while a short rest only refills Pact
 * Magic (Warlock) slots — matching SRD 5.1 rest rules. Slot-less levels
 * (cantrips) and custom labels without slots recover nothing.
 * @param {Record<string, unknown>} level
 * @param {CharacterRestType} restType
 * @returns {boolean}
 */
function spellLevelRefillsOnRest(level, restType) {
  if (!level || level.hasSlots !== true) return false;
  if (restType === "longRest") return true;
  const label = typeof level.label === "string" ? level.label.toLowerCase() : "";
  return restType === "shortRest" && label.includes("pact");
}

/**
 * Refills spell slot usage for a rest without disturbing known/prepared flags,
 * spell notes, level labels, or slot totals. "used" tracks currently available
 * slots (full == total), mirroring the per-level Reset control; a rest sets it
 * back to full and clears each spell's cast/expended flag. Returns the original
 * object reference when nothing changed.
 * @param {unknown} spells
 * @param {CharacterRestType} restType
 * @returns {{ spells: unknown, changed: boolean }}
 */
function recoverSpellSlotsForRest(spells, restType) {
  if (!spells || typeof spells !== "object" || Array.isArray(spells)) return { spells, changed: false };
  const levels = /** @type {{ levels?: unknown }} */ (spells).levels;
  if (!Array.isArray(levels)) return { spells, changed: false };

  let changed = false;
  const nextLevels = levels.map((level) => {
    if (!level || typeof level !== "object" || Array.isArray(level)) return level;
    const record = /** @type {Record<string, unknown>} */ (level);
    if (!spellLevelRefillsOnRest(record, restType)) return level;

    let levelChanged = false;
    // Refill available slots to full (used == total).
    const refill = Number.isFinite(record.total) ? record.total : null;
    let nextUsed = record.used;
    if (record.used !== refill) {
      nextUsed = refill;
      levelChanged = true;
    }
    // Clear cast/expended flags; leave known/prepared/notes untouched.
    const levelSpells = Array.isArray(record.spells) ? record.spells : [];
    let nextSpells = levelSpells;
    if (levelSpells.some((spell) => spell && typeof spell === "object" && spell.expended)) {
      nextSpells = levelSpells.map((spell) => (
        spell && typeof spell === "object" && spell.expended ? { ...spell, expended: false } : spell
      ));
      levelChanged = true;
    }
    if (!levelChanged) return level;
    changed = true;
    return { ...record, used: nextUsed, spells: nextSpells };
  });

  if (!changed) return { spells, changed: false };
  return { spells: { ...spells, levels: nextLevels }, changed: true };
}

/**
 * Recovers explicitly tagged current/max resource counters, manual feature-use
 * counters, and currently-derived feature-specific use counters on one character.
 * Untagged, manual, none, and unknown recovery metadata is intentionally ignored.
 *
 * @param {CharacterEntry} character
 * @param {CharacterRestType} restType
 * @returns {CharacterRestRecoveryResult}
 */
export function recoverCharacterForRest(character, restType) {
  if (!character || typeof character !== "object" || !isSupportedRestType(restType)) {
    return { character, changed: false };
  }

  const resources = Array.isArray(character.resources) ? character.resources : [];
  let changed = false;
  const nextResources = resources.map((resource) => {
    if (!resource || typeof resource !== "object") return resource;
    if (!recoveryMatchesRest(resource.recovery, restType)) return resource;
    if (!Number.isFinite(resource.cur) || !Number.isFinite(resource.max)) return resource;
    if (resource.cur >= resource.max) return resource;
    changed = true;
    return { ...resource, cur: resource.max };
  });

  const manualFeatureCards = normalizeManualFeatureCards(character.manualFeatureCards);
  const nextManualFeatureCards = manualFeatureCards.map((card) => {
    const limitedUse = card.limitedUse;
    if (!limitedUse || !limitedUseRecoveryMatchesRest(limitedUse.recovery, restType)) return card;
    if (limitedUse.current >= limitedUse.max) return card;
    changed = true;
    return { ...card, limitedUse: { ...limitedUse, current: limitedUse.max } };
  });

  const derivedFeatures = deriveCharacter(character).derivedFeatureActions;
  const featureUseResult = recoverDerivedFeatureUses(character.featureUses, derivedFeatures, restType);
  if (featureUseResult.changed) changed = true;

  const spellSlotResult = recoverSpellSlotsForRest(character.spells, restType);
  if (spellSlotResult.changed) changed = true;

  if (!changed) return { character, changed: false };
  const nextCharacter = {
    ...character,
    resources: nextResources,
    manualFeatureCards: nextManualFeatureCards
  };
  if (featureUseResult.changed) nextCharacter.featureUses = featureUseResult.featureUses;
  if (spellSlotResult.changed) {
    nextCharacter.spells = /** @type {CharacterEntry["spells"]} */ (spellSlotResult.spells);
  }
  return { character: nextCharacter, changed: true };
}
