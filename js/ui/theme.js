// @ts-check
// js/ui/theme.js
// Theme manager (system/light/dark + named themes) with a safe system listener.

import {
  ALLOWED_THEMES,
  syncResolvedThemeChoiceIntoState,
  syncThemeChoiceIntoState
} from "./themeState.js";

/** @typedef {import("../state.js").State} State */
/**
 * @typedef {typeof ALLOWED_THEMES[number]} ThemeChoice
 */
/**
 * @typedef {{
 *   state: State,
 *   redraw?: () => void
 * }} ThemeManagerDeps
 */
/**
 * @typedef {{
 *   applyTheme: (theme: string) => void,
 *   initFromState: () => void,
 *   startSystemThemeListener: () => void,
 *   stopSystemThemeListener: () => void
 * }} ThemeManagerApi
 */
/**
 * @typedef {MediaQueryList & {
 *   addListener?: (listener: (event: MediaQueryListEvent) => void) => void,
 *   removeListener?: (listener: (event: MediaQueryListEvent) => void) => void
 * }} LegacyThemeMediaQueryList
 */

/**
 * @param {ThemeManagerDeps} [deps]
 * @returns {ThemeManagerApi}
 */
export function createThemeManager(deps) {
  const { state, redraw } = deps || {};
  if (!state) throw new Error("createThemeManager: state is required");

  /** @type {LegacyThemeMediaQueryList | null} */
  let _systemThemeMql = null;
  /** @type {((event: MediaQueryListEvent) => void) | null} */
  let _systemThemeHandler = null;

  /**
   * @returns {"dark" | "light"}
   */
  function resolveSystemTheme() {
    const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    return prefersDark ? "dark" : "light";
  }

  /**
   * @returns {void}
   */
  function stopSystemThemeListener() {
    if (_systemThemeMql && _systemThemeHandler) {
      try {
        _systemThemeMql.removeEventListener("change", _systemThemeHandler);
      } catch (err) {
        try { _systemThemeMql.removeListener(_systemThemeHandler); } catch (_) { }
      }
    }
    _systemThemeMql = null;
    _systemThemeHandler = null;
  }

  /**
   * @returns {void}
   */
  function startSystemThemeListener() {
    stopSystemThemeListener();
    if (!window.matchMedia) return;

    _systemThemeMql = /** @type {LegacyThemeMediaQueryList} */ (window.matchMedia("(prefers-color-scheme: dark)"));
    _systemThemeHandler = () => {
      if ((state?.ui?.theme || "system") !== "system") return;
      document.documentElement.dataset.theme = resolveSystemTheme();
      try { redraw?.(); } catch (_) { }
    };

    try { _systemThemeMql.addEventListener("change", _systemThemeHandler); }
    catch (err) {
      try { _systemThemeMql.addListener(_systemThemeHandler); } catch (_) { }
    }
  }

  /**
   * @param {string} theme
   * @returns {void}
   */
  function applyTheme(theme) {
    const t = /** @type {ThemeChoice} */ (syncThemeChoiceIntoState(state, theme));

    const resolved = (t === "system") ? resolveSystemTheme() : t;
    document.documentElement.dataset.theme = resolved;

    if (t === "system") startSystemThemeListener();
    else stopSystemThemeListener();

    try { redraw?.(); } catch (_) { }
  }

  /**
   * @returns {void}
   */
  function initFromState() {
    applyTheme(syncResolvedThemeChoiceIntoState(state));
  }

  return { applyTheme, initFromState, startSystemThemeListener, stopSystemThemeListener };
}
