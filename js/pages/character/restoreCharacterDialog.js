// @ts-check
// js/pages/character/restoreCharacterDialog.js — Restore Character UI (R3).
//
// Presents the campaign's saved pre-Level-Up snapshots grouped by source
// character and restores a selected one as a separate playable character by
// calling the R2 engine (restoreCharacterFromSnapshot, injected as `restore`).
// ALL restoration logic — snapshot validation, migration, identity/naming,
// spell-row regeneration, note/portrait copying, rollback, retention — lives in
// the engine. This controller owns only:
//   - presentation (grouped, newest-first list; empty state),
//   - the non-destructive restore confirmation,
//   - an explicit persistence-confirmation lock ("Retry Save") after the engine
//     commits in memory but before SaveManager confirms the save durable, and
//   - one-time finalization (notify → rerender → success status via the
//     injected `finalizeRestore`).
//
// R3 is restore-only: it never deletes, prunes, or consumes a snapshot.
//
// Dialog phase model (spec §5 / owner authorization 2026-07-22):
//   idle → confirming → restoring → saving → pending-save → completed
// Closing (close button, Cancel, Escape, overlay click) and additional
// restores are permitted only in `idle`. Once the engine commits, the dialog
// locks open until SaveManager.flush() confirms the save; the engine is never
// re-invoked for a pending save — only flush is retried.

import { getNoopDestroyApi, requireMany } from "../../utils/domGuards.js";

