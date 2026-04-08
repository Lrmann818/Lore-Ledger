// @ts-check

export const SUPPORT_EMAIL = "support@lore-ledger.com";
export const BUG_REPORT_SUBJECT = "Lore Ledger Bug Report";

/**
 * @param {unknown} value
 * @param {string} fallback
 * @returns {string}
 */
function toNonEmptyString(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

/**
 * @param {{ version?: unknown, build?: unknown }} [options]
 * @returns {{ version: string, build: string }}
 */
export function getAppReleaseInfo(options = {}) {
  const defaultVersion = typeof __APP_VERSION__ === "string" ? __APP_VERSION__ : "";
  const defaultBuild = typeof __APP_BUILD__ === "string" ? __APP_BUILD__ : "";

  return {
    version: toNonEmptyString(options.version, toNonEmptyString(defaultVersion, "dev")),
    build: toNonEmptyString(options.build)
  };
}

/**
 * @param {{ version?: unknown, build?: unknown }} [options]
 * @returns {string}
 */
export function formatSupportSummary(options = {}) {
  const { version, build } = getAppReleaseInfo(options);
  return build ? `Version ${version} • Build ${build}` : `Version ${version}`;
}

/**
 * @param {unknown} value
 * @param {string} fallback
 * @returns {string}
 */
function normalizeSupportRoute(value, fallback = "(unknown)") {
  const route = toNonEmptyString(value);
  if (!route) return fallback;
  if (route === fallback) return fallback;
  if (route.startsWith("#")) return route;
  return `#${route.replace(/^#+/, "")}`;
}

/**
 * @param {{ windowObj?: { matchMedia?: ((query: string) => { matches: boolean }) | undefined } | null, navigatorObj?: unknown }} [options]
 * @returns {"web" | "pwa"}
 */
export function detectRuntimeMode(options = {}) {
  const windowObj = options.windowObj ?? globalThis.window;
  const navigatorObj = options.navigatorObj ?? globalThis.navigator;

  try {
    if (windowObj?.matchMedia?.("(display-mode: standalone)")?.matches) return "pwa";
  } catch {
    // Ignore matchMedia/environment errors and fall through to a conservative label.
  }

  const standalone = navigatorObj && typeof navigatorObj === "object"
    ? Reflect.get(navigatorObj, "standalone")
    : undefined;
  if (standalone === true) return "pwa";
  return "web";
}

/**
 * @param {{ locationObj?: { hash?: unknown, pathname?: unknown, search?: unknown } | null, fallbackPage?: unknown }} [options]
 * @returns {string}
 */
export function getCurrentRoute(options = {}) {
  const locationObj = options.locationObj ?? globalThis.location;
  const hash = toNonEmptyString(locationObj?.hash);
  if (hash) return normalizeSupportRoute(hash);

  const fallbackPage = toNonEmptyString(options.fallbackPage);
  if (fallbackPage) return normalizeSupportRoute(fallbackPage);

  return "(unknown)";
}

/**
 * @param {{
 *   version?: unknown,
 *   build?: unknown,
 *   fallbackPage?: unknown,
 *   locationObj?: { hash?: unknown, pathname?: unknown, search?: unknown } | null,
 *   navigatorObj?: unknown,
 *   windowObj?: { matchMedia?: ((query: string) => { matches: boolean }) | undefined } | null,
 *   timestamp?: unknown
 * }} [options]
 * @returns {{
 *   version: string,
 *   build: string,
 *   runtimeMode: string,
 *   currentRoute: string,
 *   timestamp: string,
 *   userAgent: string
 * }}
 */
export function collectDebugInfoSnapshot(options = {}) {
  const { version, build } = getAppReleaseInfo(options);
  const navigatorObj = options.navigatorObj ?? globalThis.navigator;

  return {
    version,
    build,
    runtimeMode: detectRuntimeMode({ windowObj: options.windowObj, navigatorObj }),
    currentRoute: getCurrentRoute({ locationObj: options.locationObj, fallbackPage: options.fallbackPage }),
    timestamp: toNonEmptyString(options.timestamp, new Date().toISOString()),
    userAgent: toNonEmptyString(
      navigatorObj && typeof navigatorObj === "object"
        ? Reflect.get(navigatorObj, "userAgent")
        : "",
      "(unknown)"
    )
  };
}

/**
 * @param {{
 *   version?: unknown,
 *   build?: unknown,
 *   runtimeMode?: unknown,
 *   currentRoute?: unknown,
 *   timestamp?: unknown,
 *   userAgent?: unknown
 * }} [options]
 * @returns {string}
 */
export function buildDebugInfoText(options = {}) {
  const { version, build } = getAppReleaseInfo(options);
  const runtimeMode = toNonEmptyString(options.runtimeMode, "web");
  const currentRoute = normalizeSupportRoute(options.currentRoute, "(unknown)");
  const timestamp = toNonEmptyString(options.timestamp, "(unknown)");
  const userAgent = toNonEmptyString(options.userAgent, "(unknown)");

  return [
    `App version: ${version}`,
    build ? `Build id: ${build}` : null,
    `Runtime mode: ${runtimeMode}`,
    `Current page: ${currentRoute}`,
    `Timestamp: ${timestamp}`,
    `User agent: ${userAgent}`
  ]
    .filter((line) => typeof line === "string")
    .join("\n");
}

/**
 * @param {{ debugInfoText: string }} options
 * @returns {string}
 */
export function buildBugReportBody(options) {
  const debugInfoText = toNonEmptyString(options?.debugInfoText);
  return [
    "Please describe the bug:",
    "",
    "What were you doing?",
    "",
    "What did you expect to happen?",
    "",
    "What happened instead?",
    "",
    "Can you reproduce it?",
    "",
    "Debug info:",
    debugInfoText
  ].join("\n");
}

/**
 * @param {{ recipient?: unknown, subject?: unknown, debugInfoText: string }} options
 * @returns {string}
 */
export function buildBugReportMailtoUrl(options) {
  const recipient = toNonEmptyString(options?.recipient, SUPPORT_EMAIL);
  const subject = toNonEmptyString(options?.subject, BUG_REPORT_SUBJECT);
  const body = buildBugReportBody({ debugInfoText: options?.debugInfoText || "" });
  const params = new URLSearchParams();
  params.set("subject", subject);
  params.set("body", body);
  return `mailto:${encodeURIComponent(recipient)}?${params.toString()}`;
}

/**
 * @param {{
 *   recipient?: unknown,
 *   subject?: unknown,
 *   debugInfoText: string,
 *   locationObj?: { href?: string } | null
 * }} options
 * @returns {string}
 */
export function openBugReportMailto(options) {
  const locationObj = options?.locationObj ?? globalThis.location;
  const mailtoUrl = buildBugReportMailtoUrl(options);
  if (locationObj) {
    locationObj.href = mailtoUrl;
  }
  return mailtoUrl;
}

/**
 * @param {string} text
 * @param {{ clipboard?: { writeText?: (value: string) => Promise<void> } | null, documentObj?: Document | null }} [options]
 * @returns {Promise<boolean>}
 */
export async function copyPlainText(text, options = {}) {
  const clipboard = options.clipboard ?? globalThis.navigator?.clipboard ?? null;
  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // Fall back to the best-effort DOM copy path below.
    }
  }

  return fallbackCopyPlainText(text, options.documentObj ?? globalThis.document ?? null);
}

/**
 * @param {string} text
 * @param {Document | null} documentObj
 * @returns {boolean}
 */
function fallbackCopyPlainText(text, documentObj) {
  if (!documentObj?.createElement || !documentObj.body?.appendChild || typeof documentObj.execCommand !== "function") {
    return false;
  }

  const textarea = /** @type {HTMLTextAreaElement} */ (documentObj.createElement("textarea"));
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";

  documentObj.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange?.(0, textarea.value.length);

  try {
    return !!documentObj.execCommand("copy");
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}
