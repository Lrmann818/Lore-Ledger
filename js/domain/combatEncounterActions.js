// @ts-check

import {
  addTempHp,
  advanceTurn,
  applyDamage,
  applyHealing,
  clearCombatEncounter,
  findCombatSource,
  getCombatHpFromSource,
  makeCombatId,
  makeStatusEffect,
  normalizeCombatEncounter,
  normalizeCombatRole,
  normalizeStatusDurationMode,
  undoLastTurnAdvance
} from "./combat.js";
import { resolveCardDisplayData, writeCardLinkedField } from "./cardLinking.js";
import { withAllowedStateMutation } from "../utils/dev.js";

/** @typedef {import("../state.js").State} State */
/** @typedef {import("./combat.js").CombatEncounter} CombatEncounter */
/** @typedef {import("./combat.js").CombatParticipant} CombatParticipant */
/** @typedef {import("./combat.js").CombatStatusEffect} CombatStatusEffect */

const DEFAULT_WORKSPACE = Object.freeze({
  panelOrder: [],
  embeddedPanels: [],
  panelCollapsed: {}
});

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
function nonNegativeNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function nonNegativeNumberOrNull(value) {
  if (value === "" || value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.trunc(n));
}

/**
 * @param {State | Record<string, unknown>} state
 * @returns {NonNullable<State["combat"]> & Record<string, unknown>}
 */
function ensureCombatBuckets(state) {
  if (!isPlainObject(state.combat)) state.combat = {};
  const combat = /** @type {NonNullable<State["combat"]> & Record<string, unknown>} */ (state.combat);

  if (!isPlainObject(combat.workspace)) {
    combat.workspace = {
      panelOrder: [...DEFAULT_WORKSPACE.panelOrder],
      embeddedPanels: [...DEFAULT_WORKSPACE.embeddedPanels],
      panelCollapsed: {}
    };
  } else {
    const workspace = /** @type {Record<string, unknown>} */ (combat.workspace);
    if (!Array.isArray(workspace.panelOrder)) workspace.panelOrder = [];
    if (!Array.isArray(workspace.embeddedPanels)) workspace.embeddedPanels = [];
    if (!isPlainObject(workspace.panelCollapsed)) workspace.panelCollapsed = {};
  }

  if (!isPlainObject(combat.encounter)) combat.encounter = clearCombatEncounter();
  combat.encounter = normalizeCombatEncounter(combat.encounter);
  return combat;
}

/**
 * @param {CombatEncounter} encounter
 * @param {string | null | undefined} now
 * @returns {CombatEncounter}
 */
function touchEncounter(encounter, now = undefined) {
  return normalizeCombatEncounter({
    ...encounter,
    updatedAt: cleanString(now) || new Date().toISOString()
  });
}

/**
 * @param {State | Record<string, unknown>} state
 * @returns {CombatEncounter}
 */
export function getCombatEncounter(state) {
  return normalizeCombatEncounter(isPlainObject(state?.combat) ? state.combat.encounter : null);
}

/**
 * This is the only Slice 5 canonical writeback path.
 *
 * Direct combat-card HP/temp HP actions may update the source tracker card's
 * current HP and temp HP. Encounter-only values such as role, order, active
 * participant, timer state, and duplicate participant entries never flow back.
 *
 * @param {State | Record<string, unknown>} state
 * @param {CombatParticipant} participant
 * @returns {boolean}
 */
function writeParticipantHpToCanonicalSource(state, participant) {
  const tracker = isPlainObject(state.tracker) ? state.tracker : null;
  const source = findCombatSource(tracker, participant.source);
  if (!source) return false;

  const hpWrite = writeCardLinkedField(source.card, "hpCurrent", participant.hpCurrent, state, { queueSave: false });
  source.card.tempHp = participant.tempHp;
  return hpWrite.written;
}

