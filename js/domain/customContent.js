// @ts-check
// Campaign custom (homebrew) content helpers.
//
// Custom records live in state.content.custom and use the same normalized
// record shape as the shipped SRD registry files (id/kind/name plus
// category-specific fields), with source forced to "custom". They merge
// into the active content registry at derivation time and travel with
// backup/export/import as part of the campaign state.

import { CONTENT_KINDS } from "./rules/builtinContent.js";
import { BUILTIN_CONTENT_REGISTRY, getContentByKind } from "./rules/registry.js";
import { getClassResourceDefinitions } from "./rules/classResources.js";

/** @typedef {import("../state.js").State} State */

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Ensures the custom content bucket exists on state (mutating defensively,
 * mirroring migrateState's guarantee for older in-memory states).
 * @param {State} state
 * @returns {Record<string, unknown>[]}
 */
export function ensureCustomContent(state) {
  if (!isPlainObject(state.content)) state.content = { custom: [] };
  const content = /** @type {{ custom?: unknown }} */ (state.content);
  if (!Array.isArray(content.custom)) content.custom = [];
  return /** @type {Record<string, unknown>[]} */ (content.custom);
}

/**
 * Validates a single custom content record.
 * @param {unknown} record
 * @param {{ existing?: Array<Record<string, unknown>> }} [options]
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateCustomContentRecord(record, options = {}) {
  /** @type {string[]} */
  const errors = [];
  if (!isPlainObject(record)) {
    return { ok: false, errors: ["Record must be a JSON object."] };
  }
  const id = typeof record.id === "string" ? record.id.trim() : "";
  const kind = typeof record.kind === "string" ? record.kind.trim() : "";
  const name = typeof record.name === "string" ? record.name.trim() : "";
  if (!id) errors.push("Missing id.");
  else if (!ID_PATTERN.test(id)) errors.push(`Invalid id "${id}" (use lowercase letters, digits, hyphens).`);
  if (!kind) errors.push("Missing kind.");
  else if (!CONTENT_KINDS.has(kind)) {
    errors.push(`Unknown kind "${kind}". Supported: ${[...CONTENT_KINDS].join(", ")}.`);
  }
  if (!name) errors.push("Missing name.");
  if (id && kind && CONTENT_KINDS.has(kind)) {
    if (getContentByKind(BUILTIN_CONTENT_REGISTRY, kind, id)) {
      errors.push(`"${kind}:${id}" already exists as builtin SRD content.`);
    }
    const existing = Array.isArray(options.existing) ? options.existing : [];
    if (existing.some((entry) => isPlainObject(entry) && entry.id === id && entry.kind === kind)) {
      errors.push(`"${kind}:${id}" already exists as custom content.`);
    }
  }
  // Custom classes may declare limited-use pools via `resources: []` (see
  // content-registry-plan.md "Class Resources"). Surface malformed
  // definitions at import time instead of silently dropping them at
  // derivation time.
  if (kind === "class" && "resources" in record && record.resources !== undefined) {
    if (!Array.isArray(record.resources)) {
      errors.push("Class `resources` must be an array of resource definitions.");
    } else {
      const probe = getClassResourceDefinitions(/** @type {never} */ ({
        id: id || "custom-class",
        kind: "class",
        name: name || "Custom Class",
        source: "custom",
        data: record
      }));
      errors.push(...probe.warnings.map((warning) => `${warning} (id, name, max shape, and recovery are required).`));
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Adds custom records to state.content.custom, replacing the array
 * immutably so the active registry cache invalidates. Invalid records are
 * rejected, valid ones added; caller decides whether partial success is
 * acceptable and must run inside a state mutation + markDirty flow.
 *
 * @param {State} state
 * @param {unknown[]} records
 * @returns {{ added: number, errors: Array<{ index: number, errors: string[] }> }}
 */
export function addCustomContentRecords(state, records) {
  const current = ensureCustomContent(state);
  /** @type {Array<Record<string, unknown>>} */
  const next = current.slice();
  /** @type {Array<{ index: number, errors: string[] }>} */
  const failures = [];
  let added = 0;
  records.forEach((record, index) => {
    const result = validateCustomContentRecord(record, { existing: next });
    if (!result.ok) {
      failures.push({ index, errors: result.errors });
      return;
    }
    const clean = { .../** @type {Record<string, unknown>} */ (record), source: "custom" };
    next.push(clean);
    added += 1;
  });
  if (added > 0) {
    /** @type {{ custom: Record<string, unknown>[] }} */ (state.content).custom = next;
  }
  return { added, errors: failures };
}

/**
 * Replaces one existing custom record in place (same kind + id — identity is
 * immutable so character references never break). The array is replaced
 * immutably so the active registry cache invalidates. Must run inside a
 * state mutation + markDirty flow.
 *
 * @param {State} state
 * @param {string} kind
 * @param {string} id
 * @param {unknown} record
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function updateCustomContentRecord(state, kind, id, record) {
  const current = ensureCustomContent(state);
  const index = current.findIndex((entry) => isPlainObject(entry) && entry.kind === kind && entry.id === id);
  if (index === -1) {
    return { ok: false, errors: [`No custom ${kind} "${id}" exists to update.`] };
  }
  if (!isPlainObject(record) || record.kind !== kind || record.id !== id) {
    return { ok: false, errors: ["Updated record must keep its original kind and id."] };
  }
  const existing = current.filter((_, entryIndex) => entryIndex !== index);
  const result = validateCustomContentRecord(record, { existing });
  if (!result.ok) return { ok: false, errors: result.errors };
  const next = current.slice();
  next[index] = { .../** @type {Record<string, unknown>} */ (record), source: "custom" };
  /** @type {{ custom: Record<string, unknown>[] }} */ (state.content).custom = next;
  return { ok: true, errors: [] };
}

/**
 * Removes one custom record by kind + id. Returns whether a record was
 * removed. Must run inside a state mutation + markDirty flow.
 * @param {State} state
 * @param {string} kind
 * @param {string} id
 * @returns {boolean}
 */
export function removeCustomContentRecord(state, kind, id) {
  const current = ensureCustomContent(state);
  const next = current.filter((record) => !(isPlainObject(record) && record.kind === kind && record.id === id));
  if (next.length === current.length) return false;
  /** @type {{ custom: Record<string, unknown>[] }} */ (state.content).custom = next;
  return true;
}

/**
 * @param {State} state
 * @returns {Array<Record<string, unknown>>}
 */
export function listCustomContent(state) {
  const content = /** @type {{ custom?: unknown }} */ (isPlainObject(state?.content) ? state.content : {});
  return Array.isArray(content.custom)
    ? content.custom.filter(isPlainObject)
    : [];
}
