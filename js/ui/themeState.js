// @ts-check
// js/ui/themeState.js
// Pure helpers for resolving and syncing the currently active theme choice.

const ALLOWED_THEMES = /** @type {const} */ ([
  "system", "dark", "light",
  "purple", "teal", "green", "blue", "red", "red-gold", "rose", "beige",
  "slate", "forest", "ember", "sepia", "arcane", "arcane-gold"
]);

/** @type {Set<string>} */
const ALLOWED_THEME_SET = new Set(ALLOWED_THEMES);

/**
 * @param {unknown} value
 * @returns {string}
 */
function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * @param {unknown} theme
 * @returns {theme is typeof ALLOWED_THEMES[number]}
 */
export function isAllowedThemeChoice(theme) {
  return ALLOWED_THEME_SET.has(cleanString(theme));
}

/**
 * @param {unknown} theme
 * @param {typeof ALLOWED_THEMES[number]} [fallback]
 * @returns {typeof ALLOWED_THEMES[number]}
 */
export function normalizeThemeChoice(theme, fallback = "system") {
  return isAllowedThemeChoice(theme)
    ? /** @type {typeof ALLOWED_THEMES[number]} */ (cleanString(theme))
    : fallback;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function normalizeActiveCampaignId(value) {
  const id = cleanString(value);
  return id || null;
}

/**
 * @param {unknown} vaultLike
 * @returns {number}
 */
function countStoredCampaigns(vaultLike) {
  if (!vaultLike || typeof vaultLike !== "object") return 0;
  const vault = /** @type {Record<string, unknown>} */ (vaultLike);
  const campaignDocs = vault.campaignDocs;
  if (campaignDocs && typeof campaignDocs === "object" && !Array.isArray(campaignDocs)) {
    return Object.keys(campaignDocs).length;
  }
  return 0;
}

/**
 * Resolve the theme that should be active for the current runtime state.
 * When a campaign is active, its campaign-scoped tracker theme wins.
 *
 * @param {unknown} stateLike
 * @returns {typeof ALLOWED_THEMES[number]}
 */
export function resolveThemeChoiceFromState(stateLike) {
  if (!stateLike || typeof stateLike !== "object") return "system";
  const state = /** @type {Record<string, unknown>} */ (stateLike);
  const activeCampaignId = normalizeActiveCampaignId(
    /** @type {{ activeCampaignId?: unknown } | undefined} */ (state.appShell)?.activeCampaignId
  );

  if (activeCampaignId) {
    const trackerTheme = /** @type {{ ui?: { theme?: unknown } } | undefined} */ (state.tracker)?.ui?.theme;
    if (isAllowedThemeChoice(trackerTheme)) {
      return normalizeThemeChoice(trackerTheme);
    }
  }

  return normalizeThemeChoice(/** @type {{ theme?: unknown } | undefined} */ (state.ui)?.theme);
}

/**
 * Resolve the theme that should be active from persisted vault/localStorage data.
 * Active campaigns use their own stored tracker theme when present. Older multi-campaign
 * saves without a campaign-scoped theme fall back to the default system theme instead of
 * inheriting another campaign's theme.
 *
 * Single-campaign legacy saves may still fall back to the app-shell/root theme so older
 * pre-vault data keeps its single saved theme on first boot.
 *
 * @param {unknown} storedData
 * @returns {typeof ALLOWED_THEMES[number]}
 */
export function resolveThemeChoiceFromStoredData(storedData) {
  if (!storedData || typeof storedData !== "object") return "system";
  const data = /** @type {Record<string, unknown>} */ (storedData);
  const activeCampaignId = normalizeActiveCampaignId(
    /** @type {{ activeCampaignId?: unknown, ui?: { theme?: unknown } } | undefined} */ (data.appShell)?.activeCampaignId
  );
  const appShellTheme = /** @type {{ ui?: { theme?: unknown } } | undefined} */ (data.appShell)?.ui?.theme;
  const legacyRootTheme = /** @type {{ theme?: unknown } | undefined} */ (data.ui)?.theme;

  if (!activeCampaignId) {
    return normalizeThemeChoice(appShellTheme ?? legacyRootTheme);
  }

  const campaignTheme =
    /** @type {{
     *   [key: string]: { tracker?: { ui?: { theme?: unknown } } } | undefined
     * } | undefined } */ (data.campaignDocs)?.[activeCampaignId]?.tracker?.ui?.theme;

  if (isAllowedThemeChoice(campaignTheme)) {
    return normalizeThemeChoice(campaignTheme);
  }

  return countStoredCampaigns(data) <= 1
    ? normalizeThemeChoice(appShellTheme ?? legacyRootTheme)
    : "system";
}

/**
 * Mirror the resolved theme into the runtime root UI bucket and the active campaign's
 * tracker UI bucket so the Settings UI, persistence, and DOM application all agree.
 *
 * @param {Record<string, unknown>} state
 * @param {unknown} theme
 * @returns {typeof ALLOWED_THEMES[number]}
 */
export function syncThemeChoiceIntoState(state, theme) {
  const nextTheme = normalizeThemeChoice(theme);

  if (!state.ui || typeof state.ui !== "object" || Array.isArray(state.ui)) {
    state.ui = {
      theme: "system",
      textareaHeights: {},
      panelCollapsed: {}
    };
  }
  const rootUi = /** @type {Record<string, unknown>} */ (state.ui);
  if (!rootUi.textareaHeights || typeof rootUi.textareaHeights !== "object" || Array.isArray(rootUi.textareaHeights)) {
    rootUi.textareaHeights = {};
  }
  if (!rootUi.panelCollapsed || typeof rootUi.panelCollapsed !== "object" || Array.isArray(rootUi.panelCollapsed)) {
    rootUi.panelCollapsed = {};
  }
  rootUi.theme = nextTheme;

  const activeCampaignId = normalizeActiveCampaignId(
    /** @type {{ activeCampaignId?: unknown } | undefined } */ (state.appShell)?.activeCampaignId
  );
  if (!activeCampaignId) return nextTheme;

  if (!state.tracker || typeof state.tracker !== "object" || Array.isArray(state.tracker)) {
    state.tracker = {};
  }
  const tracker = /** @type {Record<string, unknown>} */ (state.tracker);
  if (!tracker.ui || typeof tracker.ui !== "object" || Array.isArray(tracker.ui)) {
    tracker.ui = { textareaHeights: {} };
  }
  const trackerUi = /** @type {Record<string, unknown>} */ (tracker.ui);
  if (!trackerUi.textareaHeights || typeof trackerUi.textareaHeights !== "object" || Array.isArray(trackerUi.textareaHeights)) {
    trackerUi.textareaHeights = {};
  }
  trackerUi.theme = nextTheme;

  return nextTheme;
}

/**
 * Resolve the currently stored theme and mirror it into both runtime theme buckets.
 *
 * @param {Record<string, unknown>} state
 * @returns {typeof ALLOWED_THEMES[number]}
 */
export function syncResolvedThemeChoiceIntoState(state) {
  return syncThemeChoiceIntoState(state, resolveThemeChoiceFromState(state));
}

export { ALLOWED_THEMES };