const RESTORED_FALLBACK_NAME = "Unnamed Character";

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainRecord(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function finiteNumberOrNull(value) {
  if (value === "" || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function timeOf(value) {
  const rec = isPlainRecord(value) ? value : {};
  const t = Date.parse(cleanString(rec.createdAt));
  return Number.isFinite(t) ? t : 0;
}

/**
 * @typedef {{
 *   sourceCharacterId: string,
 *   sourceName: string,
 *   deleted: boolean,
 *   newestTime: number,
 *   snapshots: Array<Record<string, unknown>>
 * }} SnapshotDisplayGroup
 */

/**
 * Pure grouping/ordering for the Restore dialog (spec §7). Snapshots are
 * grouped by `sourceCharacterId`; groups are ordered by their newest snapshot
 * (newest first) and rows within a group by `createdAt` (newest first). A group
 * whose source character no longer exists in `entries` is flagged `deleted` but
 * is never hidden — its snapshots remain restorable. Records that are not plain
 * objects or lack an id / source id are skipped.
 *
 * @param {unknown} snapshots
 * @param {unknown} entries
 * @returns {SnapshotDisplayGroup[]}
 */
export function groupSnapshotsForDisplay(snapshots, entries) {
  const list = Array.isArray(snapshots) ? snapshots : [];
  const entryList = Array.isArray(entries) ? entries : [];
  /** @type {Set<string>} */
  const liveIds = new Set();
  for (const entry of entryList) {
    if (!isPlainRecord(entry)) continue;
    const id = cleanString(entry.id);
    if (id) liveIds.add(id);
  }

  /** @type {Map<string, SnapshotDisplayGroup>} */
  const groups = new Map();
  for (const raw of list) {
    if (!isPlainRecord(raw)) continue;
    const id = cleanString(raw.id);
    const sourceCharacterId = cleanString(raw.sourceCharacterId);
    if (!id || !sourceCharacterId) continue;
    let group = groups.get(sourceCharacterId);
    if (!group) {
      group = {
        sourceCharacterId,
        sourceName: "",
        deleted: !liveIds.has(sourceCharacterId),
        newestTime: 0,
        snapshots: []
      };
      groups.set(sourceCharacterId, group);
    }
    group.snapshots.push(raw);
  }

  for (const group of groups.values()) {
    group.snapshots.sort((a, b) =>
      timeOf(b) - timeOf(a) || cleanString(b.id).localeCompare(cleanString(a.id)));
    const named = group.snapshots.find((snapshot) => cleanString(snapshot.sourceName));
    group.sourceName = named ? cleanString(named.sourceName) : "";
    group.newestTime = group.snapshots.length ? timeOf(group.snapshots[0]) : 0;
  }

  const out = Array.from(groups.values());
  out.sort((a, b) =>
    b.newestTime - a.newestTime || a.sourceCharacterId.localeCompare(b.sourceCharacterId));
  return out;
}

/**
 * @param {Record<string, unknown>} snapshot
 * @returns {string}
 */
function snapshotName(snapshot) {
  const payload = isPlainRecord(snapshot.payload) ? snapshot.payload : {};
  return cleanString(snapshot.sourceName) || cleanString(payload.name) || RESTORED_FALLBACK_NAME;
}

/**
 * @param {Record<string, unknown>} snapshot
 * @returns {number | null}
 */
function snapshotFromLevel(snapshot) {
  const level = finiteNumberOrNull(snapshot.fromLevel);
  return level != null && level >= 1 ? Math.trunc(level) : null;
}

/**
 * @param {HTMLElement} panel
 * @returns {HTMLElement[]}
 */
function getFocusable(panel) {
  const selectors = [
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "a[href]",
    "[tabindex]:not([tabindex='-1'])"
  ];
  return /** @type {HTMLElement[]} */ (Array.from(panel.querySelectorAll(selectors.join(",")))
    .filter((node) => !!node &&
      typeof /** @type {HTMLElement} */ (node).focus === "function" &&
      !(/** @type {HTMLElement} */ (node).hidden) &&
      !(/** @type {HTMLElement} */ (node).closest("[hidden]"))));
}

/**
 * @param {HTMLElement} parent
 * @param {string} tag
 * @param {string} className
 * @param {string} [text]
 * @returns {HTMLElement}
 */
function el(parent, tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  parent.appendChild(node);
  return /** @type {HTMLElement} */ (node);
}

/** @param {HTMLElement} node */
function clearChildren(node) {
  if (typeof node.replaceChildren === "function") node.replaceChildren();
  else node.innerHTML = "";
}

/**
 * @typedef {{
 *   root?: ParentNode,
 *   state: import("../../state.js").State,
 *   restore: (options: { snapshotId: string, activate: boolean }) => Promise<{ characterId: string, name: string }>,
 *   flushSave: () => Promise<boolean>,
 *   finalizeRestore: (payload: { previousId: string | null, characterId: string, name: string }) => void,
 *   uiConfirm?: (message: string, options?: Record<string, unknown>) => Promise<boolean>,
 *   uiAlert?: (message: string, options?: Record<string, unknown>) => Promise<unknown>,
 *   setStatus?: (message: string, options?: Record<string, unknown>) => void,
 *   formatTimestamp?: (iso: string) => string
 * }} RestoreCharacterDialogDeps
 */

/**
 * @param {RestoreCharacterDialogDeps} deps
 * @returns {{ open: () => void, close: () => void, destroy: () => void }}
 */
export function initRestoreCharacterDialog(deps) {
  const {
    root = document,
    state,
    restore,
    flushSave,
    finalizeRestore,
    uiConfirm,
    uiAlert,
    setStatus,
    formatTimestamp = defaultFormatTimestamp
  } = deps || {};

  if (!state) throw new Error("initRestoreCharacterDialog: state is required");
  if (typeof restore !== "function") throw new Error("initRestoreCharacterDialog: restore is required");
  if (typeof flushSave !== "function") throw new Error("initRestoreCharacterDialog: flushSave is required");
  if (typeof finalizeRestore !== "function") throw new Error("initRestoreCharacterDialog: finalizeRestore is required");

  const guard = requireMany(
    {
      overlay: "#restoreCharacterOverlay",
      panel: "#restoreCharacterPanel",
      title: "#restoreCharacterTitle",
      closeBtn: "#restoreCharacterClose",
      intro: "#restoreCharacterIntro",
      empty: "#restoreCharacterEmpty",
      list: "#restoreCharacterList",
      pending: "#restoreCharacterPending",
      pendingMsg: "#restoreCharacterPendingMsg",
      retryBtn: "#restoreCharacterRetrySave",
      cancelBtn: "#restoreCharacterCancel"
    },
    { root, setStatus, context: "Restore Character dialog", devAssert: false, warn: false }
  );
  if (!guard.ok) {
    const noop = getNoopDestroyApi();
    return { open() {}, close() {}, destroy: noop.destroy };
  }

  const overlay = /** @type {HTMLElement} */ (guard.els.overlay);
  const panel = /** @type {HTMLElement} */ (guard.els.panel);
  const closeBtn = /** @type {HTMLButtonElement} */ (guard.els.closeBtn);
  const introEl = /** @type {HTMLElement} */ (guard.els.intro);
  const emptyEl = /** @type {HTMLElement} */ (guard.els.empty);
  const listEl = /** @type {HTMLElement} */ (guard.els.list);
  const pendingEl = /** @type {HTMLElement} */ (guard.els.pending);
  const pendingMsgEl = /** @type {HTMLElement} */ (guard.els.pendingMsg);
  const retryBtn = /** @type {HTMLButtonElement} */ (guard.els.retryBtn);
  const cancelBtn = /** @type {HTMLButtonElement} */ (guard.els.cancelBtn);

  const listenerController = new AbortController();
  const signal = listenerController.signal;

  /** @type {"idle" | "confirming" | "restoring" | "saving" | "pending-save" | "completed"} */
  let phase = "idle";
  let committed = false;
  let finalized = false;
  /** @type {{ previousId: string | null, characterId: string, name: string } | null} */
  let pendingRestore = null;
  let openCampaignId = "";
  /** @type {Element | null} */
  let previousFocus = null;
  /** @type {HTMLButtonElement[]} */
  let rowButtons = [];

  /* --------------------------- state reads ---------------------------- */

  const getSnapshots = () => (Array.isArray(state.characters?.snapshots) ? state.characters.snapshots : []);
  const getEntries = () => (Array.isArray(state.characters?.entries) ? state.characters.entries : []);
  const getActiveCampaignId = () => cleanString(state.appShell?.activeCampaignId);
  const getActiveCharacterId = () => (typeof state.characters?.activeId === "string" ? state.characters.activeId : null);

  /**
   * @param {string} snapshotId
   * @returns {Record<string, unknown> | null}
   */
  function getSnapshotById(snapshotId) {
    const id = cleanString(snapshotId);
    if (!id) return null;
    const found = getSnapshots().find((record) => isPlainRecord(record) && cleanString(record.id) === id);
    return found ? /** @type {Record<string, unknown>} */ (found) : null;
  }

  /* ---------------------------- rendering ----------------------------- */

  function renderList() {
    clearChildren(listEl);
    const groups = groupSnapshotsForDisplay(getSnapshots(), getEntries());
    const hasSnapshots = groups.length > 0;
    emptyEl.hidden = hasSnapshots;
    introEl.hidden = !hasSnapshots;
    listEl.hidden = !hasSnapshots;
    if (!hasSnapshots) return;

    for (const group of groups) {
      const section = el(listEl, "section", "restoreCharacterGroup");
      const head = el(section, "div", "restoreCharacterGroupHead");
      const displayName = group.sourceName || RESTORED_FALLBACK_NAME;
      el(head, "h3", "restoreCharacterGroupName", displayName);
      if (group.deleted) {
        el(head, "span", "restoreCharacterGroupDeleted", "(character deleted)");
      }

      const rows = el(section, "ul", "restoreCharacterRows");
      for (const snapshot of group.snapshots) {
        const snapshotId = cleanString(snapshot.id);
        const fromLevel = snapshotFromLevel(snapshot);
        const levelText = fromLevel != null ? String(fromLevel) : "?";
        const classSummary = cleanString(snapshot.classSummary);
        const toLevel = finiteNumberOrNull(snapshot.toLevel);
        const dateText = formatTimestamp(cleanString(snapshot.createdAt));

        const row = el(rows, "li", "restoreCharacterRow");
        const info = el(row, "div", "restoreCharacterRowInfo");
        el(info, "div", "restoreCharacterRowPrimary",
          classSummary ? `Level ${levelText} — ${classSummary}` : `Level ${levelText}`);
        const secondary = el(info, "div", "restoreCharacterRowSecondary");
        if (dateText) el(secondary, "span", "restoreCharacterRowDate", dateText);
        if (toLevel != null) {
          el(secondary, "span", "restoreCharacterRowTransition", `Before Level Up to ${toLevel}`);
        }

        const button = /** @type {HTMLButtonElement} */ (
          el(row, "button", "npcSmallBtn restoreCharacterRestoreBtn", "Restore"));
        button.type = "button";
        button.dataset.snapshotId = snapshotId;
        const labelDate = dateText ? `, ${dateText}` : "";
        button.setAttribute("aria-label", `Restore ${displayName}, level ${levelText}${labelDate}`);
        rowButtons.push(button);
      }
    }
  }

  const rebuildList = () => {
    rowButtons = [];
    renderList();
    syncControls();
  };

  /** Reflects the current phase onto the interactive controls. */
  function syncControls() {
    const canRestore = phase === "idle";
    for (const button of rowButtons) {
      if (button.isConnected) button.disabled = !canRestore;
    }
    retryBtn.hidden = phase !== "pending-save";
    retryBtn.disabled = phase !== "pending-save";
    const canClose = phase === "idle";
    closeBtn.disabled = !canClose;
    cancelBtn.disabled = !canClose;
  }

  function showPending() {
    pendingEl.hidden = false;
    const name = pendingRestore?.name ? `"${pendingRestore.name}"` : "The restored character";
    pendingMsgEl.textContent =
      `${name} was created in this session but has not been confirmed saved yet. ` +
      "Choose Retry Save to finish. Your existing characters and snapshots are unchanged.";
    setStatus?.("Restore not yet saved — choose Retry Save.", { stickyMs: 4000 });
  }

  /* ------------------------------ flow -------------------------------- */

  /**
   * @param {unknown} err
   * @returns {string}
   */
  function restoreErrorMessage(err) {
    const message = err instanceof Error && err.message ? err.message : "";
    return message || "The character could not be restored. No changes were made.";
  }

  /** @param {string} snapshotId */
  async function onRestoreClicked(snapshotId) {
    if (phase !== "idle") return; // one click = one restore; ignore while busy or locked
    const id = cleanString(snapshotId);
    if (!id) return;

    // Resolve the snapshot fresh from live state — never a stale row object.
    const snapshot = getSnapshotById(id);
    if (!snapshot) {
      await uiAlert?.("That snapshot is no longer available.", { title: "Restore Character" });
      rebuildList();
      return;
    }

    phase = "confirming";
    syncControls();

    const name = snapshotName(snapshot);
    const fromLevel = snapshotFromLevel(snapshot);
    const levelText = fromLevel != null ? String(fromLevel) : "?";
    let confirmed = false;
    try {
      confirmed = !!(await uiConfirm?.(
        "A separate playable character will be created. Existing characters will not be changed. " +
        "The snapshot will remain available for future restores.",
        { title: `Restore "${name}" as it was at Level ${levelText}?`, okText: "Restore" }
      ));
    } catch {
      confirmed = false;
    }

    if (!confirmed) {
      // Cancel: no side effects whatsoever.
      phase = "idle";
      syncControls();
      return;
    }

    // Submission-time guards: never restore into a different campaign, and
    // re-resolve the snapshot in case state changed during confirmation.
    if (getActiveCampaignId() !== openCampaignId) {
      phase = "idle";
      openCampaignId = getActiveCampaignId();
      rebuildList();
      await uiAlert?.(
        "The active campaign changed, so this restore was not started. " +
        "Choose a snapshot from the current campaign to restore.",
        { title: "Restore Character" }
      );
      return;
    }
    if (!getSnapshotById(id)) {
      phase = "idle";
      rebuildList();
      await uiAlert?.("That snapshot is no longer available.", { title: "Restore Character" });
      return;
    }

    await runRestore(id);
  }

  /** @param {string} snapshotId */
  async function runRestore(snapshotId) {
    const previousId = getActiveCharacterId();
    phase = "restoring";
    syncControls();

    /** @type {{ characterId: string, name: string }} */
    let result;
    try {
      result = await restore({ snapshotId, activate: true });
    } catch (err) {
      // Pre-commit failure: the engine leaves existing characters and
      // snapshots unchanged. Re-enable a fresh attempt.
      phase = "idle";
      rebuildList();
      await uiAlert?.(restoreErrorMessage(err), { title: "Restore Character" });
      return;
    }

    // Committed in memory. From here the engine is NEVER called again for this
    // result; only SaveManager.flush() is retried.
    committed = true;
    pendingRestore = {
      previousId,
      characterId: cleanString(result?.characterId),
      name: cleanString(result?.name)
    };
    await confirmPersistence();
  }

  /** Confirms durable persistence via flush; used by the initial save and Retry Save. */
  async function confirmPersistence() {
    phase = "saving";
    syncControls();

    let saved = false;
    try {
      saved = await flushSave();
    } catch (err) {
      // flush() should not throw, but treat a throw as "not confirmed" and keep
      // the pending restore intact for a retry (never claim data loss).
      console.warn("Restore Character: SaveManager.flush() threw; treating as unconfirmed.", err);
      saved = false;
    }

    if (saved) {
      finalizeSuccess();
      return;
    }

    // A false result means "not confirmed" — a real storage error OR a save
    // already in progress. Keep the committed restore and lock the dialog.
    phase = "pending-save";
    showPending();
    syncControls();
    queueMicrotask(() => {
      try { retryBtn.focus({ preventScroll: true }); } catch { retryBtn.focus(); }
    });
  }

  async function onRetrySave() {
    if (phase !== "pending-save" || !committed || !pendingRestore) return;
    await confirmPersistence();
  }

  /** Idempotent success finalization (spec §7 / owner authorization). */
  function finalizeSuccess() {
    if (finalized) return;
    finalized = true;
    phase = "completed";
    const pending = pendingRestore;

    // 1. Close the dialog. No focus restore: the character page rerenders and
    //    the invoking menu button is replaced (do not focus a removed node).
    close({ restoreFocus: false });

    // 2-4. notify the active-character change once, rerender into the restored
    //      character, and announce success (all owned by the character page).
    try {
      finalizeRestore({
        previousId: pending?.previousId ?? null,
        characterId: pending?.characterId ?? "",
        name: pending?.name ?? ""
      });
    } catch (err) {
      console.error("Restore Character: finalize failed after a confirmed save.", err);
    }
  }

  /* --------------------------- open / close --------------------------- */

  function focusInitial() {
    const focusables = getFocusable(panel);
    const target = rowButtons.find((button) => button.isConnected && !button.disabled)
      || focusables[0]
      || panel;
    try { target.focus({ preventScroll: true }); } catch { target.focus?.(); }
  }

  function open() {
    if (!overlay.hidden) return; // already open — repeated menu actions are a no-op
    phase = "idle";
    committed = false;
    finalized = false;
    pendingRestore = null;
    openCampaignId = getActiveCampaignId();
    previousFocus = document.activeElement;
    pendingEl.hidden = true;
    rebuildList();
    overlay.hidden = false;
    overlay.setAttribute("aria-hidden", "false");
    queueMicrotask(focusInitial);
  }

  /** @param {{ restoreFocus?: boolean }} [options] */
  function close(options = {}) {
    const restoreFocus = options.restoreFocus !== false;
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");
    pendingEl.hidden = true;
    const target = restoreFocus && previousFocus &&
      typeof (/** @type {HTMLElement} */ (previousFocus).focus) === "function"
      ? /** @type {HTMLElement} */ (previousFocus)
      : null;
    previousFocus = null;
    phase = "idle";
    committed = false;
    pendingRestore = null;
    if (target) {
      queueMicrotask(() => {
        try { target.focus({ preventScroll: true }); } catch { target.focus(); }
      });
    }
  }

  /** Close only when nothing is committed/in-flight (spec §5 / §6). */
  function requestClose() {
    if (phase !== "idle") return;
    close({ restoreFocus: true });
  }

  /** @param {Event} event */
  function handleKeydown(event) {
    if (overlay.hidden) return;
    const e = /** @type {KeyboardEvent} */ (event);
    // Defer to a stacked confirm/alert dialog (uiConfirm/uiAlert) when open.
    const active = /** @type {HTMLElement | null} */ (document.activeElement);
    if (active?.closest?.("#uiDialogOverlay")) return;

    if (e.key === "Escape") {
      e.preventDefault();
      requestClose();
      return;
    }
    if (e.key !== "Tab") return;
    const focusables = getFocusable(panel);
    if (!focusables.length) {
      e.preventDefault();
      try { panel.focus({ preventScroll: true }); } catch { panel.focus?.(); }
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const activeEl = document.activeElement;
    if (e.shiftKey && (activeEl === first || activeEl === panel)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && activeEl === last) {
      e.preventDefault();
      first.focus();
    }
  }

  listEl.addEventListener("click", (event) => {
    const target = /** @type {HTMLElement | null} */ (event.target);
    const button = target?.closest?.("[data-snapshot-id]");
    if (!button) return;
    event.preventDefault();
    void onRestoreClicked(/** @type {HTMLElement} */ (button).dataset.snapshotId || "");
  }, { signal });

  retryBtn.addEventListener("click", (event) => {
    event.preventDefault();
    void onRetrySave();
  }, { signal });

  closeBtn.addEventListener("click", (event) => {
    event.preventDefault();
    requestClose();
  }, { signal });

  cancelBtn.addEventListener("click", (event) => {
    event.preventDefault();
    requestClose();
  }, { signal });

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) requestClose();
  }, { signal });

  document.addEventListener("keydown", handleKeydown, { signal });

  return {
    open,
    close: () => requestClose(),
    destroy() {
      listenerController.abort();
      // Never restore focus during teardown: destroy runs from a character-page
      // rerender whose DOM has been rebuilt.
      close({ restoreFocus: false });
    }
  };
}

/**
 * @param {string} iso
 * @returns {string}
 */
function defaultFormatTimestamp(iso) {
  const value = cleanString(iso);
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  try {
    return date.toLocaleString();
  } catch {
    return date.toISOString();
  }
}
