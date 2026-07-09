// @ts-check
// Character rest recovery helpers.

import {
  limitedUseRecoveryMatchesRest,
  normalizeManualFeatureCards
} from "./manualFeatureCards.js";
import { recoverDerivedFeatureUses } from "./featureUses.js";
import { deriveCharacter } from "./rules/deriveCharacter.js";
import { getActiveContentRegistry, getContentByKind, listContentByKind } from "./rules/registry.js";
import { getHitDicePools } from "./rules/progression.js";
import { normalizeCharacterRestState, normalizeDeathSaves } from "./characterHelpers.js";

/** @typedef {import("../state.js").CharacterEntry} CharacterEntry */
/** @typedef {"shortRest" | "longRest"} CharacterRestType */
/** @typedef {"shortRest" | "longRest" | "shortOrLongRest" | "manual" | "none"} CharacterRecoveryMode */
/** @typedef {{ character: CharacterEntry, changed: boolean }} CharacterRestRecoveryResult */

/**
 * @typedef {{
 *   id: string,
 *   classId: string | null,
 *   label: string,
 *   die: number,
 *   total: number,
 *   spent: number,
 *   available: number
 * }} RestHitDicePool
 */

/**
 * @typedef {{ character: CharacterEntry, changed: boolean, error?: string, summary?: Record<string, unknown>, recovery?: ReturnType<typeof getLongRestHitDiceRecovery> }} CharacterRestApplyResult
 */

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function finiteInteger(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.floor(parsed) : null;
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function restPoolIdForClass(classId) {
  return `class:${classId}`;
}

/**
 * The normalized, display-ready Hit Dice pools available to one character.
 * Builder pools come from the canonical progression helper; freeform entries
 * keep their manual amount/die values as a single pool.
 * @param {CharacterEntry} character
 * @returns {RestHitDicePool[]}
 */
export function getRestHitDicePools(character) {
  if (!character || typeof character !== "object") return [];
  const rest = normalizeCharacterRestState(character.rest);
  /** @type {Array<{ id: string, classId: string | null, label: string, die: number, total: number }>} */
  let rawPools = [];
  if (character.build && typeof character.build === "object") {
    const levels = Array.isArray(character.build.levels) ? character.build.levels : [];
    const registry = getActiveContentRegistry();
    rawPools = getHitDicePools(levels, registry)
      .map((pool) => {
        const die = finiteInteger(pool.die);
        const count = finiteInteger(pool.count);
        const classEntry = getContentByKind(registry, "class", pool.classId);
        if (!pool.classId || !die || die <= 0 || !count || count <= 0) return null;
        return {
          id: restPoolIdForClass(pool.classId),
          classId: pool.classId,
          label: `${classEntry?.name || pool.classId} d${die}`,
          die,
          total: count
        };
      })
      .filter(Boolean);
  } else {
    const die = finiteInteger(character.hitDieSize);
    const total = finiteInteger(character.hitDieAmt);
    if (die && die > 0 && total && total > 0) {
      rawPools = [{ id: "manual", classId: null, label: `Hit Dice d${die}`, die, total }];
    }
  }
  return rawPools.map((pool) => {
    const spent = Math.max(0, Math.min(pool.total, finiteInteger(rest.hitDiceSpent[pool.id]) || 0));
    return { ...pool, spent, available: pool.total - spent };
  });
}

/**
 * @param {CharacterEntry} character
 * @returns {{ totalSpent: number, recoveryCap: number, pools: RestHitDicePool[], requiresAllocation: boolean, automaticRecoveryByPool: Record<string, number> }}
 */
export function getLongRestHitDiceRecovery(character) {
  const pools = getRestHitDicePools(character).filter((pool) => pool.spent > 0);
  const totalSpent = pools.reduce((sum, pool) => sum + pool.spent, 0);
  const totalHitDice = getRestHitDicePools(character).reduce((sum, pool) => sum + pool.total, 0);
  const recoveryCap = totalSpent ? Math.min(totalSpent, Math.max(1, Math.floor(totalHitDice / 2))) : 0;
  const requiresAllocation = pools.length > 1 && recoveryCap < totalSpent;
  /** @type {Record<string, number>} */
  const automaticRecoveryByPool = {};
  if (!requiresAllocation && recoveryCap > 0) {
    if (pools.length === 1) {
      automaticRecoveryByPool[pools[0].id] = recoveryCap;
    } else {
      // Recovery equals every spent die, so no player choice remains.
      pools.forEach((pool) => { automaticRecoveryByPool[pool.id] = pool.spent; });
    }
  }
  return { totalSpent, recoveryCap, pools, requiresAllocation, automaticRecoveryByPool };
}

/**
 * @param {Record<string, unknown> | undefined | null} requested
 * @param {RestHitDicePool[]} pools
 * @param {number} requiredTotal
 * @returns {{ ok: true, allocation: Record<string, number> } | { ok: false, error: string }}
 */
function validateHitDiceAllocation(requested, pools, requiredTotal) {
  const source = isPlainObject(requested) ? requested : {};
  const byId = new Map(pools.map((pool) => [pool.id, pool]));
  /** @type {Record<string, number>} */
  const allocation = {};
  let total = 0;
  for (const [poolId, rawAmount] of Object.entries(source)) {
    const amount = finiteInteger(rawAmount);
    const pool = byId.get(poolId);
    if (!pool || amount == null || amount < 0 || amount > pool.spent) {
      return { ok: false, error: "invalid-hit-dice-allocation" };
    }
    if (amount > 0) {
      allocation[poolId] = amount;
      total += amount;
    }
  }
  return total === requiredTotal
    ? { ok: true, allocation }
    : { ok: false, error: "incomplete-hit-dice-allocation" };
}

/**
 * @param {CharacterEntry} character
 * @returns {number}
 */
function getConstitutionModifier(character) {
  const derived = deriveCharacter(character);
  const fromDerived = derived?.abilities?.con?.modifier;
  if (Number.isFinite(fromDerived)) return Number(fromDerived);
  const manual = character?.abilities?.con?.mod;
  return Number.isFinite(manual) ? Number(manual) : 0;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

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

/**
 * Applies Hit Dice selected during a Short Rest together with ordinary
 * short-rest recovery. Invalid selection or missing HP values leave the
 * character untouched.
 * @param {CharacterEntry} character
 * @param {{ spendByPool?: Record<string, unknown> }} [selection]
 * @param {{ rollDie?: (die: number) => number }} [options]
 * @returns {CharacterRestApplyResult}
 */
export function applyShortRest(character, selection = {}, options = {}) {
  if (!character || typeof character !== "object") return { character, changed: false, error: "invalid-character" };
  const pools = getRestHitDicePools(character);
  const requested = isPlainObject(selection.spendByPool) ? selection.spendByPool : {};
  /** @type {Record<string, number>} */
  const spentByPool = {};
  let spentTotal = 0;
  const poolById = new Map(pools.map((pool) => [pool.id, pool]));
  for (const [poolId, rawAmount] of Object.entries(requested)) {
    const amount = finiteInteger(rawAmount);
    const pool = poolById.get(poolId);
    if (!pool || amount == null || amount < 0 || amount > pool.available) {
      return { character, changed: false, error: "unavailable-hit-dice" };
    }
    if (amount > 0) {
      spentByPool[poolId] = amount;
      spentTotal += amount;
    }
  }

  const hpCur = finiteNumber(character.hpCur);
  const hpMax = finiteNumber(character.hpMax);
  if (spentTotal > 0 && (hpCur == null || hpMax == null || hpMax < 0)) {
    return { character, changed: false, error: "missing-hp-for-hit-dice" };
  }

  const base = recoverCharacterForRest(character, "shortRest");
  if (!spentTotal) return base;

  const rollDie = typeof options.rollDie === "function" ? options.rollDie : (die) => Math.floor(Math.random() * die) + 1;
  const conModifier = getConstitutionModifier(character);
  let healing = 0;
  for (const [poolId, count] of Object.entries(spentByPool)) {
    const die = poolById.get(poolId)?.die || 0;
    for (let index = 0; index < count; index += 1) {
      const rolled = finiteInteger(rollDie(die));
      const dieResult = Math.max(1, Math.min(die, rolled == null ? 1 : rolled));
      healing += Math.max(0, dieResult + conModifier);
    }
  }
  const rest = normalizeCharacterRestState(character.rest);
  const nextSpent = { ...rest.hitDiceSpent };
  for (const [poolId, amount] of Object.entries(spentByPool)) {
    nextSpent[poolId] = Math.min(poolById.get(poolId)?.total || amount, (nextSpent[poolId] || 0) + amount);
  }
  const healedHp = Math.min(hpMax, hpCur + healing);
  const nextCharacter = {
    ...base.character,
    hpCur: healedHp,
    rest: { ...rest, hitDiceSpent: nextSpent }
  };
  return {
    character: nextCharacter,
    changed: true,
    summary: { spentByPool, healing: healedHp - hpCur }
  };
}

/**
 * @param {CharacterEntry} character
 * @param {string} classId
 * @returns {number | null}
 */
export function getPreparedSpellCapacity(character, classId) {
  const derived = deriveCharacter(character);
  const caster = derived.spellcasting?.classes.find((entry) => entry.classId === classId);
  if (!caster || (caster.preparationMode !== "prepared" && caster.preparationMode !== "spellbook")) return null;
  return Number.isFinite(caster.preparedMax) ? caster.preparedMax : null;
}

/**
 * Gets builder-managed prepared-caster options from the SRD registry. The UI
 * receives candidates and capacity; it never contains a class formula.
 * @param {CharacterEntry} character
 * @returns {Array<{ classId: string, className: string, preparationMode: string, capacity: number, selectedIds: string[], grantedIds: string[], candidateIds: string[] }>}
 */
export function getBuilderPreparedSpellOptions(character) {
  if (!character?.build || typeof character.build !== "object") return [];
  const registry = getActiveContentRegistry();
  const derived = deriveCharacter(character, registry);
  const rest = normalizeCharacterRestState(character.rest);
  const spellcastingSelections = isPlainObject(character.build.spellcasting) ? character.build.spellcasting : {};
  const maxSpellLevel = derived.spellcasting?.slots.reduce((max, count, index) => (
    count > 0 ? Math.max(max, index + 1) : max
  ), 0) || 0;

  return (derived.spellcasting?.classes || [])
    .filter((caster) => caster.preparationMode === "prepared" || caster.preparationMode === "spellbook")
    .map((caster) => {
      const selection = isPlainObject(spellcastingSelections[caster.classId])
        ? spellcastingSelections[caster.classId]
        : {};
      const legacyPrepared = Array.isArray(selection.preparedIds) ? selection.preparedIds : [];
      const selectedIds = Array.isArray(rest.preparedByClass[caster.classId])
        ? rest.preparedByClass[caster.classId]
        : legacyPrepared;
      const grantedIds = derived.grantedSpells
        .filter((grant) => grant.classId === caster.classId)
        .map((grant) => grant.spellId);
      const spellbookIds = Array.isArray(selection.knownIds) ? selection.knownIds : [];
      const candidateIds = listContentByKind(registry, "spell")
        .filter((entry) => {
          const level = finiteInteger(entry.data?.level) || 0;
          if (level < 1 || level > maxSpellLevel) return false;
          if (caster.preparationMode === "spellbook") return spellbookIds.includes(entry.id);
          const classIds = Array.isArray(entry.data?.classIds) ? entry.data.classIds : [];
          return classIds.includes(caster.classId);
        })
        .map((entry) => entry.id);
      const capacity = getPreparedSpellCapacity(character, caster.classId);
      return {
        classId: caster.classId,
        className: caster.className,
        preparationMode: caster.preparationMode,
        capacity: capacity == null ? 0 : capacity,
        selectedIds: [...new Set(selectedIds.filter((id) => typeof id === "string"))],
        grantedIds: [...new Set(grantedIds)],
        candidateIds
      };
    });
}

/**
 * @param {CharacterEntry} character
 * @param {Record<string, unknown>} preparedByClass
 * @returns {{ ok: true, preparedByClass: Record<string, string[]> } | { ok: false, error: string }}
 */
export function validateBuilderPreparedSpellSelections(character, preparedByClass) {
  const source = isPlainObject(preparedByClass) ? preparedByClass : {};
  /** @type {Record<string, string[]>} */
  const next = {};
  for (const option of getBuilderPreparedSpellOptions(character)) {
    const rawSelection = /** @type {unknown[]} */ (Array.isArray(source[option.classId]) ? source[option.classId] : option.selectedIds);
    const selected = [...new Set(rawSelection.filter((id) => typeof id === "string").map(cleanString).filter(Boolean))];
    if (selected.length > option.capacity) return { ok: false, error: `prepared-capacity:${option.classId}` };
    const candidates = new Set(option.candidateIds);
    if (selected.some((id) => !candidates.has(id))) return { ok: false, error: `invalid-prepared-spell:${option.classId}` };
    next[option.classId] = selected;
  }
  return { ok: true, preparedByClass: next };
}

/**
 * Applies the Long Rest's core recovery after the caller has collected a
 * valid manual allocation when one is required. Prepared selections are
 * validated here so rest and preparation commit together.
 * @param {CharacterEntry} character
 * @param {{ recoverByPool?: Record<string, unknown>, preparedByClass?: Record<string, unknown> }} [selection]
 * @returns {CharacterRestApplyResult}
 */
export function applyLongRest(character, selection = {}) {
  if (!character || typeof character !== "object") return { character, changed: false, error: "invalid-character" };
  const hpCur = finiteNumber(character.hpCur);
  const hpMax = finiteNumber(character.hpMax);
  if (hpCur == null || hpCur < 1 || hpMax == null || hpMax < 1) {
    return { character, changed: false, error: "long-rest-requires-positive-hp" };
  }

  const recovery = getLongRestHitDiceRecovery(character);
  let allocation = recovery.automaticRecoveryByPool;
  if (recovery.requiresAllocation) {
    const validated = validateHitDiceAllocation(selection.recoverByPool, recovery.pools, recovery.recoveryCap);
    if (!validated.ok) return { character, changed: false, error: "error" in validated ? validated.error : "invalid-hit-dice-allocation", recovery };
    allocation = validated.allocation;
  }
  const prepared = selection.preparedByClass
    ? validateBuilderPreparedSpellSelections(character, selection.preparedByClass)
    : null;
  if (prepared && !prepared.ok) return { character, changed: false, error: "error" in prepared ? prepared.error : "invalid-prepared-spell", recovery };

  const base = recoverCharacterForRest(character, "longRest");
  const rest = normalizeCharacterRestState(character.rest);
  const nextSpent = { ...rest.hitDiceSpent };
  for (const [poolId, amount] of Object.entries(allocation)) {
    const next = Math.max(0, (nextSpent[poolId] || 0) - amount);
    if (next) nextSpent[poolId] = next;
    else delete nextSpent[poolId];
  }
  const deathSaves = normalizeDeathSaves(character.deathSaves);
  const shouldResetDeathSaves = deathSaves.successes !== 0 || deathSaves.failures !== 0 || !character.deathSaves;
  const nextRest = {
    ...rest,
    hitDiceSpent: nextSpent,
    preparedByClass: prepared?.ok ? prepared.preparedByClass : rest.preparedByClass
  };
  const nextCharacter = {
    ...base.character,
    hpCur: hpMax,
    deathSaves: { successes: 0, failures: 0 },
    rest: nextRest
  };
  const changed = base.changed || hpCur !== hpMax || shouldResetDeathSaves ||
    Object.keys(allocation).length > 0 || !!prepared;
  if (!changed) return { character, changed: false, recovery };
  return {
    character: nextCharacter,
    changed: true,
    recovery,
    summary: { recoveredHitDiceByPool: allocation, preparedChanged: !!prepared }
  };
}
