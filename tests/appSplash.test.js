import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createAppSplashController,
  shouldUseManagedAppSplashHold
} from "../js/ui/appSplash.js";

class FakeSplashElement extends EventTarget {
  constructor() {
    super();
    this.dataset = {};
    this.hidden = false;
  }

  hasAttribute(name) {
    return name === "hidden" ? this.hidden : false;
  }

  toggleAttribute(name, force) {
    if (name === "hidden") {
      this.hidden = typeof force === "boolean" ? force : !this.hidden;
    }
    return this.hidden;
  }
}

function createRuntime(options = {}) {
  let now = options.startTimeMs ?? 0;
  const splashEl = new FakeSplashElement();
  const documentElement = { dataset: {} };
  const body = { dataset: {} };
  const controller = createAppSplashController({
    splashEl,
    documentElement,
    body,
    minDurationMs: options.minDurationMs ?? 1000,
    hideTransitionMs: options.hideTransitionMs ?? 0,
    startTimeMs: options.startTimeMs ?? 0,
    now: () => now,
    setTimeoutFn: setTimeout,
    clearTimeoutFn: clearTimeout,
    requestAnimationFrameFn: (cb) => {
      cb(now);
      return 1;
    }
  });

  return {
    splashEl,
    documentElement,
    body,
    controller,
    async advance(ms) {
      now += ms;
      await vi.advanceTimersByTimeAsync(ms);
    }
  };
}

describe("appSplash", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses the managed hold in Capacitor-style runtimes", () => {
    expect(shouldUseManagedAppSplashHold({
      locationObj: { protocol: "capacitor:" }
    })).toBe(true);

    expect(shouldUseManagedAppSplashHold({
      locationObj: { protocol: "https:" },
      capacitorObj: { isNativePlatform: () => true }
    })).toBe(true);

    expect(shouldUseManagedAppSplashHold({
      locationObj: { protocol: "https:" },
      capacitorObj: { isNativePlatform: () => false }
    })).toBe(false);
  });

  it("keeps the earliest source markup on the warm splash background before app CSS finishes loading", () => {
    const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");

    expect(html).toContain('<html lang="en" data-app-boot="loading" data-shell-mode="hub">');
    expect(html).toContain('<body data-app-boot="loading" data-shell-mode="hub">');
    expect(html).toContain("background: #090705;");
    expect(html).toContain("background: #090807;");
    expect(html).toContain('id="appSplash"');
  });

  it("stays visible until the minimum duration elapses even when the app is ready early", async () => {
    const runtime = createRuntime({ minDurationMs: 1000 });
    const hiddenPromise = runtime.controller.markAppReady();

    expect(runtime.controller.isVisible()).toBe(true);
    expect(runtime.documentElement.dataset.appBoot).toBe("loading");

    await runtime.advance(999);
    expect(runtime.controller.isVisible()).toBe(true);
    expect(runtime.splashEl.hidden).toBe(false);

    await runtime.advance(1);
    await hiddenPromise;

    expect(runtime.controller.isVisible()).toBe(false);
    expect(runtime.splashEl.hidden).toBe(true);
    expect(runtime.documentElement.dataset.appBoot).toBe("ready");
    expect(runtime.body.dataset.appBoot).toBe("ready");
  });

  it("waits for app readiness even after the minimum duration has already elapsed", async () => {
    const runtime = createRuntime({ minDurationMs: 1000 });

    await runtime.advance(1000);
    expect(runtime.controller.isVisible()).toBe(true);
    expect(runtime.splashEl.hidden).toBe(false);

    await runtime.controller.markAppReady();

    expect(runtime.controller.isVisible()).toBe(false);
    expect(runtime.splashEl.hidden).toBe(true);
    expect(runtime.documentElement.dataset.appBoot).toBe("ready");
  });

  it("does not add extra delay once readiness finishes after the minimum", async () => {
    const runtime = createRuntime({ minDurationMs: 1000 });

    await runtime.advance(1800);
    expect(runtime.controller.isVisible()).toBe(true);

    const hiddenPromise = runtime.controller.markAppReady();
    await hiddenPromise;

    expect(runtime.controller.isVisible()).toBe(false);
    expect(runtime.splashEl.hidden).toBe(true);
  });
});
