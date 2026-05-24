// @ts-check

/**
 * @typedef {{ exportBackup?: (options: { filename: string, json: string }) => Promise<unknown> }} NativeBackupExportPlugin
 */

/**
 * @typedef {{
 *   hasCapacitor: boolean,
 *   isNativePlatform: boolean,
 *   platform: string,
 *   pluginAvailable: boolean
 * }} CapacitorRuntimeSnapshot
 */

/**
 * @typedef {{ status: "saved" | "cancelled" }} NativeBackupExportResult
 */

export class NativeBackupExportError extends Error {
  /**
   * @param {string} message
   * @param {{ code?: string, cause?: unknown }} [options]
   */
  constructor(message, options = {}) {
    super(message);
    this.name = "NativeBackupExportError";
    this.code = typeof options.code === "string" && options.code ? options.code : "NATIVE_BACKUP_EXPORT_ERROR";
    if ("cause" in options) {
      this.cause = options.cause;
    }
  }
}

/**
 * @returns {Record<string, any> | null}
 */
function getCapacitorGlobal() {
  const cap = Reflect.get(globalThis, "Capacitor");
  return cap && typeof cap === "object" ? /** @type {Record<string, any>} */ (cap) : null;
}

/**
 * @param {Record<string, any> | null} capacitor
 * @returns {NativeBackupExportPlugin | null}
 */
function getNativeBackupExportPlugin(capacitor) {
  if (!capacitor) return null;
  const plugins = Reflect.get(capacitor, "Plugins");
  if (!plugins || typeof plugins !== "object") return null;
  const plugin = Reflect.get(plugins, "NativeBackupExport");
  return plugin && typeof plugin === "object"
    ? /** @type {NativeBackupExportPlugin} */ (plugin)
    : null;
}

/**
 * @param {Record<string, any> | null} capacitor
 * @returns {string}
 */
function getCapacitorPlatform(capacitor) {
  if (!capacitor || typeof capacitor.getPlatform !== "function") return "";
  try {
    const platform = capacitor.getPlatform();
    return typeof platform === "string" ? platform : "";
  } catch {
    return "";
  }
}

/**
 * @param {Record<string, any> | null} capacitor
 * @returns {boolean}
 */
function isCapacitorNativePlatform(capacitor) {
  if (!capacitor || typeof capacitor.isNativePlatform !== "function") return false;
  try {
    return capacitor.isNativePlatform() === true;
  } catch {
    return false;
  }
}

/**
 * @returns {CapacitorRuntimeSnapshot}
 */
export function collectCapacitorRuntimeSnapshot() {
  const capacitor = getCapacitorGlobal();
  const plugin = getNativeBackupExportPlugin(capacitor);
  return {
    hasCapacitor: !!capacitor,
    isNativePlatform: isCapacitorNativePlatform(capacitor),
    platform: getCapacitorPlatform(capacitor),
    pluginAvailable: !!plugin && typeof plugin.exportBackup === "function"
  };
}

/**
 * @param {{ filename: string, json: string }} options
 * @returns {Promise<NativeBackupExportResult>}
 */
export async function exportBackupNative(options) {
  const filename = typeof options?.filename === "string" ? options.filename.trim() : "";
  const json = typeof options?.json === "string" ? options.json : "";
  if (!filename || !/\.json$/i.test(filename)) {
    throw new NativeBackupExportError("Native backup export requires a .json filename.", {
      code: "INVALID_FILENAME"
    });
  }
  if (!json) {
    throw new NativeBackupExportError("Native backup export requires JSON content.", {
      code: "INVALID_JSON"
    });
  }

  const capacitor = getCapacitorGlobal();
  const plugin = getNativeBackupExportPlugin(capacitor);
  if (!plugin || typeof plugin.exportBackup !== "function") {
    throw new NativeBackupExportError("Native backup export is not available in this build.", {
      code: "UNAVAILABLE"
    });
  }

  try {
    const result = await plugin.exportBackup({ filename, json });
    if (result && typeof result === "object") {
      const status = Reflect.get(result, "status");
      if (status === "saved" || status === "cancelled") {
        return { status };
      }
    }
    throw new NativeBackupExportError("Native backup export returned an invalid result.", {
      code: "INVALID_RESULT"
    });
  } catch (error) {
    if (error instanceof NativeBackupExportError) throw error;

    const message = error instanceof Error && error.message
      ? error.message
      : "Native backup export failed.";
    const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
      ? error.code
      : "NATIVE_EXPORT_FAILED";
    throw new NativeBackupExportError(message, { code, cause: error });
  }
}
