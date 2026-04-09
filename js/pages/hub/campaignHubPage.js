// @ts-check
// js/pages/hub/campaignHubPage.js
// Campaign Hub page: create, open, rename, and delete campaigns.

import { getNoopDestroyApi, requireMany } from "../../utils/domGuards.js";

/** @typedef {import("../../state.js").State} State */
/** @typedef {import("../../storage/campaignVault.js").CampaignVault} CampaignVault */
/** @typedef {typeof import("../../ui/dialogs.js").uiPrompt} UiPromptFn */
/** @typedef {typeof import("../../ui/dialogs.js").uiAlert} UiAlertFn */
/** @typedef {{ current: CampaignVault | null }} VaultRuntime */
/**
 * @typedef {{
 *   state?: State,
 *   vaultRuntime?: VaultRuntime,
 *   uiPrompt?: UiPromptFn,
 *   uiAlert?: UiAlertFn,
 *   setStatus?: (message: string, opts?: { stickyMs?: number }) => void,
 *   createCampaign?: (name: string) => Promise<void>,
 *   openCampaign?: (campaignId: string) => Promise<void>,
 *   renameCampaign?: (campaignId: string, nextName: string) => Promise<void>,
 *   deleteCampaign?: (campaignId: string) => Promise<void>
 * }} CampaignHubPageDeps
 */
/** @typedef {{ destroy: () => void, render: () => void }} CampaignHubPageApi */

/** @type {CampaignHubPageApi | null} */
let activeCampaignHubPage = null;

/**
 * @param {CampaignHubPageDeps} [deps]
 * @returns {CampaignHubPageApi}
 */
