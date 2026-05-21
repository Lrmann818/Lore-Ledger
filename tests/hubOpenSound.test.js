import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createHubOpenSoundController,
  HUB_OPEN_SOUND_URL,
  playHubOpenSound,
  playHubOpenSoundForState,
  resetHubOpenSoundForTests
} from "../js/audio/hubOpenSound.js";

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("hubOpenSound", () => {
  afterEach(() => {
    resetHubOpenSoundForTests();
    vi.unstubAllGlobals();
  });

  it("lazy-creates one preloaded Audio instance and restarts it from the beginning", async () => {
    const instances = [];
    class FakeAudio {
      constructor(src) {
        this.src = src;
        this.preload = "";
        this.currentTime = 12;
        this.load = vi.fn();
        this.pause = vi.fn();
        this.play = vi.fn(async () => {});
        instances.push(this);
      }
    }
    vi.stubGlobal("Audio", FakeAudio);

    await expect(playHubOpenSound()).resolves.toBe(true);
    await expect(playHubOpenSound()).resolves.toBe(true);

    expect(instances).toHaveLength(1);
    expect(instances[0].src).toBe(HUB_OPEN_SOUND_URL);
    expect(instances[0].preload).toBe("auto");
    expect(instances[0].load).toHaveBeenCalledTimes(1);
    expect(instances[0].pause).toHaveBeenCalledTimes(2);
    expect(instances[0].play).toHaveBeenCalledTimes(2);
    expect(instances[0].currentTime).toBe(0);
  });

  it("gates playback by the app preference", async () => {
    const play = vi.fn(async () => {});
    class FakeAudio {
      constructor() {
        this.preload = "";
        this.currentTime = 0;
        this.play = play;
      }
    }
    vi.stubGlobal("Audio", FakeAudio);

    await expect(playHubOpenSoundForState({
      app: { preferences: { playHubOpenSound: false } }
    })).resolves.toBe(false);
    expect(play).not.toHaveBeenCalled();

    await expect(playHubOpenSoundForState({
      app: { preferences: { playHubOpenSound: true } }
    })).resolves.toBe(true);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("returns false for playback failures such as autoplay blocking", async () => {
    class FakeAudio {
      constructor() {
        this.preload = "";
        this.currentTime = 4;
        this.play = vi.fn(() => Promise.reject(new DOMException("blocked", "NotAllowedError")));
      }
    }
    vi.stubGlobal("Audio", FakeAudio);

    await expect(playHubOpenSound()).resolves.toBe(false);
  });

  it("requests the startup sound once even when the restored page is not Hub", async () => {
    const play = vi.fn(async () => {});
    class FakeAudio {
      constructor() {
        this.preload = "";
        this.currentTime = 0;
        this.play = play;
      }
    }
    vi.stubGlobal("Audio", FakeAudio);

    const controller = createHubOpenSoundController({
      getState: () => ({ app: { preferences: { playHubOpenSound: true } } }),
      isHubVisible: () => false,
      documentTarget: new EventTarget(),
      windowTarget: new EventTarget()
    });

    await expect(controller.requestLaunchSound()).resolves.toBe(true);
    await expect(controller.requestLaunchSound()).resolves.toBe(false);

    expect(play).toHaveBeenCalledTimes(1);
    expect(controller.hasPendingRequest()).toBe(false);
    controller.destroy();
  });

  it("does not replay startup sound on focus, visibility, or pageshow after it is satisfied", async () => {
    const play = vi.fn(async () => {});
    class FakeAudio {
      constructor() {
        this.preload = "";
        this.currentTime = 0;
        this.play = play;
      }
    }
    vi.stubGlobal("Audio", FakeAudio);

    const documentTarget = new EventTarget();
    const windowTarget = new EventTarget();
    const controller = createHubOpenSoundController({
      getState: () => ({ app: { preferences: { playHubOpenSound: true } } }),
      isHubVisible: () => false,
      documentTarget,
      windowTarget
    });

    await expect(controller.requestLaunchSound()).resolves.toBe(true);

    windowTarget.dispatchEvent(new Event("focus"));
    windowTarget.dispatchEvent(new Event("pageshow"));
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    await flushMicrotasks();

    expect(play).toHaveBeenCalledTimes(1);
    expect(controller.hasPendingRequest()).toBe(false);
    controller.destroy();
  });

  it("marks a blocked startup sound as pending and retries after activation", async () => {
    const play = vi.fn(() => Promise.reject(new DOMException("blocked", "NotAllowedError")));
    class FakeAudio {
      constructor() {
        this.preload = "";
        this.currentTime = 0;
        this.play = play;
      }
    }
    vi.stubGlobal("Audio", FakeAudio);

    const controller = createHubOpenSoundController({
      getState: () => ({ app: { preferences: { playHubOpenSound: true } } }),
      isHubVisible: () => true,
      documentTarget: new EventTarget(),
      windowTarget: new EventTarget()
    });

    await expect(controller.requestLaunchSound()).resolves.toBe(false);

    expect(play).toHaveBeenCalledTimes(1);
    expect(controller.hasPendingRequest()).toBe(true);
    expect(controller.hasPendingLaunchRequest()).toBe(true);
    controller.destroy();
  });

  it("retries a pending startup sound after a reactivation event", async () => {
    const play = vi
      .fn()
      .mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError"))
      .mockResolvedValueOnce(undefined);
    class FakeAudio {
      constructor() {
        this.preload = "";
        this.currentTime = 0;
        this.play = play;
      }
    }
    vi.stubGlobal("Audio", FakeAudio);

    const documentTarget = new EventTarget();
    const controller = createHubOpenSoundController({
      getState: () => ({ app: { preferences: { playHubOpenSound: true } } }),
      isHubVisible: () => true,
      documentTarget,
      windowTarget: new EventTarget()
    });

    await expect(controller.requestLaunchSound()).resolves.toBe(false);
    expect(controller.hasPendingRequest()).toBe(true);
    expect(controller.hasPendingLaunchRequest()).toBe(true);

    documentTarget.dispatchEvent(new Event("pointerdown"));
    await flushMicrotasks();

    expect(play).toHaveBeenCalledTimes(2);
    expect(controller.hasPendingRequest()).toBe(false);
    expect(controller.hasPendingLaunchRequest()).toBe(false);
    controller.destroy();
  });

  it("plays when a Hub-entry request happens after another page was visible", async () => {
    const play = vi.fn(async () => {});
    class FakeAudio {
      constructor() {
        this.preload = "";
        this.currentTime = 0;
        this.play = play;
      }
    }
    vi.stubGlobal("Audio", FakeAudio);

    let hubVisible = false;
    const controller = createHubOpenSoundController({
      getState: () => ({ app: { preferences: { playHubOpenSound: true } } }),
      isHubVisible: () => hubVisible,
      documentTarget: new EventTarget(),
      windowTarget: new EventTarget()
    });

    await expect(controller.requestHubEntrySound()).resolves.toBe(false);
    expect(play).not.toHaveBeenCalled();

    hubVisible = true;
    await expect(controller.requestHubEntrySound()).resolves.toBe(true);

    expect(play).toHaveBeenCalledTimes(1);
    controller.destroy();
  });

  it("does not play just because the setting was enabled", async () => {
    const play = vi.fn(async () => {});
    class FakeAudio {
      constructor() {
        this.preload = "";
        this.currentTime = 0;
        this.play = play;
      }
    }
    vi.stubGlobal("Audio", FakeAudio);

    const state = { app: { preferences: { playHubOpenSound: false } } };
    const documentTarget = new EventTarget();
    const controller = createHubOpenSoundController({
      getState: () => state,
      isHubVisible: () => true,
      documentTarget,
      windowTarget: new EventTarget()
    });

    state.app.preferences.playHubOpenSound = true;
    documentTarget.dispatchEvent(new Event("pointerdown"));
    await flushMicrotasks();

    expect(play).not.toHaveBeenCalled();
    expect(controller.hasPendingRequest()).toBe(false);
    controller.destroy();
  });

  it("does not duplicate playback for the same pending request", async () => {
    /** @type {() => void} */
    let resolveSecondPlay = () => {};
    const secondPlay = new Promise((resolve) => {
      resolveSecondPlay = resolve;
    });
    const play = vi
      .fn()
      .mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError"))
      .mockImplementationOnce(() => secondPlay);
    class FakeAudio {
      constructor() {
        this.preload = "";
        this.currentTime = 0;
        this.play = play;
      }
    }
    vi.stubGlobal("Audio", FakeAudio);

    class CountingTarget extends EventTarget {
      constructor() {
        super();
        this.added = [];
        this.removed = [];
      }

      addEventListener(type, listener, options) {
        this.added.push(type);
        super.addEventListener(type, listener, options);
      }

      removeEventListener(type, listener, options) {
        this.removed.push(type);
        super.removeEventListener(type, listener, options);
      }
    }

    const documentTarget = new CountingTarget();
    const windowTarget = new CountingTarget();
    const controller = createHubOpenSoundController({
      getState: () => ({ app: { preferences: { playHubOpenSound: true } } }),
      isHubVisible: () => true,
      documentTarget,
      windowTarget
    });

    await expect(controller.requestLaunchSound()).resolves.toBe(false);
    await expect(controller.requestLaunchSound()).resolves.toBe(false);

    expect(documentTarget.added).toEqual(["pointerdown", "touchend", "keydown", "visibilitychange"]);
    expect(windowTarget.added).toEqual(["focus", "pageshow"]);

    documentTarget.dispatchEvent(new Event("pointerdown"));
    documentTarget.dispatchEvent(new Event("keydown"));
    windowTarget.dispatchEvent(new Event("focus"));

    expect(play).toHaveBeenCalledTimes(2);
    resolveSecondPlay();
    await flushMicrotasks();

    expect(controller.hasPendingRequest()).toBe(false);
    expect(documentTarget.removed).toEqual(["pointerdown", "touchend", "keydown", "visibilitychange"]);
    expect(windowTarget.removed).toEqual(["focus", "pageshow"]);
    windowTarget.dispatchEvent(new Event("pageshow"));
    documentTarget.dispatchEvent(new Event("visibilitychange"));
    await flushMicrotasks();

    expect(play).toHaveBeenCalledTimes(2);
    controller.destroy();
  });

  it("keeps a Hub-entry request distinct while a launch retry is in flight", async () => {
    /** @type {() => void} */
    let resolveLaunchRetry = () => {};
    const launchRetry = new Promise((resolve) => {
      resolveLaunchRetry = resolve;
    });
    const play = vi
      .fn()
      .mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError"))
      .mockImplementationOnce(() => launchRetry)
      .mockResolvedValueOnce(undefined);
    class FakeAudio {
      constructor() {
        this.preload = "";
        this.currentTime = 0;
        this.play = play;
      }
    }
    vi.stubGlobal("Audio", FakeAudio);

    let hubVisible = false;
    const documentTarget = new EventTarget();
    const controller = createHubOpenSoundController({
      getState: () => ({ app: { preferences: { playHubOpenSound: true } } }),
      isHubVisible: () => hubVisible,
      documentTarget,
      windowTarget: new EventTarget()
    });

    await expect(controller.requestLaunchSound()).resolves.toBe(false);
    documentTarget.dispatchEvent(new Event("pointerdown"));

    hubVisible = true;
    await expect(controller.requestHubEntrySound()).resolves.toBe(false);

    expect(play).toHaveBeenCalledTimes(2);
    expect(controller.hasPendingLaunchRequest()).toBe(true);
    expect(controller.hasPendingHubEntryRequest()).toBe(true);

    resolveLaunchRetry();
    await flushMicrotasks();

    expect(controller.hasPendingLaunchRequest()).toBe(false);
    expect(controller.hasPendingHubEntryRequest()).toBe(true);

    documentTarget.dispatchEvent(new Event("keydown"));
    await flushMicrotasks();

    expect(play).toHaveBeenCalledTimes(3);
    expect(controller.hasPendingRequest()).toBe(false);
    controller.destroy();
  });

  it("does not treat opening a campaign as a sound request", async () => {
    const play = vi.fn(async () => {});
    class FakeAudio {
      constructor() {
        this.preload = "";
        this.currentTime = 0;
        this.play = play;
      }
    }
    vi.stubGlobal("Audio", FakeAudio);

    let hubVisible = true;
    const controller = createHubOpenSoundController({
      getState: () => ({
        app: { preferences: { playHubOpenSound: true } },
        appShell: { activeCampaignId: "campaign_alpha" }
      }),
      isHubVisible: () => hubVisible,
      documentTarget: new EventTarget(),
      windowTarget: new EventTarget()
    });

    hubVisible = false;
    await flushMicrotasks();

    expect(play).not.toHaveBeenCalled();
    expect(controller.hasPendingRequest()).toBe(false);
    controller.destroy();
  });

  it("lets a fresh controller play the startup sound for a new app boot", async () => {
    const play = vi.fn(async () => {});
    class FakeAudio {
      constructor() {
        this.preload = "";
        this.currentTime = 0;
        this.play = play;
      }
    }
    vi.stubGlobal("Audio", FakeAudio);

    const deps = {
      getState: () => ({ app: { preferences: { playHubOpenSound: true } } }),
      isHubVisible: () => false,
      documentTarget: new EventTarget(),
      windowTarget: new EventTarget()
    };
    const firstSession = createHubOpenSoundController(deps);
    await expect(firstSession.requestLaunchSound()).resolves.toBe(true);
    await expect(firstSession.requestLaunchSound()).resolves.toBe(false);
    firstSession.destroy();

    const secondSession = createHubOpenSoundController(deps);
    await expect(secondSession.requestLaunchSound()).resolves.toBe(true);

    expect(play).toHaveBeenCalledTimes(2);
    secondSession.destroy();
  });
});
