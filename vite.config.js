import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => {
  const base = mode === "production" ? "/CampaignTracker/" : "/";
  return {
    base,
    plugins: [
      VitePWA({
        registerType: "prompt",
        injectRegister: false,
        manifest: {
          name: "Campaign Tracker",
          short_name: "Tracker",
          start_url: ".",
          scope: ".",
          display: "standalone",
          theme_color: "#111111",
          background_color: "#111111",
          icons: [
            {
              src: "icons/icon-192-filled.png",
              sizes: "192x192",
              type: "image/png"
            },
            {
              src: "icons/icon-512-filled.png",
              sizes: "512x512",
              type: "image/png"
            }
          ]
        },
        includeAssets: [
          "favicon.ico",
          "apple-touch-icon.png",
          "icons/*",
          "icons/dice/*",
          "icons/favicon.ico",
          "icons/apple-touch-icon.png"
        ],
        workbox: {
          navigateFallback: `${base}index.html`,
          cleanupOutdatedCaches: true,
          runtimeCaching: [
            {
              urlPattern: /\.(?:png|jpg|jpeg|webp|svg)$/i,
              handler: "CacheFirst",
              options: {
                cacheName: "images-cache",
                expiration: {
                  maxEntries: 120,
                  maxAgeSeconds: 60 * 60 * 24 * 30
                }
              }
            }
          ]
        }
      })
    ],
    build: {
      outDir: "dist"
    }
  };
});
