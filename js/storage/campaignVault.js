// @ts-check
// js/storage/campaignVault.js — multi-campaign vault helpers

/** @typedef {typeof import("../state.js").state} AppState */
/** @typedef {ReturnType<typeof import("../state.js").sanitizeForSave>} SanitizedState */

export const VAULT_VERSION = 1;
export const DEFAULT_CAMPAIGN_NAME = "My Campaign";
export const LEGACY_MIGRATION_CAMPAIGN_ID = "campaign_legacy";

/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   createdAt: string,
 *   updatedAt: string,
 *   lastOpenedAt: string | null
 * }} CampaignIndexEntry
 */

/**
 * @typedef {{
 *   schemaVersion: number,
 *   tracker: NonNullable<SanitizedState["tracker"]>,
 *   character: NonNullable<SanitizedState["character"]>,
 *   map: SanitizedState["map"]
 * }} CampaignDoc
 */

/**
 * @typedef {{
 *   activeCampaignId: string | null,
 *   ui: SanitizedState["ui"]
 * }} VaultAppShell
 */

/**
 * @typedef {{
 *   vaultVersion: number,
 *   appShell: VaultAppShell,
 *   campaignIndex: {
 *     order: string[],
 *     entries: Record<string, CampaignIndexEntry>
 *   },
 *   campaignDocs: Record<string, CampaignDoc>
 * }} CampaignVault
 */

/**
 * @typedef {{
 *   vault: CampaignVault,
 *   activeCampaignId: string,
 *   migratedFromLegacy: boolean,
 *   changed: boolean
 * }} LegacyWrapResult
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * @template T
 * @param {T} value
 * @returns {T}
 */
function clone(value) {
  return /** @type {T} */ (JSON.parse(JSON.stringify(value)));
}

/**
 * @param {string | undefined | null} value
 * @param {string} fallback
 * @returns {string}
 */
