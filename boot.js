import { syncNativeAppClass } from "./js/utils/runtime.js";

// boot.js - module loaded before app.js so theme is set as early as possible.
try {
  const bootStartedAt =
    typeof performance !== "undefined" && typeof performance.now === "function"
      ? performance.now()
      : Date.now();
  window.__APP_BOOT_STARTED_AT__ = bootStartedAt;
  document.documentElement.dataset.appBoot = "loading";
  const isNativeAppRuntime = syncNativeAppClass({
    documentElement: document.documentElement,
    body: document.body ?? null
  });
  if (!document.body) {
    document.addEventListener(
      "DOMContentLoaded",
      () => {
        syncNativeAppClass({
          documentElement: document.documentElement,
          body: document.body ?? null,
          enabled: isNativeAppRuntime
        });
      },
      { once: true }
    );
  }

  // Expose app version/build metadata early so UI can display it (e.g., Settings -> About).
  const viteVersion =
    (typeof __APP_VERSION__ !== "undefined" && __APP_VERSION__)
      ? String(__APP_VERSION__)
      : "dev";
  const viteBuild =
    (typeof __APP_BUILD__ !== "undefined" && __APP_BUILD__)
      ? String(__APP_BUILD__)
      : "";

  window.__APP_VERSION__ = viteVersion;
  window.APP_VERSION = viteVersion;
  window.__APP_BUILD__ = viteBuild;
  window.APP_BUILD = viteBuild;

  const raw = localStorage.getItem("localCampaignTracker_v1");
  const data = raw ? JSON.parse(raw) : null;
  const theme = data?.appShell?.ui?.theme || data?.ui?.theme || "system";

  const prefersDark =
    window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  const resolved = theme === "system" ? (prefersDark ? "dark" : "light") : theme;

  document.documentElement.dataset.theme = resolved;
} catch (_) {
  // If storage is blocked or corrupted, just fall back to default CSS theme.
}
