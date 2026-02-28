import { registerSW } from "virtual:pwa-register";

let registerPromise = null;
let updateServiceWorker = null;
const needRefreshHandlers = new Set();
const offlineReadyHandlers = new Set();

function notifyHandlers(handlers) {
  for (const handler of handlers) {
    try {
      handler?.();
    } catch (err) {
      console.error(err);
    }
  }
}

function ensureRegistration() {
  if (registerPromise) return registerPromise;

  registerPromise = Promise.resolve().then(() => {
    if (!import.meta.env.PROD) return null;
    updateServiceWorker = registerSW({
      immediate: true,
      onNeedRefresh() {
        notifyHandlers(needRefreshHandlers);
      },
      onOfflineReady() {
        notifyHandlers(offlineReadyHandlers);
      }
    });
    return updateServiceWorker;
  });

  return registerPromise;
}

export function initPwaUpdates({ onNeedRefresh, onOfflineReady } = {}) {
  if (typeof onNeedRefresh === "function") {
    needRefreshHandlers.add(onNeedRefresh);
  }
  if (typeof onOfflineReady === "function") {
    offlineReadyHandlers.add(onOfflineReady);
  }

  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return {
      checkForUpdates: async () => false,
      applyUpdate: async () => false
    };
  }

  ensureRegistration().catch((err) => {
    console.error(err);
  });

  return {
    checkForUpdates: async () => {
      await ensureRegistration();
      if (typeof updateServiceWorker !== "function") return false;
      await updateServiceWorker(false);
      return true;
    },
    applyUpdate: async () => {
      await ensureRegistration();
      if (typeof updateServiceWorker !== "function") return false;
      await updateServiceWorker(true);
      return true;
    }
  };
}
