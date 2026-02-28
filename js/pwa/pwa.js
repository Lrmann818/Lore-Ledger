import { initPwaUpdates } from "./updates.js";
import { hideUpdateBanner, showUpdateBanner } from "./updateBanner.js";

if (import.meta.env.PROD) {
  const { applyUpdate } = initPwaUpdates({
    onNeedRefresh() {
      showUpdateBanner({
        onRefresh: async () => {
          await applyUpdate();
        },
        onDismiss: () => {
          hideUpdateBanner();
        }
      });
    },
    onOfflineReady() {
      // Intentionally silent: avoid startup console noise in production.
      // console.log("PWA is ready to work offline.");
    }
  });
}
