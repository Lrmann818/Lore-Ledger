// @ts-check
// js/storage/diagnostics.js
// Read-only storage diagnostics. No writes, no probing writes, no quota manipulation.

/**
 * @typedef {{
 *   appBytes: number,
 *   appFormatted: string,
 *   browserUsed: number | null,
 *   browserUsedFormatted: string | null,
 *   browserQuota: number | null,
 *   browserQuotaFormatted: string | null,
 *   browserAvailable: number | null,
 *   browserAvailableFormatted: string | null,
 *   estimateSupported: boolean
 * }} StorageDiagnostics
 */

/**
 * Format a byte count into a human-readable string.
 * Follows the SI-adjacent convention used widely in storage UIs (1 KB = 1024 bytes).
 *
 * @param {number} bytes
 * @returns {string}
 */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 bytes";
  if (bytes === 1) return "1 byte";
  if (bytes < 1024) return `${bytes} bytes`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(2)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

/**
 * Calculate the total bytes consumed by the given localStorage keys.
 *
 * localStorage stores DOMStrings (UTF-16), so each character occupies 2 bytes.
 * Both the key name and its value contribute to storage consumption.
 *
 * @param {string[]} keys - The localStorage key names to measure.
 * @returns {number} Total bytes, or 0 if localStorage is inaccessible.
 */
export function calcAppLocalStorageBytes(keys) {
  let total = 0;
  for (const key of keys) {
    try {
      const val = localStorage.getItem(key);
      if (val !== null) {
        // Each JS string character is one UTF-16 code unit = 2 bytes.
        total += (key.length + val.length) * 2;
      }
    } catch {
      // localStorage may be unavailable (private browsing restrictions, etc.)
    }
  }
  return total;
}

/**
 * Request a StorageEstimate from the browser.
 * Returns null if the Storage API is unavailable or the call fails.
 *
 * navigator.storage.estimate() is a Promise-based API available in modern
 * browsers. It covers the entire browser storage origin (localStorage,
 * IndexedDB, Cache API, etc.), not just localStorage.
 *
 * @returns {Promise<StorageEstimate | null>}
 */
export async function getStorageEstimate() {
  try {
    if (
      typeof navigator !== "undefined" &&
      navigator.storage &&
      typeof navigator.storage.estimate === "function"
    ) {
      return await navigator.storage.estimate();
    }
  } catch {
    // estimate() can throw inside sandboxed iframes or on older browsers.
  }
  return null;
}

/**
 * Gather a complete storage diagnostics snapshot.
 *
 * @param {string[]} appKeys - The localStorage key names owned by this app.
 * @returns {Promise<StorageDiagnostics>}
 */
export async function getStorageDiagnostics(appKeys) {
  const appBytes = calcAppLocalStorageBytes(appKeys);
  const estimate = await getStorageEstimate();

  const browserUsed =
    estimate !== null && typeof estimate.usage === "number" ? estimate.usage : null;
  const browserQuota =
    estimate !== null && typeof estimate.quota === "number" ? estimate.quota : null;
  const browserAvailable =
    browserUsed !== null && browserQuota !== null
      ? Math.max(0, browserQuota - browserUsed)
      : null;

  return {
    appBytes,
    appFormatted: formatBytes(appBytes),
    browserUsed,
    browserUsedFormatted: browserUsed !== null ? formatBytes(browserUsed) : null,
    browserQuota,
    browserQuotaFormatted: browserQuota !== null ? formatBytes(browserQuota) : null,
    browserAvailable,
    browserAvailableFormatted:
      browserAvailable !== null ? formatBytes(browserAvailable) : null,
    estimateSupported: estimate !== null
  };
}
