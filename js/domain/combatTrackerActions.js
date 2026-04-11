// @ts-check

import {
  createCombatParticipantFromSource,
  createDefaultCombatEncounter,
  findCombatSource,
  makeCombatId,
  normalizeCombatEncounter
} from "./combat.js";

/** @typedef {import("./combat.js").CombatParticipant} CombatParticipant */
/** @typedef {import("./combat.js").CombatEncounter} CombatEncounter */
/** @typedef {import("./combat.js").CombatSourceInput} CombatSourceInput */
/** @typedef {import("./combat.js").CombatSourceType} CombatSourceType */

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
 * @param {unknown} tracker
 * @param {CombatSourceType} sourceType
 * @returns {unknown[]}
 */
function getSectionsForSourceType(tracker, sourceType) {
  if (!isPlainObject(tracker)) return [];
  if (sourceType === "party") return Array.isArray(tracker.partySections) ? tracker.partySections : [];
  if (sourceType === "npc") return Array.isArray(tracker.npcSections) ? tracker.npcSections : [];
  if (sourceType === "location") return Array.isArray(tracker.locSections) ? tracker.locSections : [];
  return [];
}

/**
 * @param {Record<string, unknown>} state
 * @returns {Record<string, unknown>}
 */
function ensureCombatBuckets(state) {
  if (!isPlainObject(state.combat)) state.combat = {};
  const combat = /** @type {Record<string, unknown>} */ (state.combat);

  if (!isPlainObject(combat.workspace)) {
    combat.workspace = {
      panelOrder: [],
      embeddedPanels: [],
      panelCollapsed: {}
    };
  } else {
    const workspace = /** @type {Record<string, unknown>} */ (combat.workspace);
    if (!Array.isArray(workspace.panelOrder)) workspace.panelOrder = [...DEFAULT_WORKSPACE.panelOrder];
    if (!Array.isArray(workspace.embeddedPanels)) workspace.embeddedPanels = [...DEFAULT_WORKSPACE.embeddedPanels];
    if (!isPlainObject(workspace.panelCollapsed)) workspace.panelCollapsed = {};
  }

  if (!isPlainObject(combat.encounter)) {
    combat.encounter = createDefaultCombatEncounter();
  }

  return combat;
}

/**
 * Append a tracker card to the current campaign's disposable combat encounter.
 *
 * The source tracker card stays canonical and untouched. Every call creates a
 * fresh encounter-local participant, so duplicates can diverge later for
 * HP/temp HP/status tracking without mutating the source card.
 *
 * @param {unknown} state
 * @param {CombatSourceInput} sourceRef
 * @param {{ now?: unknown, encounterId?: string, participantId?: string }} [options]
 * @returns {{ added: boolean, participant: CombatParticipant | null, encounter: CombatEncounter | null, reason: string | null }}
 */
export function addTrackerCardToCombatEncounter(state, sourceRef, options = {}) {
  if (!isPlainObject(state)) {
    return { added: false, participant: null, encounter: null, reason: "missing-state" };
  }

  const tracker = isPlainObject(state.tracker) ? state.tracker : null;
  const source = findCombatSource(tracker, sourceRef);
  if (!source) {
    return { added: false, participant: null, encounter: null, reason: "missing-source" };
  }

  const now = cleanString(options.now) || new Date().toISOString();
  const combat = ensureCombatBuckets(state);
  const encounter = normalizeCombatEncounter(combat.encounter);
  const participant = createCombatParticipantFromSource(source.card, {
    id: options.participantId,
    sourceType: source.type,
    sections: getSectionsForSourceType(tracker, source.type)
  });

  const nextEncounter = normalizeCombatEncounter({
    ...encounter,
    id: encounter.id || cleanString(options.encounterId) || makeCombatId("enc"),
    createdAt: encounter.createdAt || now,
    updatedAt: now,
    participants: [...encounter.participants, participant]
  });

  combat.encounter = nextEncounter;
  return { added: true, participant, encounter: nextEncounter, reason: null };
}
