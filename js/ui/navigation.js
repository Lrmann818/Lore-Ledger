// @ts-check
// js/ui/navigation.js — top-level page tabs/navigation
//
// Long-term goals:
// - Single source of truth for how pages switch
// - Zero hard-coded page list in app.js (add a new page by adding a tab button + a matching #page-<name> section)
// - Accessibility (ARIA + keyboard)
// - Deep linking (#tracker/#character/#map) + state persistence
import { requireMany, getNoopDestroyApi } from "../utils/domGuards.js";
import { createStateActions } from "../domain/stateActions.js";

/** @typedef {import("../state.js").State} State */
/**
 * @typedef {{
 *   state?: State,
 *   markDirty?: () => void,
 *   setStatus?: (message: string, opts?: { stickyMs?: number }) => void,
 *   activeTabStorageKey?: string,
 *   tabsRootSelector?: string,
 *   tabSelector?: string,
 *   pageIdPrefix?: string,
 *   defaultTab?: string,
 *   updateHash?: boolean,
 *   canActivateTab?: (tabName: string) => boolean,
 *   onHubEntry?: () => void
 * }} TopTabsNavigationDeps
 */
/**
 * @typedef {{ markDirty?: boolean }} ApplyActiveTabOptions
 */
/**
 * @typedef {{
 *   applyActiveTab: (tabName: string | null | undefined, opts?: ApplyActiveTabOptions) => void,
 *   getActiveTab: () => string,
 *   refresh: () => void,
 *   destroy: () => void
 * }} TopTabsNavigationApi
 */

/** @type {(() => void) | null} */
let activeTopTabsNavigationDestroy = null;
const NOOP_TOP_TABS_API = /** @type {TopTabsNavigationApi} */ (getNoopDestroyApi());

/**
 * Initialize the top page tabs.
 *
 * Expected markup:
 *   <nav class="tabs" role="tablist">
 *     <button class="tab" data-tab="tracker" role="tab">Tracker</button>
 *     ...
 *   </nav>
 * And pages:
 *   <section id="page-tracker">...</section>
 *   <section id="page-character">...</section>
 *
 * By default, tabs map to pages via: #page-${tabName}
 * @param {TopTabsNavigationDeps} [deps]
 * @returns {TopTabsNavigationApi}
 */
