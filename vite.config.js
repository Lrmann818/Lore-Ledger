import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(fileURLToPath(import.meta.url));
const pkgJson = JSON.parse(readFileSync(resolve(rootDir, "package.json"), "utf8"));

function runGit(args) {
  try {
    return execFileSync("git", args, {
      cwd: rootDir,
      stdio: ["ignore", "pipe", "ignore"]
    }).toString().trim();
  } catch {
    return "";
  }
}

function getGitShortSha() {
  return runGit(["rev-parse", "--short", "HEAD"]);
}

function parseTagVersion(tag) {
  const match = String(tag || "").trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3])
  };
}

function resolveAppVersion(pkgVersion) {
  const latestTag = runGit(["describe", "--tags", "--abbrev=0"]);
  const parsedTag = parseTagVersion(latestTag);
  if (!latestTag || !parsedTag) return pkgVersion;

  const commitsSinceTagRaw = runGit(["rev-list", `${latestTag}..HEAD`, "--count"]);
  const commitsSinceTag = Number.parseInt(commitsSinceTagRaw, 10);
  if (!Number.isFinite(commitsSinceTag) || commitsSinceTag < 0) return pkgVersion;

  const computedPatch = parsedTag.patch + commitsSinceTag;
  return `${parsedTag.major}.${parsedTag.minor}.${computedPatch}`;
}

export default defineConfig(({ mode }) => {
  const base = mode === "production" ? "/CampaignTracker/" : "/";
  const pkgVersion = String(pkgJson?.version || "0.0.0");
  const resolvedVersion = resolveAppVersion(pkgVersion);
  const appVersion = mode === "production" ? resolvedVersion : `${resolvedVersion}-dev`;
  const appBuild = getGitShortSha();

  return {
    base,
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
      __APP_BUILD__: JSON.stringify(appBuild)
    },
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
          navigateFallbackDenylist: [/./],
          cleanupOutdatedCaches: true,
          runtimeCaching: [
            {
              urlPattern: ({ request, url }) =>
                request.mode === "navigate" &&
                url.origin === self.location.origin,
              handler: "NetworkFirst",
              options: {
                cacheName: "pages-cache",
                networkTimeoutSeconds: 3,
                precacheFallback: {
                  fallbackURL: `${base}index.html`
                },
                expiration: {
                  maxEntries: 20,
                  maxAgeSeconds: 60 * 60 * 24
                }
              }
            },
            {
              urlPattern: ({ url, request }) =>
                url.origin === self.location.origin &&
                request.destination === "image",
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
