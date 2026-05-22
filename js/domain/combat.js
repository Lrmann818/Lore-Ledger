// @ts-check

/** @typedef {"party" | "enemy" | "npc"} CombatRole */
/** @typedef {"party" | "npc" | "location"} CombatSourceType */
/** @typedef {"party" | "npcs" | "locationsList"} CombatSourceListKey */
/** @typedef {"none" | "rounds" | "time"} StatusDurationMode */
/**
 * @typedef {{
 *   successes: number,
 *   failures: number
 * }} CombatDeathSaves
 */
/**
 * @typedef {{
 *   id: string,
 *   label: string,
 *   durationMode: StatusDurationMode,
 *   duration: number | null,
 *   remaining: number | null,
 *   expired: boolean,
 *   [key: string]: unknown
 * }} CombatStatusEffect
 */
/**
 * @typedef {{
 *   type: CombatSourceType,
 *   id: string | null,
 *   sectionId: string,
 *   group: string
 * }} CombatParticipantSourceRef
 */
/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   role: CombatRole,
 *   source: CombatParticipantSourceRef,
 *   hpCurrent: number | null,
 *   hpMax: number | null,
 *   tempHp: number,
 *   deathSaves: CombatDeathSaves,
 *   statusEffects: CombatStatusEffect[],
 *   [key: string]: unknown
 * }} CombatParticipant
 */
/**
 * @typedef {{
 *   id: string | null,
 *   createdAt: string | null,
 *   updatedAt: string | null,
 *   round: number,
 *   activeParticipantId: string | null,
 *   elapsedSeconds: number,
 *   secondsPerTurn: number,
 *   participants: CombatParticipant[],
 *   undoStack: CombatUndoEntry[],
 *   [key: string]: unknown
 * }} CombatEncounter
 */
/**
 * @typedef {{
 *   id: string,
 *   statusEffects: CombatStatusEffect[]
 * }} CombatParticipantTurnSnapshot
 */
/**
 * @typedef {{
 *   round: number,
 *   activeParticipantId: string | null,
 *   elapsedSeconds: number,
 *   participants: CombatParticipantTurnSnapshot[]
 * }} CombatTurnSnapshot
 */
/**
 * @typedef {{
 *   id: string,
 *   type: "turnAdvance",
 *   createdAt: string | null,
 *   before: CombatTurnSnapshot,
 *   after: CombatTurnSnapshot
 * }} CombatUndoEntry
 */
/** @typedef {{ type?: unknown, sourceType?: unknown, id?: unknown, sourceId?: unknown }} CombatSourceInput */

export const COMBAT_ROLES = Object.freeze({
  PARTY: "party",
  ENEMY: "enemy",
  NPC: "npc"
});

export const STATUS_DURATION_MODES = Object.freeze({
  NONE: "none",
  ROUNDS: "rounds",
  TIME: "time",
  SECONDS: "seconds",
  MINUTES: "minutes",
  HOURS: "hours"
});

export const DEFAULT_SECONDS_PER_TURN = 6;

export const DEFAULT_COMBAT_DEATH_SAVES = Object.freeze({
  successes: 0,
  failures: 0
});

/** @type {Readonly<Record<CombatSourceType, CombatSourceListKey>>} */
const SOURCE_LIST_BY_TYPE = Object.freeze({
  party: "party",
  npc: "npcs",
  location: "locationsList"
});

const ENEMY_ROLE_KEYWORDS = Object.freeze([
  "enemy",
  "enemies",
  "foe",
  "foes",
  "hostile",
  "hostiles",
  "monster",
  "monsters",
  "villain",
  "villains",
  "boss"
]);

const PARTY_ROLE_KEYWORDS = Object.freeze([
  "party",
  "pc",
  "pcs",
  "player",
  "players",
  "player character",
  "player characters"
]);

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
 * @returns {number | null}
 */
function nonNegativeNumberOrNull(value) {
  if (value === "" || value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.trunc(n));
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function deathSaveCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(3, Math.trunc(n)));
}

