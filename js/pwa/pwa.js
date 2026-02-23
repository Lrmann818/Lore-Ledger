import { registerSW } from "virtual:pwa-register";
import { hideUpdateBanner, showUpdateBanner } from "./updateBanner.js";

if (import.meta.env.PROD) {
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      showUpdateBanner({
        onRefresh: async () => {
          await updateSW(true);
        },
        onDismiss: () => {
          hideUpdateBanner();
        }
      });
    },
    onOfflineReady() {
      // Intentionally silent: avoid startup console noise in production.
    }
  });
}