/**
 * This is the Slice 6 canonical status writeback path.
 *
 * Combat status effects are structured on encounter participants. The current
 * tracker card model stores a simple status text field, so direct combat status
 * edits mirror only the visible labels back to that existing field. Duration
 * timing stays encounter-local and duplicate participants stay independent.
 *
 * @param {State | Record<string, unknown>} state
 * @param {CombatParticipant} participant
 * @returns {boolean}
 */
function writeParticipantStatusToCanonicalSource(state, participant) {
  const tracker = isPlainObject(state.tracker) ? state.tracker : null;
  const source = findCombatSource(tracker, participant.source);
  if (!source || source.type === "location") return false;

  const statusText = participant.statusEffects
    .map((effect) => cleanString(effect.label))
    .filter(Boolean)
    .join(", ");
  return writeCardLinkedField(source.card, "status", statusText, state, { queueSave: false }).written;
}

/**
 * @param {State | Record<string, unknown>} state
 * @param {(encounter: CombatEncounter) => CombatEncounter | null | false} updater
 * @returns {{ changed: boolean, encounter: CombatEncounter }}
 */
function mutateEncounter(state, updater) {
  if (!isPlainObject(state)) {
    return { changed: false, encounter: clearCombatEncounter() };
  }

  const result = withAllowedStateMutation(() => {
    const combat = ensureCombatBuckets(state);
    const current = normalizeCombatEncounter(combat.encounter);
    const next = updater(current);
    if (!next) return { changed: false, encounter: current };
    const normalized = normalizeCombatEncounter(next);
    combat.encounter = normalized;
    return { changed: true, encounter: normalized };
  });

  return result || { changed: false, encounter: getCombatEncounter(state) };
}

/**
 * @param {CombatEncounter} encounter
 * @param {string} participantId
 * @returns {number}
 */
function findParticipantIndex(encounter, participantId) {
  const id = cleanString(participantId);
  if (!id) return -1;
  return encounter.participants.findIndex((participant) => participant.id === id);
}

/**
 * @param {unknown} input
 * @returns {CombatStatusEffect | null}
 */
function makeStatusEffectFromInput(input) {
  if (!isPlainObject(input)) return null;
  const label = cleanString(input.label);
  if (!label) return null;

  const rawDurationMode = input.durationMode;
  const durationMode = normalizeStatusDurationMode(rawDurationMode);
  const rawDuration = nonNegativeNumberOrNull(input.remaining ?? input.duration);
  const remaining = durationMode === "none" ? null : rawDuration ?? 0;
  return makeStatusEffect({
    ...input,
    label,
    durationMode: durationMode === "time" ? rawDurationMode : durationMode,
    duration: durationMode === "none" ? null : remaining,
    remaining
  });
}

/**
 * @param {State | Record<string, unknown>} state
 * @param {string} participantId
 * @param {number} direction
 * @param {{ now?: string | null }} [options]
 * @returns {{ changed: boolean, encounter: CombatEncounter }}
 */
export function moveCombatParticipant(state, participantId, direction, options = {}) {
  const step = direction < 0 ? -1 : 1;
  return mutateEncounter(state, (encounter) => {
    const fromIndex = findParticipantIndex(encounter, participantId);
    const toIndex = fromIndex + step;
    if (fromIndex < 0 || toIndex < 0 || toIndex >= encounter.participants.length) return false;

    const participants = encounter.participants.slice();
    const moving = participants[fromIndex];
    participants[fromIndex] = participants[toIndex];
    participants[toIndex] = moving;
    return touchEncounter({ ...encounter, participants }, options.now);
  });
}

/**
 * @param {State | Record<string, unknown>} state
 * @param {string} participantId
 * @param {unknown} role
 * @param {{ now?: string | null }} [options]
 * @returns {{ changed: boolean, encounter: CombatEncounter }}
 */
export function setCombatParticipantRole(state, participantId, role, options = {}) {
  const normalizedRole = normalizeCombatRole(role);
  if (!normalizedRole) return { changed: false, encounter: getCombatEncounter(state) };

  return mutateEncounter(state, (encounter) => {
    const index = findParticipantIndex(encounter, participantId);
    if (index < 0 || encounter.participants[index].role === normalizedRole) return false;
    const participants = encounter.participants.map((participant, i) => (
      i === index ? { ...participant, role: normalizedRole } : participant
    ));
    return touchEncounter({ ...encounter, participants }, options.now);
  });
}