/**
 * @param {unknown} value
 * @returns {CombatDeathSaves}
 */
export function normalizeCombatDeathSaves(value) {
  const src = isPlainObject(value) ? value : {};
  return {
    successes: deathSaveCount(src.successes),
    failures: deathSaveCount(src.failures)
  };
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function nonNegativeNumber(value) {
  return nonNegativeNumberOrNull(value) ?? 0;
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function positiveSecondsOrDefault(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_SECONDS_PER_TURN;
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function elapsedSecondsOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function nullableId(value) {
  const id = cleanString(value);
  return id || null;
}

/**
 * @param {string} [prefix]
 * @returns {string}
 */
export function makeCombatId(prefix = "cmb") {
  const safePrefix = cleanString(prefix) || "cmb";
  return `${safePrefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * @param {unknown} value
 * @param {Record<string, unknown>} [source]
 * @returns {CombatSourceType | null}
 */
export function normalizeCombatSourceType(value, source = undefined) {
  const raw = cleanString(value).toLowerCase();
  if (raw === "party" || raw === "partymember" || raw === "party-member") return "party";
  if (raw === "npc" || raw === "npcs") return "npc";
  if (raw === "location" || raw === "locations" || raw === "loc" || raw === "locationslist") return "location";

  const sourceId = cleanString(source?.id).toLowerCase();
  if (sourceId.startsWith("party_") || sourceId.startsWith("party-")) return "party";
  if (sourceId.startsWith("npc_") || sourceId.startsWith("npc-")) return "npc";
  if (sourceId.startsWith("loc_") || sourceId.startsWith("loc-")) return "location";

  return null;
}

/**
 * @param {unknown} sourceType
 * @returns {CombatSourceListKey | null}
 */
export function getCombatSourceListKey(sourceType) {
  const normalized = normalizeCombatSourceType(sourceType);
  return normalized ? SOURCE_LIST_BY_TYPE[normalized] : null;
}

/**
 * @param {unknown} value
 * @returns {CombatRole | null}
 */
export function normalizeCombatRole(value) {
  const raw = cleanString(value).toLowerCase();
  if (raw === "party" || raw === "pc" || raw === "player") return "party";
  if (raw === "enemy" || raw === "hostile" || raw === "foe") return "enemy";
  if (raw === "npc" || raw === "neutral" || raw === "ally" || raw === "friendly") return "npc";
  return null;
}

/**
 * @param {string} text
 * @param {readonly string[]} keywords
 * @returns {boolean}
 */
function hasKeyword(text, keywords) {
  const normalized = cleanString(text).toLowerCase();
  if (!normalized) return false;
  return keywords.some((keyword) => normalized.includes(keyword));
}

/**
 * @param {unknown} sectionId
 * @param {unknown} sections
 * @returns {string}
 */
function getSectionLabel(sectionId, sections) {
  const id = cleanString(sectionId);
  if (!id || !Array.isArray(sections)) return "";
  const section = sections.find((entry) => isPlainObject(entry) && cleanString(entry.id) === id);
  if (!isPlainObject(section)) return "";
  return cleanString(section.name) || cleanString(section.title) || cleanString(section.label);
}

/**
 * @param {Record<string, unknown> | null | undefined} source
 * @param {{
 *   sourceType?: unknown,
 *   sections?: unknown,
 *   roleOverride?: unknown
 * }} [options]
 * @returns {CombatRole}
 */
export function inferCombatRoleFromSource(source, options = {}) {
  const roleOverride = normalizeCombatRole(options.roleOverride);
  if (roleOverride) return roleOverride;

  const src = isPlainObject(source) ? source : {};
  const explicitRole = normalizeCombatRole(src.combatRole ?? src.roleOverride ?? src.role);
  if (explicitRole) return explicitRole;

  const sourceType = normalizeCombatSourceType(options.sourceType ?? src.sourceType ?? src.type, src);
  if (sourceType === "party") return "party";

  const sectionLabel = getSectionLabel(src.sectionId, options.sections);
  const candidates = [
    src.group,
    src.category,
    src.sectionId,
    src.type,
    sectionLabel
  ].map(cleanString);

  if (candidates.some((candidate) => hasKeyword(candidate, ENEMY_ROLE_KEYWORDS))) return "enemy";
  if (candidates.some((candidate) => hasKeyword(candidate, PARTY_ROLE_KEYWORDS))) return "npc";
  return "npc";
}

/**
 * @param {Record<string, unknown> | null | undefined} source
 * @returns {string}
 */
export function getCombatSourceDisplayName(source) {
  const src = isPlainObject(source) ? source : {};
  return cleanString(src.name) || cleanString(src.title) || "Unnamed participant";
}

/**
 * @param {Record<string, unknown> | null | undefined} source
 * @param {unknown} sourceType
 * @returns {CombatParticipantSourceRef}
 */
export function createCombatSourceRef(source, sourceType) {
  const src = isPlainObject(source) ? source : {};
  return {
    type: normalizeCombatSourceType(sourceType ?? src.sourceType ?? src.type, src) || "npc",
    id: nullableId(src.id),
    sectionId: cleanString(src.sectionId),
    group: cleanString(src.group)
  };
}

/**
 * @param {Record<string, unknown> | null | undefined} tracker
 * @param {CombatSourceInput} sourceRef
 * @returns {{ type: CombatSourceType, listKey: CombatSourceListKey, card: Record<string, unknown> } | null}
 */
export function findCombatSource(tracker, sourceRef) {
  if (!isPlainObject(tracker) || !isPlainObject(sourceRef)) return null;

  const type = normalizeCombatSourceType(sourceRef.type ?? sourceRef.sourceType);
  const id = nullableId(sourceRef.id ?? sourceRef.sourceId);
  const listKey = type ? SOURCE_LIST_BY_TYPE[type] : null;
  if (!type || !listKey || !id || !Array.isArray(tracker[listKey])) return null;

  const card = tracker[listKey].find((entry) => isPlainObject(entry) && cleanString(entry.id) === id);
  return isPlainObject(card) ? { type, listKey, card } : null;
}

/**
 * @param {unknown} value
 * @returns {StatusDurationMode}
 */
export function normalizeStatusDurationMode(value) {
  const raw = cleanString(value).toLowerCase();
  if (raw === "round" || raw === "rounds") return "rounds";
  if (
    raw === "time"
    || raw === "second"
    || raw === "seconds"
    || raw === "minute"
    || raw === "minutes"
    || raw === "hour"
    || raw === "hours"
  ) {
    return "time";
  }
  return "none";
}

/**
 * @param {unknown} value
 * @returns {number}
 */
export function getStatusDurationUnitMultiplier(value) {
  const raw = cleanString(value).toLowerCase();
  if (raw === "minute" || raw === "minutes") return 60;
  if (raw === "hour" || raw === "hours") return 3600;
  return 1;
}

/**
 * @param {CombatStatusEffect} effect
 * @returns {CombatStatusEffect}
 */
function cloneStatusEffect(effect) {
  return { ...effect };
}

/**
 * @param {unknown} remaining
 * @param {StatusDurationMode} mode
 * @returns {boolean}
 */
function statusIsExpired(remaining, mode) {
  return mode !== "none" && nonNegativeNumber(remaining) <= 0;
}

/**
 * @param {{
 *   id?: string,
 *   label?: unknown,
 *   durationMode?: unknown,
 *   duration?: unknown,
 *   remaining?: unknown,
 *   expired?: unknown,
 *   [key: string]: unknown
 * }} [input]
 * @returns {CombatStatusEffect}
 */
export function makeStatusEffect(input = {}) {
  const mode = normalizeStatusDurationMode(input.durationMode);
  const label = cleanString(input.label) || "Status Effect";
  const multiplier = mode === "time" ? getStatusDurationUnitMultiplier(input.durationMode) : 1;
  const duration = mode === "none" ? null : nonNegativeNumber(input.duration ?? input.remaining) * multiplier;
  const remaining = mode === "none" ? null : nonNegativeNumber(input.remaining ?? duration) * (
    input.remaining == null ? 1 : multiplier
  );

  return {
    ...input,
    id: cleanString(input.id) || makeCombatId("status"),
    label,
    durationMode: mode,
    duration,
    remaining,
    expired: mode === "none" ? false : statusIsExpired(remaining, mode)
  };
}

/**
 * @param {unknown} text
 * @returns {CombatStatusEffect[]}
 */
export function statusEffectsFromText(text) {
  if (typeof text !== "string") return [];
  return text
    .split(/[,;\n]/)
    .map((label) => label.trim())
    .filter(Boolean)
    .map((label) => makeStatusEffect({ label, durationMode: "none" }));
}

/**
 * @param {unknown} effects
 * @param {{ fallbackStatusText?: unknown }} [options]
 * @returns {CombatStatusEffect[]}
 */
export function normalizeStatusEffects(effects, options = {}) {
  if (!Array.isArray(effects)) return statusEffectsFromText(options.fallbackStatusText);

  return effects
    .map((effect) => {
      if (typeof effect === "string") {
        const label = cleanString(effect);
        return label ? makeStatusEffect({ label }) : null;
      }
      if (!isPlainObject(effect)) return null;
      const label = cleanString(effect.label);
      return label ? makeStatusEffect(effect) : null;
    })
    .filter((effect) => !!effect);
}

/**
 * @param {CombatStatusEffect} effect
 * @param {{ secondsElapsed?: unknown, roundAdvanced?: boolean }} [options]
 * @returns {CombatStatusEffect}
 */
export function advanceStatusEffect(effect, options = {}) {
  const normalized = makeStatusEffect(effect);
  if (normalized.durationMode === "none") return { ...normalized, expired: false };

  const decrement = normalized.durationMode === "time"
    ? elapsedSecondsOrZero(options.secondsElapsed)
    : (options.roundAdvanced ? 1 : 0);
  const remaining = Math.max(0, nonNegativeNumber(normalized.remaining) - decrement);

  return {
    ...normalized,
    remaining,
    expired: statusIsExpired(remaining, normalized.durationMode)
  };
}

/**
 * @param {unknown} effects
 * @param {{ secondsElapsed?: unknown, roundAdvanced?: boolean }} [options]
 * @returns {CombatStatusEffect[]}
 */
export function advanceStatusEffects(effects, options = {}) {
  return normalizeStatusEffects(effects).map((effect) => advanceStatusEffect(effect, options));
}

/**
 * @param {Record<string, unknown> | null | undefined} source
 * @returns {{ hpCurrent: number | null, hpMax: number | null, tempHp: number }}
 */
export function getCombatHpFromSource(source) {
  const src = isPlainObject(source) ? source : {};
  return {
    hpCurrent: nonNegativeNumberOrNull(src.hpCurrent ?? src.hpCur),
    hpMax: nonNegativeNumberOrNull(src.hpMax),
    tempHp: nonNegativeNumber(src.tempHp ?? src.tempHP)
  };
}

/**
 * @param {{ hpCurrent?: unknown, hpMax?: unknown, tempHp?: unknown }} hp
 * @param {unknown} amount
 * @returns {{
 *   hpCurrent: number | null,
 *   hpMax: number | null,
 *   tempHp: number,
 *   damageToTempHp: number,
 *   damageToHp: number,
 *   unappliedDamage: number
 * }}
 */
export function applyDamage(hp, amount) {
  const damage = nonNegativeNumber(amount);
  const hpCurrent = nonNegativeNumberOrNull(hp?.hpCurrent);
  const hpMax = nonNegativeNumberOrNull(hp?.hpMax);
  const tempHp = nonNegativeNumber(hp?.tempHp);

  const damageToTempHp = Math.min(tempHp, damage);
  const nextTempHp = tempHp - damageToTempHp;
  const remainingDamage = damage - damageToTempHp;

  if (hpCurrent == null) {
    return {
      hpCurrent,
      hpMax,
      tempHp: nextTempHp,
      damageToTempHp,
      damageToHp: 0,
      unappliedDamage: remainingDamage
    };
  }

  const nextHpCurrent = Math.max(0, hpCurrent - remainingDamage);
  const damageToHp = hpCurrent - nextHpCurrent;

  return {
    hpCurrent: nextHpCurrent,
    hpMax,
    tempHp: nextTempHp,
    damageToTempHp,
    damageToHp,
    unappliedDamage: Math.max(0, remainingDamage - damageToHp)
  };
}

/**
 * @param {{ hpCurrent?: unknown, hpMax?: unknown, tempHp?: unknown }} hp
 * @param {unknown} amount
 * @returns {{
 *   hpCurrent: number | null,
 *   hpMax: number | null,
 *   tempHp: number,
 *   healingApplied: number
 * }}
 */
export function applyHealing(hp, amount) {
  const healing = nonNegativeNumber(amount);
  const hpCurrent = nonNegativeNumberOrNull(hp?.hpCurrent);
  const hpMax = nonNegativeNumberOrNull(hp?.hpMax);
  const tempHp = nonNegativeNumber(hp?.tempHp);

  if (hpCurrent == null) {
    return { hpCurrent, hpMax, tempHp, healingApplied: 0 };
  }

  const healed = hpMax == null
    ? hpCurrent + healing
    : Math.min(hpMax, hpCurrent + healing);

  return {
    hpCurrent: healed,
    hpMax,
    tempHp,
    healingApplied: healed - hpCurrent
  };
}

/**
 * @param {{ hpCurrent?: unknown, hpMax?: unknown, tempHp?: unknown }} hp
 * @param {unknown} amount
 * @returns {{
 *   hpCurrent: number | null,
 *   hpMax: number | null,
 *   tempHp: number,
 *   tempHpAdded: number
 * }}
 */
export function addTempHp(hp, amount) {
  const added = nonNegativeNumber(amount);
  const tempHp = nonNegativeNumber(hp?.tempHp);
  return {
    hpCurrent: nonNegativeNumberOrNull(hp?.hpCurrent),
    hpMax: nonNegativeNumberOrNull(hp?.hpMax),
    tempHp: tempHp + added,
    tempHpAdded: added
  };
}

/**
 * @param {Record<string, unknown> | null | undefined} source
 * @param {{
 *   id?: string,
 *   sourceType?: unknown,
 *   roleOverride?: unknown,
 *   sections?: unknown,
 *   statusEffects?: unknown
 * }} [options]
 * @returns {CombatParticipant}
 */
export function createCombatParticipantFromSource(source, options = {}) {
  const src = isPlainObject(source) ? source : {};
  const sourceType = normalizeCombatSourceType(options.sourceType ?? src.sourceType ?? src.type, src) || "npc";
  const hp = getCombatHpFromSource(src);

  return {
    id: cleanString(options.id) || makeCombatId("cmb"),
    name: getCombatSourceDisplayName(src),
    role: inferCombatRoleFromSource(src, {
      sourceType,
      roleOverride: options.roleOverride,
      sections: options.sections
    }),
    source: createCombatSourceRef(src, sourceType),
    hpCurrent: hp.hpCurrent,
    hpMax: hp.hpMax,
    tempHp: hp.tempHp,
    deathSaves: normalizeCombatDeathSaves(src.deathSaves),
    statusEffects: normalizeStatusEffects(options.statusEffects ?? src.statusEffects, {
      fallbackStatusText: src.status
    })
  };
}

/**
 * @param {unknown} participant
 * @returns {CombatParticipant | null}
 */
function normalizeCombatParticipant(participant) {
  if (!isPlainObject(participant)) return null;
  const id = cleanString(participant.id);
  if (!id) return null;

  return {
    ...participant,
    id,
    name: cleanString(participant.name) || "Unnamed participant",
    role: normalizeCombatRole(participant.role) || "npc",
    source: isPlainObject(participant.source)
      ? {
          type: normalizeCombatSourceType(participant.source.type) || "npc",
          id: nullableId(participant.source.id),
          sectionId: cleanString(participant.source.sectionId),
          group: cleanString(participant.source.group)
        }
      : createCombatSourceRef(undefined, "npc"),
    hpCurrent: nonNegativeNumberOrNull(participant.hpCurrent),
    hpMax: nonNegativeNumberOrNull(participant.hpMax),
    tempHp: nonNegativeNumber(participant.tempHp),
    deathSaves: normalizeCombatDeathSaves(participant.deathSaves),
    statusEffects: normalizeStatusEffects(participant.statusEffects)
  };
}

/**
 * @param {unknown} encounter
 * @returns {CombatEncounter}
 */
export function normalizeCombatEncounter(encounter) {
  const src = isPlainObject(encounter) ? encounter : {};
  const participants = Array.isArray(src.participants)
    ? src.participants.map(normalizeCombatParticipant).filter((participant) => !!participant)
    : [];
  const activeParticipantId = nullableId(src.activeParticipantId);
  const activeStillPresent = activeParticipantId
    ? participants.some((participant) => participant.id === activeParticipantId)
    : false;

  return {
    ...src,
    id: nullableId(src.id),
    createdAt: nullableId(src.createdAt),
    updatedAt: nullableId(src.updatedAt),
    round: Math.max(1, nonNegativeNumber(src.round || 1)),
    activeParticipantId: activeStillPresent ? activeParticipantId : null,
    elapsedSeconds: nonNegativeNumber(src.elapsedSeconds),
    secondsPerTurn: positiveSecondsOrDefault(src.secondsPerTurn),
    participants,
    undoStack: /** @type {CombatUndoEntry[]} */ (Array.isArray(src.undoStack)
      ? src.undoStack.filter((entry) => isPlainObject(entry))
      : [])
  };
}

/**
 * @param {Partial<CombatEncounter>} [overrides]
 * @returns {CombatEncounter}
 */
export function createDefaultCombatEncounter(overrides = {}) {
  return normalizeCombatEncounter({
    id: null,
    createdAt: null,
    updatedAt: null,
    round: 1,
    activeParticipantId: null,
    elapsedSeconds: 0,
    secondsPerTurn: DEFAULT_SECONDS_PER_TURN,
    participants: [],
    undoStack: [],
    ...overrides
  });
}

/**
 * @param {CombatEncounter} encounter
 * @returns {CombatTurnSnapshot}
 */
export function createTurnSnapshot(encounter) {
  const normalized = normalizeCombatEncounter(encounter);
  return {
    round: normalized.round,
    activeParticipantId: normalized.activeParticipantId,
    elapsedSeconds: normalized.elapsedSeconds,
    participants: normalized.participants.map((participant) => ({
      id: participant.id,
      statusEffects: participant.statusEffects.map(cloneStatusEffect)
    }))
  };
}

/**
 * @param {CombatEncounter} before
 * @param {CombatEncounter} after
 * @param {{ id?: string, createdAt?: string | null }} [options]
 * @returns {CombatUndoEntry}
 */
export function createTurnAdvanceUndoEntry(before, after, options = {}) {
  return {
    id: cleanString(options.id) || makeCombatId("undo"),
    type: "turnAdvance",
    createdAt: options.createdAt ?? null,
    before: createTurnSnapshot(before),
    after: createTurnSnapshot(after)
  };
}

/**
 * @param {unknown} encounter
 * @param {{ now?: string | null, undoId?: string }} [options]
 * @returns {{ encounter: CombatEncounter, undoEntry: CombatUndoEntry | null, didAdvance: boolean, roundAdvanced: boolean }}
 */
export function advanceTurn(encounter, options = {}) {
  const before = normalizeCombatEncounter(encounter);
  if (before.participants.length === 0) {
    return {
      encounter: { ...before, activeParticipantId: null },
      undoEntry: null,
      didAdvance: false,
      roundAdvanced: false
    };
  }

  const activeIndex = before.activeParticipantId
    ? before.participants.findIndex((participant) => participant.id === before.activeParticipantId)
    : -1;
  const nextIndex = activeIndex >= 0 ? (activeIndex + 1) % before.participants.length : 0;
  const roundAdvanced = activeIndex === before.participants.length - 1;
  const secondsElapsed = before.secondsPerTurn;

  const after = normalizeCombatEncounter({
    ...before,
    updatedAt: options.now ?? before.updatedAt,
    round: before.round + (roundAdvanced ? 1 : 0),
    activeParticipantId: before.participants[nextIndex].id,
    elapsedSeconds: before.elapsedSeconds + secondsElapsed,
    participants: before.participants.map((participant) => ({
      ...participant,
      statusEffects: advanceStatusEffects(participant.statusEffects, {
        secondsElapsed,
        roundAdvanced
      })
    }))
  });
  const undoEntry = createTurnAdvanceUndoEntry(before, after, {
    id: options.undoId,
    createdAt: options.now ?? null
  });

  after.undoStack = [...before.undoStack, undoEntry];
  return { encounter: after, undoEntry, didAdvance: true, roundAdvanced };
}

/**
 * @param {unknown} encounter
 * @param {unknown} undoEntry
 * @returns {{ encounter: CombatEncounter, applied: boolean }}
 */
export function applyTurnAdvanceUndoEntry(encounter, undoEntry) {
  const current = normalizeCombatEncounter(encounter);
  if (!isPlainObject(undoEntry) || undoEntry.type !== "turnAdvance" || !isPlainObject(undoEntry.before)) {
    return { encounter: current, applied: false };
  }

  const before = /** @type {Partial<CombatTurnSnapshot>} */ (undoEntry.before);
  const statusByParticipantId = new Map();
  if (Array.isArray(before.participants)) {
    for (const participant of before.participants) {
      if (!isPlainObject(participant)) continue;
      const id = cleanString(participant.id);
      if (!id) continue;
      statusByParticipantId.set(id, normalizeStatusEffects(participant.statusEffects));
    }
  }

  const participants = current.participants.map((participant) => {
    if (!statusByParticipantId.has(participant.id)) return participant;
    return {
      ...participant,
      statusEffects: statusByParticipantId.get(participant.id).map(cloneStatusEffect)
    };
  });

  return {
    encounter: normalizeCombatEncounter({
      ...current,
      round: before.round,
      activeParticipantId: before.activeParticipantId,
      elapsedSeconds: before.elapsedSeconds,
      participants
    }),
    applied: true
  };
}

/**
 * @param {unknown} encounter
 * @returns {{ encounter: CombatEncounter, undoEntry: CombatUndoEntry | null, applied: boolean }}
 */
export function undoLastTurnAdvance(encounter) {
  const current = normalizeCombatEncounter(encounter);
  if (current.undoStack.length === 0) {
    return { encounter: current, undoEntry: null, applied: false };
  }

  const undoEntry = current.undoStack[current.undoStack.length - 1];
  const remainingUndoStack = current.undoStack.slice(0, -1);
  const applied = applyTurnAdvanceUndoEntry({ ...current, undoStack: remainingUndoStack }, undoEntry);
  if (!applied.applied) return { encounter: current, undoEntry: null, applied: false };

  return {
    encounter: {
      ...applied.encounter,
      undoStack: remainingUndoStack
    },
    undoEntry,
    applied: true
  };
}

/**
 * @returns {CombatEncounter}
 */
export function clearCombatEncounter() {
  return createDefaultCombatEncounter();
}
