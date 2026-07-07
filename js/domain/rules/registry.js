// @ts-check
// Content registry: builtin SRD 5.1 records plus campaign custom content.
//
// IDs are unique per kind (not globally): "shield" exists as both armor and
// spell. Kind-typed lookups (getContentByKind) are the canonical path; the
// legacy id-only lookup remains for pre-existing callers where the id space
// cannot collide (races/ancestries).

import { BUILTIN_CONTENT, CONTENT_KINDS, toContentEntry } from "./builtinContent.js";

/** @typedef {import("./builtinContent.js").BuiltinContentEntry} BuiltinContentEntry */
/** @typedef {import("./builtinContent.js").BuiltinContentKind} BuiltinContentKind */

/**
 * @typedef {{
 *   entries: BuiltinContentEntry[],
 *   byId: Map<string, BuiltinContentEntry>,
 *   byKindId: Map<string, BuiltinContentEntry>,
 *   byKind: Map<string, BuiltinContentEntry[]>
 * }} ContentRegistry
 */

export const CUSTOM_CONTENT_SOURCE = "custom";

/**
 * @param {unknown} value
 * @returns {value is BuiltinContentEntry}
 */
function isContentEntry(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = /** @type {Record<string, unknown>} */ (value);
  return !!value &&
    typeof entry.id === "string" &&
    typeof entry.kind === "string" &&
    typeof entry.name === "string";
}

/**
 * @param {readonly unknown[]} [entries]
 * @returns {ContentRegistry}
 */
export function createContentRegistry(entries = BUILTIN_CONTENT) {
  const normalizedEntries = entries.filter(isContentEntry);
  /** @type {Map<string, BuiltinContentEntry>} */
  const byId = new Map();
  /** @type {Map<string, BuiltinContentEntry>} */
  const byKindId = new Map();
  /** @type {Map<string, BuiltinContentEntry[]>} */
  const byKind = new Map();
  for (const entry of normalizedEntries) {
    if (!byId.has(entry.id)) byId.set(entry.id, entry);
    const kindKey = `${entry.kind}:${entry.id}`;
    if (!byKindId.has(kindKey)) byKindId.set(kindKey, entry);
    const list = byKind.get(entry.kind);
    if (list) list.push(entry);
    else byKind.set(entry.kind, [entry]);
  }
  return {
    entries: normalizedEntries.slice(),
    byId,
    byKindId,
    byKind
  };
}

/**
 * Legacy id-only lookup. Prefer getContentByKind for kind-typed fields.
 * @param {ContentRegistry | null | undefined} registry
 * @param {unknown} id
 * @returns {BuiltinContentEntry | null}
 */
export function getContentById(registry, id) {
  if (!registry || typeof id !== "string") return null;
  const normalizedId = id.trim();
  if (!normalizedId) return null;
  return registry.byId?.get(normalizedId) || null;
}

/**
 * Kind-typed lookup — the canonical path for classId/raceId/spellId/etc.
 * @param {ContentRegistry | null | undefined} registry
 * @param {BuiltinContentKind | string} kind
 * @param {unknown} id
 * @returns {BuiltinContentEntry | null}
 */
export function getContentByKind(registry, kind, id) {
  if (!registry || typeof kind !== "string" || typeof id !== "string") return null;
  const normalizedId = id.trim();
  if (!normalizedId) return null;
  return registry.byKindId?.get(`${kind}:${normalizedId}`) || null;
}

/**
 * @param {ContentRegistry | null | undefined} registry
 * @param {BuiltinContentKind | string} kind
 * @returns {BuiltinContentEntry[]}
 */
export function listContentByKind(registry, kind) {
  if (!registry || typeof kind !== "string") return [];
  if (registry.byKind) return (registry.byKind.get(kind) || []).slice();
  return (Array.isArray(registry.entries) ? registry.entries : [])
    .filter((entry) => entry.kind === kind);
}

/**
 * Validates and wraps persisted custom content records into registry entries.
 * Records that shadow a builtin (same kind + id) or duplicate an earlier
 * custom record are skipped; their ids are reported for surfacing.
 *
 * @param {unknown} records
 * @returns {{ entries: BuiltinContentEntry[], skipped: Array<{ id: string, reason: string }> }}
 */
export function normalizeCustomContent(records) {
  /** @type {BuiltinContentEntry[]} */
  const entries = [];
  /** @type {Array<{ id: string, reason: string }>} */
  const skipped = [];
  if (!Array.isArray(records)) return { entries, skipped };
  const seen = new Set();
  for (const record of records) {
    const base = toContentEntry(record);
    if (!base) {
      const id = record && typeof record === "object" && typeof (/** @type {{id?: unknown}} */ (record).id) === "string"
        ? String(/** @type {{id?: unknown}} */ (record).id)
        : "<invalid>";
      skipped.push({ id, reason: "invalid-shape" });
      continue;
    }
    const kindKey = `${base.kind}:${base.id}`;
    if (BUILTIN_KIND_IDS.has(kindKey)) {
      skipped.push({ id: base.id, reason: "shadows-builtin" });
      continue;
    }
    if (seen.has(kindKey)) {
      skipped.push({ id: base.id, reason: "duplicate-custom" });
      continue;
    }
    seen.add(kindKey);
    entries.push(Object.freeze({ ...base, source: CUSTOM_CONTENT_SOURCE }));
  }
  return { entries, skipped };
}

const BUILTIN_KIND_IDS = new Set(BUILTIN_CONTENT.map((entry) => `${entry.kind}:${entry.id}`));

export const BUILTIN_CONTENT_REGISTRY = createContentRegistry(BUILTIN_CONTENT);

/** @type {ContentRegistry} */
let activeRegistry = BUILTIN_CONTENT_REGISTRY;

/** @type {(() => unknown) | null} */
let customContentProvider = null;
/** @type {unknown} */
let lastCustomContentRef;

/**
 * Rebuilds the active registry from builtin content plus the given custom
 * records (normally state.content.custom).
 *
 * @param {unknown} customRecords
 * @returns {{ registry: ContentRegistry, skipped: Array<{ id: string, reason: string }> }}
 */
export function setActiveCustomContent(customRecords) {
  const { entries, skipped } = normalizeCustomContent(customRecords);
  activeRegistry = entries.length
    ? createContentRegistry([...BUILTIN_CONTENT, ...entries])
    : BUILTIN_CONTENT_REGISTRY;
  lastCustomContentRef = customRecords;
  return { registry: activeRegistry, skipped };
}

/**
 * Binds a provider returning the live custom content array (normally
 * `() => state.content?.custom`). The active registry rebuilds whenever the
 * provided array identity changes, so custom-content mutations must replace
 * the array rather than push in place (see js/domain/customContent.js).
 *
 * @param {(() => unknown) | null} provider
 * @returns {void}
 */
export function bindCustomContentProvider(provider) {
  customContentProvider = typeof provider === "function" ? provider : null;
  lastCustomContentRef = undefined;
}

/**
 * The registry reflecting builtin content plus currently loaded custom
 * content. Derivation and UI code should default to this.
 * @returns {ContentRegistry}
 */
export function getActiveContentRegistry() {
  if (customContentProvider) {
    let current;
    try {
      current = customContentProvider();
    } catch {
      current = undefined;
    }
    if (current !== lastCustomContentRef) {
      setActiveCustomContent(current);
    }
  }
  return activeRegistry;
}

export { CONTENT_KINDS };