export function initCampaignHubPage(deps = {}) {
  activeCampaignHubPage?.destroy?.();
  activeCampaignHubPage = null;

  const {
    state,
    vaultRuntime,
    uiPrompt,
    uiAlert,
    setStatus,
    createCampaign,
    openCampaign,
    renameCampaign,
    deleteCampaign
  } = deps;

  if (!state) throw new Error("initCampaignHubPage: state is required");
  if (!vaultRuntime) throw new Error("initCampaignHubPage: vaultRuntime is required");
  if (typeof createCampaign !== "function") throw new Error("initCampaignHubPage: createCampaign() is required");
  if (typeof openCampaign !== "function") throw new Error("initCampaignHubPage: openCampaign() is required");
  if (typeof renameCampaign !== "function") throw new Error("initCampaignHubPage: renameCampaign() is required");
  if (typeof deleteCampaign !== "function") throw new Error("initCampaignHubPage: deleteCampaign() is required");

  const guard = requireMany(
    {
      root: "#page-hub",
      createForm: "#hubCreateForm",
      createInput: "#hubCampaignNameInput",
      createBtn: "#hubCreateBtn",
      introCopy: "#hubIntroCopy",
      countLabel: "#hubCampaignCount",
      emptyState: "#hubEmptyState",
      list: "#hubCampaignList"
    },
    {
      root: document,
      setStatus,
      context: "Campaign Hub",
      stickyMs: 5000
    }
  );
  if (!guard.ok) {
    return /** @type {CampaignHubPageApi} */ (guard.destroy || getNoopDestroyApi());
  }

  const {
    root,
    createForm,
    createInput,
    createBtn,
    introCopy,
    countLabel,
    emptyState,
    list
  } = guard.els;

  const listenerController = new AbortController();
  const { signal } = listenerController;
  let busy = false;

  /**
   * @returns {Array<{
   *   id: string,
   *   name: string,
   *   updatedAt: string,
   *   lastOpenedAt: string | null,
   *   isActive: boolean
   * }>}
   */
  function getCampaigns() {
    const vault = vaultRuntime.current;
    const order = Array.isArray(vault?.campaignIndex?.order) ? vault.campaignIndex.order : [];
    const activeCampaignId = state.appShell?.activeCampaignId ?? null;
    return order
      .map((id) => {
        const entry = vault?.campaignIndex?.entries?.[id];
        if (!entry || !vault?.campaignDocs?.[id]) return null;
        return {
          id,
          name: String(entry.name || "My Campaign"),
          updatedAt: String(entry.updatedAt || ""),
          lastOpenedAt: typeof entry.lastOpenedAt === "string" ? entry.lastOpenedAt : null,
          isActive: id === activeCampaignId
        };
      })
      .filter(Boolean);
  }

  /**
   * @param {string | null | undefined} iso
   * @returns {string}
   */
  function formatTimestamp(iso) {
    if (!iso) return "Never opened";
    const value = new Date(iso);
    if (Number.isNaN(value.getTime())) return "Recently updated";
    return `Opened ${value.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
  }

  /**
   * @param {boolean} nextBusy
   * @returns {void}
   */
  function setBusy(nextBusy) {
    busy = nextBusy;
    root.toggleAttribute("data-busy", nextBusy);
    createInput.disabled = nextBusy;
    createBtn.disabled = nextBusy;
    list.querySelectorAll("button").forEach((btn) => {
      btn.disabled = nextBusy;
    });
  }

  function render() {
    const campaigns = getCampaigns();
    const campaignCount = campaigns.length;
    const activeCampaignId = state.appShell?.activeCampaignId ?? null;
    const hasCampaigns = campaignCount > 0;

    introCopy.textContent = hasCampaigns
      ? "Create a new campaign or open an existing one."
      : "Create your first campaign to begin tracking characters, places, sessions, and maps.";
    countLabel.textContent = hasCampaigns ? `${campaignCount} campaign${campaignCount === 1 ? "" : "s"}` : "No campaigns yet";
    emptyState.toggleAttribute("hidden", campaignCount !== 0);
    list.toggleAttribute("hidden", campaignCount === 0);
    list.textContent = "";

    campaigns.forEach((campaign) => {
      const item = document.createElement("li");
      item.className = "hubCampaignItem";
      item.dataset.campaignId = campaign.id;

      const card = document.createElement("article");
      card.className = "hubCampaignCard";
      if (campaign.isActive) card.classList.add("active");

      const summary = document.createElement("div");
      summary.className = "hubCampaignSummary";

      const titleRow = document.createElement("div");
      titleRow.className = "hubCampaignTitleRow";

      const title = document.createElement("h3");
      title.className = "hubCampaignTitle";
      title.textContent = campaign.name;

      titleRow.appendChild(title);

      if (campaign.isActive) {
        const badge = document.createElement("span");
        badge.className = "hubCampaignBadge";
        badge.textContent = "Current";
        titleRow.appendChild(badge);
      }

      const meta = document.createElement("p");
      meta.className = "hubCampaignMeta muted";
      meta.textContent = campaign.isActive
        ? "Open now"
        : formatTimestamp(campaign.lastOpenedAt || campaign.updatedAt);

      summary.append(titleRow, meta);

      const actions = document.createElement("div");
      actions.className = "hubCampaignActions";

      const openBtn = document.createElement("button");
      openBtn.type = "button";
      openBtn.className = "panelBtn panelBtnSm";
      openBtn.dataset.action = "open";
      openBtn.dataset.campaignId = campaign.id;
      openBtn.textContent = campaign.isActive ? "Open" : "Open";

      const renameBtn = document.createElement("button");
      renameBtn.type = "button";
      renameBtn.className = "panelBtn panelBtnSm";
      renameBtn.dataset.action = "rename";
      renameBtn.dataset.campaignId = campaign.id;
      renameBtn.textContent = "Rename";

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "panelBtn panelBtnSm danger";
      deleteBtn.dataset.action = "delete";
      deleteBtn.dataset.campaignId = campaign.id;
      deleteBtn.textContent = activeCampaignId === campaign.id ? "Delete Current" : "Delete";

      actions.append(openBtn, renameBtn, deleteBtn);
      card.append(summary, actions);
      item.appendChild(card);
      list.appendChild(item);
    });

    if (!busy) {
      createInput.placeholder = hasCampaigns ? "New campaign name" : "Name your first campaign";
    }
  }

  /**
   * @param {() => Promise<void>} task
   * @returns {Promise<void>}
   */
  async function runBusyTask(task) {
    if (busy) return;
    setBusy(true);
    try {
      await task();
    } finally {
      render();
      setBusy(false);
    }
  }

  createForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const requestedName = createInput.value.trim();
    void runBusyTask(async () => {
      await createCampaign(requestedName);
      createInput.value = "";
    });
  }, { signal });

  list.addEventListener("click", (event) => {
    const actionEl = /** @type {HTMLElement | null} */ ((event.target instanceof HTMLElement)
      ? event.target.closest("[data-action][data-campaign-id]")
      : null);
    if (!actionEl) return;

    const action = String(actionEl.dataset.action || "");
    const campaignId = String(actionEl.dataset.campaignId || "").trim();
    if (!campaignId) return;

    const campaign = getCampaigns().find((entry) => entry.id === campaignId);
    if (!campaign) return;

    if (action === "open") {
      void runBusyTask(async () => {
        await openCampaign(campaignId);
      });
      return;
    }

    if (action === "rename") {
      void runBusyTask(async () => {
        const nextName = await uiPrompt?.("Enter a new campaign name.", {
          title: "Rename Campaign",
          okText: "Save",
          cancelText: "Cancel",
          value: campaign.name,
          placeholder: "Campaign name"
        });
        if (nextName == null) return;
        await renameCampaign(campaignId, nextName);
      });
      return;
    }

    if (action === "delete") {
      void runBusyTask(async () => {
        const confirmation = await uiPrompt?.(
          `Type "${campaign.name}" to permanently delete this campaign.`,
          {
            title: "Delete Campaign",
            okText: "Delete",
            cancelText: "Cancel",
            value: "",
            placeholder: campaign.name
          }
        );
        if (confirmation == null) return;
        if (confirmation.trim() !== campaign.name) {
          await uiAlert?.("The campaign name did not match, so nothing was deleted.", {
            title: "Delete Cancelled",
            okText: "OK"
          });
          return;
        }
        await deleteCampaign(campaignId);
      });
    }
  }, { signal });

  render();

  const api = {
    destroy() {
      listenerController.abort();
      if (activeCampaignHubPage === api) activeCampaignHubPage = null;
    },
    render
  };

  activeCampaignHubPage = api;
  return api;
}