/**
 * @param {State | Record<string, unknown>} state
 * @param {string} participantId
 * @param {{ now?: string | null }} [options]
 * @returns {{ changed: boolean, encounter: CombatEncounter }}
 */
export function setActiveCombatParticipant(state, participantId, options = {}) {
  return mutateEncounter(state, (encounter) => {
    const index = findParticipantIndex(encounter, participantId);
    if (index < 0 || encounter.activeParticipantId === encounter.participants[index].id) return false;
    return touchEncounter({ ...encounter, activeParticipantId: encounter.participants[index].id }, options.now);
  });
}

/**
 * @param {State | Record<string, unknown>} state
 * @param {string} participantId
 * @param {{ now?: string | null }} [options]
 * @returns {{ changed: boolean, encounter: CombatEncounter, removed: CombatParticipant | null }}
 */
export function removeCombatParticipant(state, participantId, options = {}) {
  let removed = /** @type {CombatParticipant | null} */ (null);
  const result = mutateEncounter(state, (encounter) => {
    const index = findParticipantIndex(encounter, participantId);
    if (index < 0) return false;

    removed = encounter.participants[index];
    const participants = encounter.participants.filter((_, i) => i !== index);
    let activeParticipantId = encounter.activeParticipantId;
    if (activeParticipantId === removed.id) {
      activeParticipantId = participants.length > 0
        ? participants[Math.min(index, participants.length - 1)].id
        : null;
    }
    const undoStack = encounter.undoStack.filter((entry) => (
      entry.before?.activeParticipantId !== removed?.id && entry.after?.activeParticipantId !== removed?.id
    ));

    return touchEncounter({ ...encounter, participants, activeParticipantId, undoStack }, options.now);
  });

  return { ...result, removed };
}

/**
 * @param {State | Record<string, unknown>} state
 * @param {string} participantId
 * @param {"damage" | "heal" | "temp"} mode
 * @param {unknown} amount
 * @param {{ now?: string | null }} [options]
 * @returns {{ changed: boolean, encounter: CombatEncounter, participant: CombatParticipant | null, wroteCanonical: boolean }}
 */
export function applyCombatParticipantHpAction(state, participantId, mode, amount, options = {}) {
  let updatedParticipant = /** @type {CombatParticipant | null} */ (null);
  let wroteCanonical = false;
  const result = mutateEncounter(state, (encounter) => {
    const index = findParticipantIndex(encounter, participantId);
    if (index < 0) return false;
    const current = encounter.participants[index];

    // For healing, resolve the live canonical hpMax from the source card so the
    // clamp matches what the display shows. Linked participants may have a stale
    // snapshot on the encounter if max HP was changed after they were added.
    let hpForHeal = current;
    if (mode === "heal") {
      const tracker = isPlainObject(state.tracker) ? state.tracker : null;
      const combatSource = findCombatSource(tracker, current.source);
      if (combatSource) {
        const sourceDisplay = resolveCardDisplayData(
          combatSource.card,
          /** @type {Record<string, unknown>} */ (state)
        );
        const sourceMax = getCombatHpFromSource(sourceDisplay).hpMax;
        if (sourceMax != null) hpForHeal = { ...current, hpMax: sourceMax };
      }
    }

    const nextHp = mode === "damage"
      ? applyDamage(current, amount)
      : mode === "heal"
        ? applyHealing(hpForHeal, amount)
        : addTempHp(current, amount);

    const participant = {
      ...current,
      hpCurrent: nextHp.hpCurrent,
      hpMax: nextHp.hpMax,
      tempHp: nextHp.tempHp
    };
    if (
      participant.hpCurrent === current.hpCurrent
      && participant.tempHp === current.tempHp
      && participant.hpMax === current.hpMax
    ) {
      return false;
    }

    updatedParticipant = participant;
    wroteCanonical = writeParticipantHpToCanonicalSource(state, participant);
    const participants = encounter.participants.map((entry, i) => (i === index ? participant : entry));
    return touchEncounter({ ...encounter, participants }, options.now);
  });

  return { ...result, participant: updatedParticipant, wroteCanonical };
}

