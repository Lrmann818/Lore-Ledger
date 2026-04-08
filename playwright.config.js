import { defineConfig, devices } from "@playwright/test";

const HOST = "127.0.0.1";
const PORT = 4173;
const BASE_PATH = "/";

export default defineConfig({
  testDir: "./tests/smoke",
  testMatch: /.*\.smoke\.js/,
  timeout: 30_000,
  expect: {
    timeout: 5_000
  },
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: `http://${HOST}:${PORT}${BASE_PATH}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  webServer: {
    command: `npm run dev -- --mode production --host ${HOST} --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: false,
    timeout: 30_000
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"]
      }
    }
  ]
});