function normalizeString(value, fallback) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || fallback;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeActiveCampaignId(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || null;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeOptionalTimestamp(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || null;
}

/**
 * @param {unknown} value
 * @returns {value is CampaignVault}
 */
export function isCampaignVault(value) {
  return isPlainObject(value) && Number(value.vaultVersion) === VAULT_VERSION;
}

/**
 * @returns {string}
 */
export function createCampaignId() {
  return `campaign_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}

/**
 * @param {unknown} value
 * @returns {string}
 */
export function getCanonicalCampaignName(value) {
  return normalizeString(typeof value === "string" ? value.replace(/\s+/g, " ") : "", DEFAULT_CAMPAIGN_NAME);
}

/**
 * @param {typeof import("../state.js").migrateState} migrateState
 * @param {typeof import("../state.js").sanitizeForSave} sanitizeForSave
 * @returns {SanitizedState["ui"]}
 */
function createDefaultVaultUi(migrateState, sanitizeForSave) {
  return clone(sanitizeForSave(migrateState(undefined)).ui);
}

/**
 * @param {typeof import("../state.js").migrateState} migrateState
 * @param {typeof import("../state.js").sanitizeForSave} sanitizeForSave
 * @param {unknown} rawUi
 * @returns {SanitizedState["ui"]}
 */
export function normalizeVaultUi(migrateState, sanitizeForSave, rawUi) {
  const seeded = migrateState({ ui: isPlainObject(rawUi) ? rawUi : {} });
  return clone(sanitizeForSave(seeded).ui);
}

/**
 * @param {AppState | SanitizedState} source
 * @param {typeof import("../state.js").sanitizeForSave} sanitizeForSave
 * @returns {CampaignDoc}
 */
export function extractCampaignDoc(source, sanitizeForSave) {
  const sanitized = sanitizeForSave(source);
  const campaignName = getCanonicalCampaignName(sanitized.tracker?.campaignTitle);

  return {
    schemaVersion: sanitized.schemaVersion,
    tracker: /** @type {CampaignDoc["tracker"]} */ (clone({
      ...(sanitized.tracker || {}),
      campaignTitle: campaignName
    })),
    character: /** @type {CampaignDoc["character"]} */ (clone(sanitized.character || {})),
    map: /** @type {CampaignDoc["map"]} */ (clone(sanitized.map || { activeMapId: null, maps: [] }))
  };
}

/**
 * @param {CampaignDoc} doc
 * @param {string} campaignName
 * @returns {CampaignDoc}
 */
export function mirrorCampaignNameIntoDoc(doc, campaignName) {
  const canonicalName = getCanonicalCampaignName(campaignName);
  const nextDoc = clone(doc);
  nextDoc.tracker = /** @type {CampaignDoc["tracker"]} */ ({
    ...(nextDoc.tracker || {}),
    campaignTitle: canonicalName
  });
  return nextDoc;
}

/**
 * @param {typeof import("../state.js").migrateState} migrateState
 * @param {typeof import("../state.js").sanitizeForSave} sanitizeForSave
 * @param {unknown} rawDoc
 * @param {string} fallbackName
 * @returns {CampaignDoc}
 */
export function normalizeCampaignDoc(migrateState, sanitizeForSave, rawDoc, fallbackName = DEFAULT_CAMPAIGN_NAME) {
  const migrated = migrateState(rawDoc);
  return mirrorCampaignNameIntoDoc(extractCampaignDoc(migrated, sanitizeForSave), fallbackName);
}

/**
 * @param {CampaignVault} vault
 * @returns {CampaignVault}
 */
export function cloneVault(vault) {
  return clone(vault);
}

/**
 * @param {CampaignVault} vault
 * @param {string | null | undefined} preferredId
 * @returns {string | null}
 */
export function resolveActiveCampaignId(vault, preferredId = vault?.appShell?.activeCampaignId) {
  if (preferredId === null) return null;

  const requestedId = normalizeActiveCampaignId(preferredId);
  if (requestedId && vault?.campaignDocs?.[requestedId] && vault?.campaignIndex?.entries?.[requestedId]) {
    return requestedId;
  }

  if (!vault?.campaignIndex?.order?.length) return null;
  for (const id of vault.campaignIndex.order) {
    if (vault.campaignDocs[id] && vault.campaignIndex.entries[id]) return id;
  }
  return null;
}

/**
 * @param {typeof import("../state.js").migrateState} migrateState
 * @param {typeof import("../state.js").sanitizeForSave} sanitizeForSave
 * @returns {CampaignVault}
 */
export function createEmptyVault(migrateState, sanitizeForSave) {
  return {
    vaultVersion: VAULT_VERSION,
    appShell: {
      activeCampaignId: null,
      ui: createDefaultVaultUi(migrateState, sanitizeForSave)
    },
    campaignIndex: {
      order: [],
      entries: {}
    },
    campaignDocs: {}
  };
}

/**
 * @param {CampaignVault} vault
 * @param {{
 *   migrateState: typeof import("../state.js").migrateState,
 *   sanitizeForSave: typeof import("../state.js").sanitizeForSave,
 *   name?: string,
 *   campaignId?: string,
 *   now?: string
 * }} deps
 * @returns {{ vault: CampaignVault, campaignId: string }}
 */
export function createCampaignInVault(vault, deps) {
  const {
    migrateState,
    sanitizeForSave,
    name,
    campaignId = createCampaignId(),
    now = new Date().toISOString()
  } = deps;

  const normalizedId = normalizeActiveCampaignId(campaignId);
  if (!normalizedId) throw new Error("createCampaignInVault: campaignId is required");

  const nextVault = cloneVault(vault);
  if (nextVault.campaignDocs[normalizedId] || nextVault.campaignIndex.entries[normalizedId]) {
    throw new Error(`createCampaignInVault: campaign "${normalizedId}" already exists`);
  }

  const canonicalName = getCanonicalCampaignName(name);
  const doc = normalizeCampaignDoc(migrateState, sanitizeForSave, migrateState(undefined), canonicalName);
  nextVault.campaignDocs[normalizedId] = mirrorCampaignNameIntoDoc(doc, canonicalName);
  nextVault.campaignIndex.entries[normalizedId] = {
    id: normalizedId,
    name: canonicalName,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: null
  };
  nextVault.campaignIndex.order.push(normalizedId);

  return { vault: nextVault, campaignId: normalizedId };
}

/**
 * @param {unknown} rawVault
 * @param {{
 *   migrateState: typeof import("../state.js").migrateState,
 *   sanitizeForSave: typeof import("../state.js").sanitizeForSave,
 *   now?: string
 * }} deps
 * @returns {{ vault: CampaignVault, changed: boolean }}
 */
export function normalizeCampaignVault(rawVault, deps) {
  const { migrateState, sanitizeForSave, now = new Date().toISOString() } = deps;
  const defaultVault = createEmptyVault(migrateState, sanitizeForSave);

  if (!isPlainObject(rawVault)) {
    return { vault: defaultVault, changed: true };
  }

  const rawAppShell = isPlainObject(rawVault.appShell) ? rawVault.appShell : {};
  const rawCampaignIndex = isPlainObject(rawVault.campaignIndex) ? rawVault.campaignIndex : {};
  const rawEntries = isPlainObject(rawCampaignIndex.entries) ? rawCampaignIndex.entries : {};
  const rawDocs = isPlainObject(rawVault.campaignDocs) ? rawVault.campaignDocs : {};
  const rawOrder = Array.isArray(rawCampaignIndex.order) ? rawCampaignIndex.order : [];

  const seen = new Set();
  /** @type {string[]} */
  const candidateIds = [];
  const pushId = (value) => {
    const id = normalizeActiveCampaignId(value);
    if (!id || seen.has(id)) return;
    seen.add(id);
    candidateIds.push(id);
  };

  rawOrder.forEach(pushId);
  Object.keys(rawEntries).forEach(pushId);
  Object.keys(rawDocs).forEach(pushId);

  /** @type {Record<string, CampaignIndexEntry>} */
  const entries = {};
  /** @type {Record<string, CampaignDoc>} */
  const docs = {};

  for (const id of candidateIds) {
    const rawDoc = isPlainObject(rawDocs[id]) ? rawDocs[id] : null;
    if (!rawDoc) continue;

    const rawEntry = isPlainObject(rawEntries[id]) ? rawEntries[id] : {};
    const rawDocTracker = isPlainObject(rawDoc.tracker) ? rawDoc.tracker : null;
    const fallbackName = getCanonicalCampaignName(rawEntry.name || rawDocTracker?.campaignTitle);
    const doc = normalizeCampaignDoc(migrateState, sanitizeForSave, rawDoc, fallbackName);
    const canonicalName = getCanonicalCampaignName(rawEntry.name || doc.tracker?.campaignTitle);
    docs[id] = mirrorCampaignNameIntoDoc(doc, canonicalName);
    entries[id] = {
      id,
      name: canonicalName,
      createdAt: normalizeString(typeof rawEntry.createdAt === "string" ? rawEntry.createdAt : undefined, now),
      updatedAt: normalizeString(typeof rawEntry.updatedAt === "string" ? rawEntry.updatedAt : undefined, now),
      lastOpenedAt: normalizeOptionalTimestamp(rawEntry.lastOpenedAt)
    };
  }

  /** @type {string[]} */
  const order = [];
  for (const id of candidateIds) {
    if (entries[id] && docs[id]) order.push(id);
  }

  const requestedActiveId = Object.prototype.hasOwnProperty.call(rawAppShell, "activeCampaignId")
    ? normalizeActiveCampaignId(rawAppShell.activeCampaignId)
    : undefined;
  const activeCampaignId =
    requestedActiveId === null
      ? null
      : resolveActiveCampaignId({
        vaultVersion: VAULT_VERSION,
        appShell: { activeCampaignId: null, ui: defaultVault.appShell.ui },
        campaignIndex: { order, entries },
        campaignDocs: docs
      }, requestedActiveId);

  return {
    vault: {
      vaultVersion: VAULT_VERSION,
      appShell: {
        activeCampaignId,
        ui: normalizeVaultUi(migrateState, sanitizeForSave, rawAppShell.ui)
      },
      campaignIndex: {
        order,
        entries
      },
      campaignDocs: docs
    },
    changed: true
  };
}

/**
 * @param {AppState} target
 * @param {AppState} source
 * @returns {void}
 */
export function replaceRuntimeState(target, source) {
  target.schemaVersion = source.schemaVersion;
  target.tracker = source.tracker;
  target.character = source.character;
  target.map = source.map;
  target.ui = source.ui;
  target.appShell = source.appShell;
}

/**
 * @param {CampaignVault} vault
 * @param {string} campaignId
 * @param {string} nextName
 * @param {{ now?: string }} [deps]
 * @returns {CampaignVault}
 */
export function renameCampaignInVault(vault, campaignId, nextName, deps = {}) {
  const normalizedId = normalizeActiveCampaignId(campaignId);
  if (!normalizedId) throw new Error("renameCampaignInVault: campaignId is required");

  const existingEntry = vault?.campaignIndex?.entries?.[normalizedId];
  const existingDoc = vault?.campaignDocs?.[normalizedId];
  if (!existingEntry || !existingDoc) {
    throw new Error(`renameCampaignInVault: unknown campaign id "${campaignId}"`);
  }

  const canonicalName = getCanonicalCampaignName(nextName || existingEntry.name);
  const now = deps.now || new Date().toISOString();
  const nextVault = cloneVault(vault);
  nextVault.campaignIndex.entries[normalizedId] = {
    ...existingEntry,
    name: canonicalName,
    updatedAt: now
  };
  nextVault.campaignDocs[normalizedId] = mirrorCampaignNameIntoDoc(existingDoc, canonicalName);
  return nextVault;
}

/**
 * @param {CampaignVault} vault
 * @param {string} campaignId
 * @returns {CampaignVault}
 */
export function deleteCampaignFromVault(vault, campaignId) {
  const normalizedId = normalizeActiveCampaignId(campaignId);
  if (!normalizedId) throw new Error("deleteCampaignFromVault: campaignId is required");

  const existingEntry = vault?.campaignIndex?.entries?.[normalizedId];
  const existingDoc = vault?.campaignDocs?.[normalizedId];
  if (!existingEntry || !existingDoc) {
    throw new Error(`deleteCampaignFromVault: unknown campaign id "${campaignId}"`);
  }

  const nextVault = cloneVault(vault);
  delete nextVault.campaignIndex.entries[normalizedId];
  delete nextVault.campaignDocs[normalizedId];
  nextVault.campaignIndex.order = nextVault.campaignIndex.order.filter((id) => id !== normalizedId);
  if (nextVault.appShell.activeCampaignId === normalizedId) {
    nextVault.appShell.activeCampaignId = null;
  }
  return nextVault;
}

/**
 * @param {CampaignVault} vault
 * @param {typeof import("../state.js").migrateState} migrateState
 * @returns {AppState}
 */
export function projectActiveCampaignState(vault, migrateState) {
  const activeCampaignId = resolveActiveCampaignId(vault, vault?.appShell?.activeCampaignId);
  const appShellUi = clone(vault?.appShell?.ui || sanitizeUiFallback(migrateState));
  const runtimeUi = migrateState({ ui: appShellUi }).ui;
  const base = migrateState(undefined);

  if (!activeCampaignId) {
    base.ui = runtimeUi;
    base.appShell = { activeCampaignId: null };
    base.map.undo = [];
    base.map.redo = [];
    return base;
  }

  const entry = vault.campaignIndex.entries[activeCampaignId];
  const doc = mirrorCampaignNameIntoDoc(vault.campaignDocs[activeCampaignId], entry?.name || DEFAULT_CAMPAIGN_NAME);
  const runtime = migrateState({
    schemaVersion: doc.schemaVersion,
    tracker: doc.tracker,
    character: doc.character,
    map: doc.map,
    ui: appShellUi
  });
  runtime.appShell = { activeCampaignId };
  runtime.map.undo = [];
  runtime.map.redo = [];
  runtime.tracker.campaignTitle = getCanonicalCampaignName(entry?.name || runtime.tracker.campaignTitle);
  return runtime;
}

/**
 * @param {typeof import("../state.js").migrateState} migrateState
 * @returns {SanitizedState["ui"]}
 */
function sanitizeUiFallback(migrateState) {
  return clone(migrateState(undefined).ui);
}

/**
 * @param {AppState} state
 * @returns {string | null}
 */
export function getRuntimeActiveCampaignId(state) {
  return normalizeActiveCampaignId(state?.appShell?.activeCampaignId);
}

/**
 * @param {CampaignVault} vault
 * @param {AppState} state
 * @param {{
 *   sanitizeForSave: typeof import("../state.js").sanitizeForSave,
 *   now?: string
 * }} deps
 * @returns {CampaignVault}
 */
export function persistRuntimeStateToVault(vault, state, deps) {
  const { sanitizeForSave, now = new Date().toISOString() } = deps;
  const nextVault = cloneVault(vault);
  const activeCampaignId = getRuntimeActiveCampaignId(state);
  const sanitized = sanitizeForSave(state);

  nextVault.appShell = {
    activeCampaignId,
    ui: clone(sanitized.ui)
  };

  if (!activeCampaignId) {
    return nextVault;
  }

  const existingEntry = nextVault.campaignIndex.entries[activeCampaignId];
  const canonicalName = getCanonicalCampaignName(state?.tracker?.campaignTitle || existingEntry?.name);
  const nextDoc = mirrorCampaignNameIntoDoc(extractCampaignDoc(state, sanitizeForSave), canonicalName);

  nextVault.campaignDocs[activeCampaignId] = nextDoc;
  nextVault.campaignIndex.entries[activeCampaignId] = {
    id: activeCampaignId,
    name: canonicalName,
    createdAt: normalizeString(existingEntry?.createdAt, now),
    updatedAt: now,
    lastOpenedAt: now
  };

  if (!nextVault.campaignIndex.order.includes(activeCampaignId)) {
    nextVault.campaignIndex.order.push(activeCampaignId);
  }

  nextVault.appShell.activeCampaignId = activeCampaignId;
  return nextVault;
}

/**
 * @param {AppState | SanitizedState | CampaignDoc | null | undefined} stateLike
 * @returns {Set<string>}
 */
export function collectCampaignSpellIds(stateLike) {
  const ids = new Set();
  if (!isPlainObject(stateLike)) return ids;

  const character = isPlainObject(stateLike.character) ? stateLike.character : null;
  const spells = isPlainObject(character?.spells) ? character.spells : null;
  const levels = Array.isArray(spells?.levels) ? spells.levels : [];

  for (const level of levels) {
    if (!isPlainObject(level) || !Array.isArray(level.spells)) continue;
    for (const spell of level.spells) {
      if (!isPlainObject(spell) || typeof spell.id !== "string") continue;
      const spellId = spell.id.trim();
      if (spellId) ids.add(spellId);
    }
  }

  return ids;
}

/**
 * @param {{
 *   legacyState: unknown,
 *   migrateState: typeof import("../state.js").migrateState,
 *   sanitizeForSave: typeof import("../state.js").sanitizeForSave,
 *   now?: string
 * }} deps
 * @returns {LegacyWrapResult}
 */
export function wrapLegacyStateInVault(deps) {
  const {
    legacyState,
    migrateState,
    sanitizeForSave,
    now = new Date().toISOString()
  } = deps;

  const migrated = migrateState(legacyState);
  const activeCampaignId = LEGACY_MIGRATION_CAMPAIGN_ID;
  const canonicalName = getCanonicalCampaignName(migrated.tracker?.campaignTitle);
  const doc = mirrorCampaignNameIntoDoc(extractCampaignDoc(migrated, sanitizeForSave), canonicalName);

  return {
    vault: {
      vaultVersion: VAULT_VERSION,
      appShell: {
        activeCampaignId,
        ui: clone(sanitizeForSave(migrated).ui)
      },
      campaignIndex: {
        order: [activeCampaignId],
        entries: {
          [activeCampaignId]: {
            id: activeCampaignId,
            name: canonicalName,
            createdAt: now,
            updatedAt: now,
            lastOpenedAt: now
          }
        }
      },
      campaignDocs: {
        [activeCampaignId]: doc
      }
    },
    activeCampaignId,
    migratedFromLegacy: true,
    changed: true
  };
}
