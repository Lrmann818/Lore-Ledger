// @ts-check

/** @typedef {{ panelId: string, source?: unknown }} PanelDataChangedDetail */
/** @typedef {(detail: PanelDataChangedDetail) => void} PanelDataChangedCallback */

/** @type {Map<string, Set<PanelDataChangedCallback>>} */
const panelDataSubscribers = new Map();

/**
 * Subscribe to runtime invalidation for a shared panel data source.
 *
 * This is intentionally only a notification bus. Canonical data still lives in
 * app state, and subscribers are expected to read fresh state when called.
 *
 * @param {string} panelId
 * @param {PanelDataChangedCallback} callback
 * @returns {() => void}
 */
export function subscribePanelDataChanged(panelId, callback) {
  const normalizedPanelId = String(panelId || "").trim();
  if (!normalizedPanelId || typeof callback !== "function") return () => {};

  let subscribers = panelDataSubscribers.get(normalizedPanelId);
  if (!subscribers) {
    subscribers = new Set();
    panelDataSubscribers.set(normalizedPanelId, subscribers);
  }

  subscribers.add(callback);

  return () => {
    const active = panelDataSubscribers.get(normalizedPanelId);
    if (!active) return;
    active.delete(callback);
    if (active.size === 0) panelDataSubscribers.delete(normalizedPanelId);
  };
}

/**
 * Notify mounted views that a shared panel's canonical data changed.
 *
 * @param {string} panelId
 * @param {{ source?: unknown }} [detail]
 * @returns {number}
 */
export function notifyPanelDataChanged(panelId, detail = {}) {
  const normalizedPanelId = String(panelId || "").trim();
  if (!normalizedPanelId) return 0;

  const subscribers = panelDataSubscribers.get(normalizedPanelId);
  if (!subscribers || subscribers.size === 0) return 0;

  const eventDetail = { panelId: normalizedPanelId, source: detail.source };
  const snapshot = Array.from(subscribers);
  for (const callback of snapshot) callback(eventDetail);
  return snapshot.length;
}

