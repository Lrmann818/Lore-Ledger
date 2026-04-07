import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { registerSWMock } = vi.hoisted(() => ({
  registerSWMock: vi.fn()
}));

vi.mock("virtual:pwa-register", () => ({
  registerSW: registerSWMock
}));

function setBrowserGlobals() {
  Object.defineProperty(globalThis, "window", {
    value: {},
    configurable: true
  });
  Object.defineProperty(globalThis, "navigator", {
    value: { serviceWorker: {} },
    configurable: true
  });
}

describe("initPwaUpdates", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("PROD", true);
    setBrowserGlobals();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    registerSWMock.mockReset();
    delete globalThis.window;
    delete globalThis.navigator;
  });

  it("registers once and drives the manual update APIs through the service worker updater", async () => {
    const updateServiceWorker = vi.fn(async () => {});
    registerSWMock.mockReturnValue(updateServiceWorker);

    const onNeedRefresh = vi.fn();
    const onOfflineReady = vi.fn();
    const { initPwaUpdates } = await import("../js/pwa/updates.js");

    const api = initPwaUpdates({ onNeedRefresh, onOfflineReady });

    expect(registerSWMock).toHaveBeenCalledTimes(0);

    await expect(api.checkForUpdates()).resolves.toBe(true);
    await expect(api.applyUpdate()).resolves.toBe(true);

    expect(registerSWMock).toHaveBeenCalledTimes(1);
    expect(updateServiceWorker).toHaveBeenNthCalledWith(1, false);
    expect(updateServiceWorker).toHaveBeenNthCalledWith(2, true);

    const registerArgs = registerSWMock.mock.calls[0][0];
    registerArgs.onNeedRefresh();
    registerArgs.onOfflineReady();

    expect(onNeedRefresh).toHaveBeenCalledTimes(1);
    expect(onOfflineReady).toHaveBeenCalledTimes(1);
  });
});
