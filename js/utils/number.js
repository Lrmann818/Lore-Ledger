// @ts-check

// Number parsing helpers

/**
 * Convert a value to a number, returning null for empty/invalid values.
 * @param {unknown} v
 * @returns {number|null}
 */
export function numberOrNull(v) {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