/**
 * @param {State | Record<string, unknown>} state
 * @param {string} participantId
 * @param {{ label?: unknown, durationMode?: unknown, duration?: unknown, remaining?: unknown }} input
 * @param {{ now?: string | null, id?: string }} [options]
 * @returns {{ changed: boolean, encounter: CombatEncounter, participant: CombatParticipant | null, effect: CombatStatusEffect | null, wroteCanonical: boolean }}
 */
export function addCombatParticipantStatusEffect(state, participantId, input, options = {}) {
  let updatedParticipant = /** @type {CombatParticipant | null} */ (null);
  let addedEffect = /** @type {CombatStatusEffect | null} */ (null);
  let wroteCanonical = false;
  const effect = makeStatusEffectFromInput({ ...input, id: options.id });
  if (!effect) {
    return { changed: false, encounter: getCombatEncounter(state), participant: null, effect: null, wroteCanonical: false };
  }

  const result = mutateEncounter(state, (encounter) => {
    const index = findParticipantIndex(encounter, participantId);
    if (index < 0) return false;

    const participant = {
      ...encounter.participants[index],
      statusEffects: [...encounter.participants[index].statusEffects, effect]
    };
    updatedParticipant = participant;
    addedEffect = effect;
    wroteCanonical = writeParticipantStatusToCanonicalSource(state, participant);
    const participants = encounter.participants.map((entry, i) => (i === index ? participant : entry));
    return touchEncounter({ ...encounter, participants }, options.now);
  });

  return { ...result, participant: updatedParticipant, effect: addedEffect, wroteCanonical };
}

/**
 * @param {State | Record<string, unknown>} state
 * @param {string} participantId
 * @param {string} statusEffectId
 * @param {{ label?: unknown, durationMode?: unknown, duration?: unknown, remaining?: unknown }} input
 * @param {{ now?: string | null }} [options]
 * @returns {{ changed: boolean, encounter: CombatEncounter, participant: CombatParticipant | null, effect: CombatStatusEffect | null, wroteCanonical: boolean }}
 */
export function updateCombatParticipantStatusEffect(state, participantId, statusEffectId, input, options = {}) {
  const id = cleanString(statusEffectId);
  let updatedParticipant = /** @type {CombatParticipant | null} */ (null);
  let updatedEffect = /** @type {CombatStatusEffect | null} */ (null);
  let wroteCanonical = false;
  if (!id) {
    return { changed: false, encounter: getCombatEncounter(state), participant: null, effect: null, wroteCanonical: false };
  }

  const result = mutateEncounter(state, (encounter) => {
    const participantIndex = findParticipantIndex(encounter, participantId);
    if (participantIndex < 0) return false;

    const current = encounter.participants[participantIndex];
    const effectIndex = current.statusEffects.findIndex((effect) => effect.id === id);
    if (effectIndex < 0) return false;

    const effect = makeStatusEffectFromInput({
      ...current.statusEffects[effectIndex],
      ...input,
      id
    });
    if (!effect) return false;

    const previous = current.statusEffects[effectIndex];
    if (
      previous.label === effect.label
      && previous.durationMode === effect.durationMode
      && previous.remaining === effect.remaining
      && previous.duration === effect.duration
      && previous.expired === effect.expired
    ) {
      return false;
    }

    const statusEffects = current.statusEffects.map((entry, i) => (i === effectIndex ? effect : entry));
    const participant = { ...current, statusEffects };
    updatedParticipant = participant;
    updatedEffect = effect;
    wroteCanonical = writeParticipantStatusToCanonicalSource(state, participant);
    const participants = encounter.participants.map((entry, i) => (i === participantIndex ? participant : entry));
    return touchEncounter({ ...encounter, participants }, options.now);
  });

  return { ...result, participant: updatedParticipant, effect: updatedEffect, wroteCanonical };
}

