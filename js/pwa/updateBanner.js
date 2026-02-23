let bannerEl = null;
let refreshBtnEl = null;
let dismissBtnEl = null;
let dismissed = false;

function ensureBanner() {
  if (bannerEl) return;

  bannerEl = document.createElement("div");
  bannerEl.className = "updateBanner";
  bannerEl.setAttribute("role", "status");
  bannerEl.setAttribute("aria-live", "polite");
  bannerEl.hidden = true;

  const textEl = document.createElement("span");
  textEl.textContent = "Update available";

  const actionsEl = document.createElement("div");
  actionsEl.className = "updateBanner__actions";

  refreshBtnEl = document.createElement("button");
  refreshBtnEl.type = "button";
  refreshBtnEl.className = "updateBanner__btn";
  refreshBtnEl.textContent = "Refresh";

  dismissBtnEl = document.createElement("button");
  dismissBtnEl.type = "button";
  dismissBtnEl.className = "updateBanner__btn";
  dismissBtnEl.textContent = "Later";

  actionsEl.append(refreshBtnEl, dismissBtnEl);
  bannerEl.append(textEl, actionsEl);
  document.body.appendChild(bannerEl);
}

export function showUpdateBanner({ onRefresh, onDismiss } = {}) {
  if (dismissed) return;

  ensureBanner();
  if (!bannerEl || !refreshBtnEl || !dismissBtnEl) return;

  refreshBtnEl.onclick = async () => {
    hideUpdateBanner();
    if (typeof onRefresh === "function") {
      await onRefresh();
    }
  };

  dismissBtnEl.onclick = () => {
    dismissed = true;
    hideUpdateBanner();
    if (typeof onDismiss === "function") {
      onDismiss();
    }
  };

  bannerEl.hidden = false;
  bannerEl.classList.remove("isHidden");
  bannerEl.style.display = "";
}

export function hideUpdateBanner() {
  if (!bannerEl) return;
  bannerEl.hidden = true;
  bannerEl.classList.add("isHidden");
  bannerEl.style.display = "none";
}
