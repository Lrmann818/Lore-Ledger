import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createSaveManager } from "../js/storage/saveManager.js";

function makeSubject(overrides = {}) {
  const {
    saveAll = vi.fn(() => true),
    setStatus = vi.fn(),
    showSaveBanner = vi.fn(),
    hideSaveBanner = vi.fn(),
    onExport = vi.fn(async () => {}),
    ...options
  } = overrides;

  const manager = createSaveManager({
    saveAll,
    setStatus,
    showSaveBanner,
    hideSaveBanner,
    onExport,
    ...options
  });

  return {
    manager,
    saveAll,
    setStatus,
    showSaveBanner,
    hideSaveBanner,
    onExport
  };
}

function statusMessages(setStatus) {
  return setStatus.mock.calls.map(([message]) => message);
}

describe("createSaveManager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("marks the manager dirty immediately and exposes DIRTY if unsaved long enough", async () => {
    const { manager, setStatus } = makeSubject({
      debounceMs: 200,
      dirtyDelayMs: 50
    });

    manager.init();
    setStatus.mockClear();

    manager.markDirty();

    expect(manager.getStatus()).toEqual({ stateNow: "SAVED", dirty: true, saving: false });
    expect(setStatus).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(50);

    expect(manager.getStatus()).toEqual({ stateNow: "DIRTY", dirty: true, saving: false });
    expect(statusMessages(setStatus)).toEqual(["Unsaved changes"]);
  });

  it("debounces repeated dirty calls into a single save and saved transition", async () => {
    const { manager, saveAll, setStatus } = makeSubject({
      debounceMs: 100,
      dirtyDelayMs: 500
    });

    manager.init();
    setStatus.mockClear();

    manager.markDirty();
    await vi.advanceTimersByTimeAsync(50);
    manager.markDirty();
    await vi.advanceTimersByTimeAsync(99);

    expect(saveAll).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    expect(saveAll).toHaveBeenCalledTimes(1);
    expect(statusMessages(setStatus)).toEqual(["Saving...", "Saved locally."]);
    expect(manager.getStatus()).toEqual({ stateNow: "SAVED", dirty: false, saving: false });
  });

  it("returns the correct boolean from flush for clean, successful, and failed saves", async () => {
    const clean = makeSubject();
    clean.manager.init();
    clean.setStatus.mockClear();

    await expect(clean.manager.flush()).resolves.toBe(true);
    expect(clean.saveAll).not.toHaveBeenCalled();
    expect(statusMessages(clean.setStatus)).toEqual(["Saved locally."]);

    const success = makeSubject({ debounceMs: 10_000 });
    success.manager.init();
    success.setStatus.mockClear();
    success.manager.markDirty();

    await expect(success.manager.flush()).resolves.toBe(true);
    expect(success.saveAll).toHaveBeenCalledTimes(1);
    expect(success.manager.getStatus()).toEqual({ stateNow: "SAVED", dirty: false, saving: false });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failure = makeSubject({
      saveAll: vi.fn(() => false),
      debounceMs: 10_000
    });
    failure.manager.init();
    failure.setStatus.mockClear();
    failure.manager.markDirty();

    await expect(failure.manager.flush()).resolves.toBe(false);
    expect(warnSpy).toHaveBeenCalled();
    expect(failure.manager.getStatus()).toEqual({ stateNow: "ERROR", dirty: true, saving: false });
  });

  it("shows the save banner on failure and hides it again after a later successful save", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { manager, setStatus, showSaveBanner, hideSaveBanner, onExport } = makeSubject({
      saveAll: vi.fn()
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true),
      debounceMs: 25,
      dirtyDelayMs: 10
    });

    manager.init();
    setStatus.mockClear();

    manager.markDirty();
    await vi.advanceTimersByTimeAsync(25);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(showSaveBanner).toHaveBeenCalledTimes(1);
    expect(showSaveBanner).toHaveBeenCalledWith({ onExport });
    expect(hideSaveBanner).not.toHaveBeenCalled();
    expect(manager.getStatus()).toEqual({ stateNow: "ERROR", dirty: true, saving: false });
    expect(statusMessages(setStatus)).toEqual([
      "Unsaved changes",
      "Saving...",
      "Save failed (local). Export a backup."
    ]);

    setStatus.mockClear();

    await expect(manager.flush()).resolves.toBe(true);

    expect(hideSaveBanner).toHaveBeenCalledTimes(1);
    expect(manager.getStatus()).toEqual({ stateNow: "SAVED", dirty: false, saving: false });
    expect(statusMessages(setStatus)).toEqual(["Saving...", "Saved locally."]);
  });

  it("supports repeated dirty cycles without breaking later saves", async () => {
    const { manager, saveAll, setStatus } = makeSubject({
      debounceMs: 100,
      dirtyDelayMs: 500
    });

    manager.init();
    setStatus.mockClear();

    manager.markDirty();
    await vi.advanceTimersByTimeAsync(40);
    manager.markDirty();
    await vi.advanceTimersByTimeAsync(100);

    manager.markDirty();
    await vi.advanceTimersByTimeAsync(40);
    manager.markDirty();
    await vi.advanceTimersByTimeAsync(100);

    expect(saveAll).toHaveBeenCalledTimes(2);
    expect(statusMessages(setStatus)).toEqual([
      "Saving...",
      "Saved locally.",
      "Saving...",
      "Saved locally."
    ]);
    expect(manager.getStatus()).toEqual({ stateNow: "SAVED", dirty: false, saving: false });
  });

  it("init clears pending timers and restores a clean saved state", async () => {
    const { manager, saveAll, setStatus } = makeSubject({
      debounceMs: 200,
      dirtyDelayMs: 50
    });

    manager.init();
    setStatus.mockClear();

    manager.markDirty();
    await vi.advanceTimersByTimeAsync(50);
    expect(manager.getStatus()).toEqual({ stateNow: "DIRTY", dirty: true, saving: false });

    manager.init();

    expect(manager.getStatus()).toEqual({ stateNow: "SAVED", dirty: false, saving: false });
    expect(statusMessages(setStatus)).toEqual(["Unsaved changes", "Saved locally."]);

    setStatus.mockClear();
    await vi.advanceTimersByTimeAsync(500);

    expect(saveAll).not.toHaveBeenCalled();
    expect(setStatus).not.toHaveBeenCalled();
  });
});