/**
 * @param {State | Record<string, unknown>} state
 * @param {string} participantId
 * @param {string} statusEffectId
 * @param {{ now?: string | null }} [options]
 * @returns {{ changed: boolean, encounter: CombatEncounter, participant: CombatParticipant | null, removed: CombatStatusEffect | null, wroteCanonical: boolean }}
 */
export function removeCombatParticipantStatusEffect(state, participantId, statusEffectId, options = {}) {
  const id = cleanString(statusEffectId);
  let updatedParticipant = /** @type {CombatParticipant | null} */ (null);
  let removed = /** @type {CombatStatusEffect | null} */ (null);
  let wroteCanonical = false;
  if (!id) {
    return { changed: false, encounter: getCombatEncounter(state), participant: null, removed: null, wroteCanonical: false };
  }

  const result = mutateEncounter(state, (encounter) => {
    const participantIndex = findParticipantIndex(encounter, participantId);
    if (participantIndex < 0) return false;

    const current = encounter.participants[participantIndex];
    const effectIndex = current.statusEffects.findIndex((effect) => effect.id === id);
    if (effectIndex < 0) return false;

    removed = current.statusEffects[effectIndex];
    const participant = {
      ...current,
      statusEffects: current.statusEffects.filter((_, i) => i !== effectIndex)
    };
    updatedParticipant = participant;
    wroteCanonical = writeParticipantStatusToCanonicalSource(state, participant);
    const participants = encounter.participants.map((entry, i) => (i === participantIndex ? participant : entry));
    return touchEncounter({ ...encounter, participants }, options.now);
  });

  return { ...result, participant: updatedParticipant, removed, wroteCanonical };
}

/**
 * @param {State | Record<string, unknown>} state
 * @param {unknown} secondsPerTurn
 * @param {{ now?: string | null }} [options]
 * @returns {{ changed: boolean, encounter: CombatEncounter }}
 */
export function setCombatSecondsPerTurn(state, secondsPerTurn, options = {}) {
  const seconds = Math.max(1, nonNegativeNumber(secondsPerTurn));
  return mutateEncounter(state, (encounter) => {
    if (encounter.secondsPerTurn === seconds) return false;
    return touchEncounter({ ...encounter, secondsPerTurn: seconds }, options.now);
  });
}

/**
 * @param {State | Record<string, unknown>} state
 * @param {{ now?: string | null, undoId?: string }} [options]
 * @returns {{ changed: boolean, encounter: CombatEncounter, didAdvance: boolean, roundAdvanced: boolean }}
 */
export function advanceCombatTurn(state, options = {}) {
  let didAdvance = false;
  let roundAdvanced = false;
  const result = mutateEncounter(state, (encounter) => {
    const advanced = advanceTurn(encounter, {
      now: options.now ?? new Date().toISOString(),
      undoId: options.undoId || makeCombatId("undo")
    });
    didAdvance = advanced.didAdvance;
    roundAdvanced = advanced.roundAdvanced;
    return advanced.didAdvance ? advanced.encounter : false;
  });

  return { ...result, didAdvance, roundAdvanced };
}

/**
 * @param {State | Record<string, unknown>} state
 * @returns {{ changed: boolean, encounter: CombatEncounter, applied: boolean }}
 */
export function undoCombatTurn(state) {
  let applied = false;
  const result = mutateEncounter(state, (encounter) => {
    const undone = undoLastTurnAdvance(encounter);
    applied = undone.applied;
    return undone.applied ? undone.encounter : false;
  });
  return { ...result, applied };
}

/**
 * @param {State | Record<string, unknown>} state
 * @param {{ now?: string | null }} [options]
 * @returns {{ changed: boolean, encounter: CombatEncounter }}
 */
export function clearCombat(state, options = {}) {
  void options;
  return mutateEncounter(state, () => clearCombatEncounter());
}
