import { afterEach, describe, expect, it, vi } from "vitest";

import {
  HUB_OPEN_SOUND_URL,
  playHubOpenSound,
  playHubOpenSoundForState,
  resetHubOpenSoundForTests
} from "../js/audio/hubOpenSound.js";

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

  it("suppresses playback failures such as autoplay blocking", async () => {
    class FakeAudio {
      constructor() {
        this.preload = "";
        this.currentTime = 4;
        this.play = vi.fn(() => Promise.reject(new DOMException("blocked", "NotAllowedError")));
      }
    }
    vi.stubGlobal("Audio", FakeAudio);

    await expect(playHubOpenSound()).resolves.toBe(true);
  });
});
