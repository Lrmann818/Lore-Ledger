// @ts-check

/**
 * @typedef {{
 *   locationObj?: { protocol?: unknown } | null,
 *   capacitorObj?: { isNativePlatform?: (() => boolean) | unknown } | null
 * }} NativeRuntimeOptions
 */

/**
 * Treat Capacitor-native launches as a distinct runtime from browser/PWA launches.
 *
 * @param {NativeRuntimeOptions} [options]
 * @returns {boolean}
 */
export function isNativeAppRuntime(options = {}) {
  const locationObj = options.locationObj ?? globalThis.location;
  if (locationObj?.protocol === "capacitor:") return true;

  const globals = /** @type {typeof globalThis & { Capacitor?: { isNativePlatform?: (() => boolean) | unknown } }} */ (globalThis);
  const capacitorObj = options.capacitorObj ?? globals.Capacitor;
  if (!capacitorObj || typeof capacitorObj !== "object") return false;
  if (typeof capacitorObj.isNativePlatform !== "function") return false;

  try {
    return capacitorObj.isNativePlatform() === true;
  } catch {
    return false;
  }
}

/**
 * Keeps a small runtime class on the root/body so CSS can gate native-only behavior.
 *
 * @param {{
 *   documentElement?: Element | null,
 *   body?: Element | null,
 *   className?: string,
 *   enabled?: boolean
 * }} [options]
 * @returns {boolean}
 */
export function syncNativeAppClass(options = {}) {
  const {
    documentElement = typeof document === "undefined" ? null : document.documentElement,
    body = typeof document === "undefined" ? null : document.body,
    className = "is-native-app",
    enabled = isNativeAppRuntime()
  } = options;

  documentElement?.classList?.toggle(className, enabled);
  body?.classList?.toggle(className, enabled);
  return enabled;
}