export function initTopTabsNavigation(deps = {}) {
  const {
    state,
    markDirty,
    setStatus,
    activeTabStorageKey = "localCampaignTracker_activeTab",
    tabsRootSelector = ".tabs",
    tabSelector = ".tab[data-tab]",
    pageIdPrefix = "page-",
    defaultTab = "hub",
    updateHash = true,
    canActivateTab = () => true,
    onHubEntry
  } = deps;

  if (typeof activeTopTabsNavigationDestroy === "function") {
    activeTopTabsNavigationDestroy();
  }

  const guard = requireMany(
    { tabsRoot: tabsRootSelector },
    { root: document, setStatus, context: "Top navigation" }
  );
  if (!guard.ok) return /** @type {TopTabsNavigationApi} */ (guard.destroy || getNoopDestroyApi());
  const tabsRoot = /** @type {HTMLElement} */ (guard.els.tabsRoot);

  /** @type {HTMLButtonElement[]} */
  const tabButtons = /** @type {HTMLButtonElement[]} */ (Array.from(tabsRoot.querySelectorAll(tabSelector)));
  if (!tabButtons.length) {
    setStatus?.("Top navigation unavailable (no tab buttons found).", { stickyMs: 5000 });
    return NOOP_TOP_TABS_API;
  }

  const ac = new AbortController();
  const { signal } = ac;
  let destroyed = false;
  let currentActiveTab = "";

  // Build the page registry from the DOM so adding pages is declarative.
  /** @type {Record<string, HTMLElement>} */
  const pages = Object.create(null);
  tabButtons.forEach((btn) => {
    const name = (btn.getAttribute("data-tab") || "").trim();
    if (!name) return;
    const el = document.getElementById(`${pageIdPrefix}${name}`);
    if (el) pages[name] = el;
  });
  if (defaultTab && !pages[defaultTab]) {
    const defaultPage = document.getElementById(`${pageIdPrefix}${defaultTab}`);
    if (defaultPage) pages[defaultTab] = defaultPage;
  }
  if (!Object.keys(pages).length) {
    const message = "Top navigation unavailable (no matching page sections found).";
    if (typeof setStatus === "function") setStatus(message, { stickyMs: 5000 });
    else console.warn(message);
    return NOOP_TOP_TABS_API;
  }

  const actions = state
    ? createStateActions({
      state,
      SaveManager: (typeof markDirty === "function") ? { markDirty } : undefined
    })
    : null;

  /**
   * @param {string} tabName
   * @returns {boolean}
   */
  function isTabEnabled(tabName) {
    return !!pages[tabName] && !!canActivateTab(tabName);
  }

  /**
   * @returns {string}
   */
  function getFirstEnabledTab() {
    return Object.keys(pages).find((name) => isTabEnabled(name)) || "";
  }

  /**
   * @param {string | null | undefined} tabName
   */
  function normalizeTabName(tabName) {
    const t = (tabName || "").toString().replace(/^#/, "").trim();
    if (t && isTabEnabled(t)) return t;
    if (isTabEnabled(defaultTab)) return defaultTab;
    return getFirstEnabledTab();
  }

  function syncTabAvailability() {
    tabButtons.forEach((btn) => {
      const tabName = (btn.dataset.tab || btn.getAttribute("data-tab") || "").trim();
      const enabled = !!tabName && isTabEnabled(tabName);
      btn.disabled = !enabled;
      btn.setAttribute("aria-disabled", enabled ? "false" : "true");
      btn.classList.toggle("disabled", !enabled);
    });
  }

  /**
   * @param {string} tabName
   */
  function setHash(tabName) {
    if (!updateHash) return;
    try {
      const hash = `#${tabName}`;
      if (location.hash !== hash) history.replaceState(null, "", hash);
    } catch (_) {
      // ignore (some environments block history)
    }
  }

  /**
   * @param {string} tabName
   */
  function persistActiveTab(tabName) {
    try {
      if (!activeTabStorageKey) return;
      localStorage.setItem(activeTabStorageKey, tabName);
    } catch (_) {
      // ignore
    }
  }

  /**
   * @param {string | null | undefined} tabName
   * @param {ApplyActiveTabOptions} [opts]
   */
  function applyActiveTab(tabName, { markDirty: doMarkDirty = false } = {}) {
    syncTabAvailability();
    const active = normalizeTabName(tabName);

    tabButtons.forEach((btn) => {
      const isActive = !!active && btn.getAttribute("data-tab") === active;
      btn.classList.toggle("active", isActive);
      btn.setAttribute("aria-selected", isActive ? "true" : "false");
      btn.setAttribute("tabindex", isActive ? "0" : "-1");
    });

    Object.entries(pages).forEach(([name, el]) => {
      if (!el) return;
      const isActive = !!active && name === active;
      el.classList.toggle("active", isActive);
      // Keep DOM accessible; CSS uses .active, but hidden helps SR + tab order
      el.toggleAttribute("hidden", !isActive);
    });

    if (!active) return;

    const previousActiveTab = currentActiveTab;
    const activeChanged = active !== previousActiveTab;
    currentActiveTab = active;

    if (actions) {
      actions.setPath(["ui", "activeTab"], active, { queueSave: false });
    }

    // Persist UI preference without marking campaign data as "dirty"
    persistActiveTab(active);

    setHash(active);
    if (activeChanged && active === "hub" && typeof onHubEntry === "function") {
      onHubEntry();
    }
    if (doMarkDirty && typeof markDirty === "function") markDirty();
  }

  // Click to switch
  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      applyActiveTab(btn.dataset.tab || btn.getAttribute("data-tab"));
    }, { signal });
  });

  // Keyboard: left/right arrows to move between tabs
  tabsRoot.addEventListener(
    "keydown",
    (e) => {
      const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
      if (!keys.includes(e.key)) return;
      const idx = tabButtons.findIndex((b) => b.classList.contains("active"));
      if (idx < 0) return;

      e.preventDefault();
      let next = idx;
      if (e.key === "ArrowLeft") next = (idx - 1 + tabButtons.length) % tabButtons.length;
      if (e.key === "ArrowRight") next = (idx + 1) % tabButtons.length;
      if (e.key === "Home") next = 0;
      if (e.key === "End") next = tabButtons.length - 1;
      const nextTab = tabButtons[next];
      if (!nextTab) return;
      if (nextTab.disabled) return;
      nextTab.focus();
      applyActiveTab(nextTab.dataset.tab || nextTab.getAttribute("data-tab"));
    },
    { signal }
  );

  // Initial: prefer hash (#tracker/#character/#map), else localStorage, else state, else default
  // NOTE: We intentionally persist active tab in localStorage without marking the campaign "dirty".
  // That means a refresh must be able to restore the last tab even if no save was triggered.
  const hash = (location.hash || "").replace("#", "").trim();
  let stored = "";
  try {
    stored = (activeTabStorageKey && localStorage.getItem(activeTabStorageKey)) || "";
  } catch (_) {
    stored = "";
  }

  const stateActiveTab = (typeof state?.ui?.activeTab === "string") ? state.ui.activeTab : "";
  const initial =
    (hash && pages[hash] ? hash : "") ||
    (stored && pages[stored] ? stored : "") ||
    (stateActiveTab && pages[stateActiveTab] ? stateActiveTab : "") ||
    defaultTab;

  applyActiveTab(initial, { markDirty: false });

  // Optional: respond to manual hash changes (back/forward, pasted URL)
  window.addEventListener(
    "hashchange",
    () => {
      const h = (location.hash || "").replace("#", "").trim();
      if (!h) return;
      if (!pages[h]) return;
      applyActiveTab(h, { markDirty: false });
    },
    { signal }
  );

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    ac.abort();
    if (activeTopTabsNavigationDestroy === destroy) {
      activeTopTabsNavigationDestroy = null;
    }
  };
  activeTopTabsNavigationDestroy = destroy;

  // Public API
  return {
    applyActiveTab,
    getActiveTab: () => {
      const fromState = (typeof state?.ui?.activeTab === "string") ? state.ui.activeTab : "";
      return normalizeTabName(fromState || location.hash);
    },
    refresh: () => {
      const current = (typeof state?.ui?.activeTab === "string") ? state.ui.activeTab : "";
      applyActiveTab(current || location.hash, { markDirty: false });
    },
    destroy
  };
}
