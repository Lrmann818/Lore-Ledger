// @ts-check

import { DEV_MODE } from "./dev.js";

/**
 * @typedef {{ key: string, selector: string }} MissingDomEntry
 */

/** @type {{ destroy: () => void }} */
const NOOP_DESTROY_API = Object.freeze({
  destroy() { }
});

function resolveRoot(root) {
  if (root && typeof root.querySelector === "function") return root;
  if (typeof document !== "undefined") return document;
  return null;
}

export function requireEl(selector, root, options = {}) {
  const resolvedRoot = resolveRoot(root);
  if (!resolvedRoot) return null;

  let el = null;
  try {
    el = resolvedRoot.querySelector(selector);
  } catch (err) {
    if (options.warn !== false) {
      console.warn(`[dom] Invalid selector "${selector}"`, err);
    }
    return null;
  }

  if (el) return el;

  if (options.warn !== false) {
    const prefix = options.prefix ? `${options.prefix}: ` : "";
    console.warn(`[dom] ${prefix}Missing required element "${selector}"`);
  }

  return null;
}

export function assertEl(selector, root, options = {}) {
  const el = requireEl(selector, root, options);
  if (el) return el;

  if (DEV_MODE) {
    const prefix = options.prefix ? `${options.prefix}: ` : "";
    throw new Error(`${prefix}Missing required element "${selector}"`);
  }

  return null;
}

export function getNoopDestroyApi() {
  return NOOP_DESTROY_API;
}

/**
 * @param {unknown} spec
 * @returns {MissingDomEntry[]}
 */
function normalizeSpec(spec) {
  if (!spec) return [];

  if (Array.isArray(spec)) {
    return spec
      .filter((entry) => Array.isArray(entry) && entry.length >= 2)
      .map(([key, selector]) => ({
        key: String(key),
        selector: String(selector)
      }));
  }

  if (typeof spec === "object") {
    return Object.entries(spec).map(([key, selector]) => ({
      key: String(key),
      selector: String(selector)
    }));
  }

  return [];
}

/**
 * @param {string} context
 * @param {ReadonlyArray<MissingDomEntry> | null | undefined} missingList
 * @returns {string}
 */
export function buildMissingMessage(context, missingList) {
  const missing = Array.isArray(missingList) ? missingList : [];
  const base = context ? `${context} unavailable` : "Module unavailable";
  if (!missing.length) return `${base}.`;

  const detail = missing
    .map(({ key, selector }) => `${key} (${selector})`)
    .join(", ");

  return `${base} (missing required elements: ${detail}).`;
}

export function requireMany(spec, opts = {}) {
  const entries = normalizeSpec(spec);
  const root = resolveRoot(opts.root);
  const els = {};
  /** @type {MissingDomEntry[]} */
  const missing = [];
  const stickyMs = Number.isFinite(opts.stickyMs) ? Number(opts.stickyMs) : 5000;
  const devAssert = opts.devAssert !== undefined ? !!opts.devAssert : DEV_MODE;
  const context = opts.context ? String(opts.context) : "";

  if (!entries.length) {
    return {
      ok: true,
      els,
      destroy: null,
      missing: [],
      message: ""
    };
  }

  if (!root) {
    entries.forEach(({ key, selector }) => missing.push({ key, selector }));
  } else {
    entries.forEach(({ key, selector }) => {
      const el = requireEl(selector, root, { warn: false });
      if (el) {
        els[key] = el;
        return;
      }
      missing.push({ key, selector });
    });
  }

  if (!missing.length) {
    return {
      ok: true,
      els,
      destroy: null,
      missing: [],
      message: ""
    };
  }

  const message = buildMissingMessage(context, missing);

  if (devAssert) {
    throw new Error(message);
  }

  if (typeof opts.setStatus === "function") {
    opts.setStatus(message, { stickyMs });
  } else if (opts.warn !== false) {
    console.warn(message);
  }

  return {
    ok: false,
    els: {},
    destroy: getNoopDestroyApi(),
    missing,
    message
  };
}
