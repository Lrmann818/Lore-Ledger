// @ts-check
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  calcAppLocalStorageBytes,
  formatBytes,
  getStorageDiagnostics,
  getStorageEstimate
} from "../js/storage/diagnostics.js";

// ---------------------------------------------------------------------------
// formatBytes — pure function, no globals needed
// ---------------------------------------------------------------------------

describe("formatBytes", () => {
  it("returns '0 bytes' for zero", () => {
    expect(formatBytes(0)).toBe("0 bytes");
  });

  it("returns '0 bytes' for negative numbers", () => {
    expect(formatBytes(-1)).toBe("0 bytes");
  });

  it("returns '0 bytes' for NaN", () => {
    expect(formatBytes(NaN)).toBe("0 bytes");
  });

  it("returns '0 bytes' for Infinity", () => {
    expect(formatBytes(Infinity)).toBe("0 bytes");
  });

  it("returns '1 byte' for exactly 1 (singular)", () => {
    expect(formatBytes(1)).toBe("1 byte");
  });

  it("returns byte count as-is for values below 1 KB", () => {
    expect(formatBytes(512)).toBe("512 bytes");
    expect(formatBytes(1023)).toBe("1023 bytes");
  });

  it("returns '1.0 KB' at the 1024-byte boundary", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
  });

  it("returns KB with one decimal place for values in the KB range", () => {
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
  });

  it("returns '1.00 MB' at exactly 1 MB", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.00 MB");
  });

  it("returns MB with two decimal places for values in the MB range", () => {
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.00 MB");
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.50 MB");
  });

  it("returns '1.00 GB' at exactly 1 GB", () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe("1.00 GB");
  });

  it("returns GB with two decimal places for multi-GB values", () => {
    // 4939837440 bytes = 4939837440 / (1024^3) ≈ 4.60 GB
    expect(formatBytes(4939837440)).toBe("4.60 GB");
    expect(formatBytes(2.5 * 1024 * 1024 * 1024)).toBe("2.50 GB");
  });
});

// ---------------------------------------------------------------------------
// calcAppLocalStorageBytes — requires a localStorage stub
// ---------------------------------------------------------------------------

/**
 * Build a minimal localStorage-shaped stub around a plain object.
 * @param {Record<string, string>} store
 */
function makeLocalStorageStub(store = {}) {
  return {
    getItem: vi.fn((key) => Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn()
  };
}

describe("calcAppLocalStorageBytes", () => {
  afterEach(() => {
    // Remove our stub so it cannot bleed into other suites.
    try { delete globalThis.localStorage; } catch { /* non-configurable in some envs */ }
  });

  it("returns 0 when the key array is empty", () => {
    Object.defineProperty(globalThis, "localStorage", {
      value: makeLocalStorageStub({}),
      configurable: true
    });
    expect(calcAppLocalStorageBytes([])).toBe(0);
  });

  it("returns 0 when none of the keys exist in localStorage", () => {
    Object.defineProperty(globalThis, "localStorage", {
      value: makeLocalStorageStub({}),
      configurable: true
    });
    expect(calcAppLocalStorageBytes(["missing_key"])).toBe(0);
  });

  it("counts (key.length + value.length) * 2 bytes per UTF-16 entry", () => {
    const key = "localCampaignTracker_v1";
    const value = "x".repeat(100); // 100 chars
    Object.defineProperty(globalThis, "localStorage", {
      value: makeLocalStorageStub({ [key]: value }),
      configurable: true
    });
    const expected = (key.length + value.length) * 2;
    expect(calcAppLocalStorageBytes([key])).toBe(expected);
  });

  it("sums bytes across multiple keys", () => {
    const key1 = "localCampaignTracker_v1";
    const val1 = "a".repeat(50);
    const key2 = "localCampaignTracker_activeTab";
    const val2 = "tracker";
    Object.defineProperty(globalThis, "localStorage", {
      value: makeLocalStorageStub({ [key1]: val1, [key2]: val2 }),
      configurable: true
    });
    const expected = (key1.length + val1.length) * 2 + (key2.length + val2.length) * 2;
    expect(calcAppLocalStorageBytes([key1, key2])).toBe(expected);
  });

  it("skips keys that are absent without throwing", () => {
    const key1 = "localCampaignTracker_v1";
    const val1 = "data";
    Object.defineProperty(globalThis, "localStorage", {
      value: makeLocalStorageStub({ [key1]: val1 }),
      configurable: true
    });
    // key2 does not exist in the store
    const result = calcAppLocalStorageBytes([key1, "non_existent_key"]);
    expect(result).toBe((key1.length + val1.length) * 2);
  });

  it("returns 0 and does not throw when localStorage.getItem throws", () => {
    const throwing = {
      getItem: vi.fn(() => { throw new Error("SecurityError: storage access denied"); })
    };
    Object.defineProperty(globalThis, "localStorage", {
      value: throwing,
      configurable: true
    });
    expect(() => calcAppLocalStorageBytes(["any_key"])).not.toThrow();
    expect(calcAppLocalStorageBytes(["any_key"])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getStorageEstimate — requires a navigator stub
// ---------------------------------------------------------------------------

describe("getStorageEstimate", () => {
  afterEach(() => {
    try { delete globalThis.navigator; } catch { /* ignore */ }
  });

  it("returns null when navigator is undefined", async () => {
    // Remove navigator entirely
    const original = globalThis.navigator;
    Object.defineProperty(globalThis, "navigator", { value: undefined, configurable: true });
    await expect(getStorageEstimate()).resolves.toBeNull();
    Object.defineProperty(globalThis, "navigator", { value: original, configurable: true });
  });

  it("returns null when navigator.storage is absent", async () => {
    Object.defineProperty(globalThis, "navigator", {
      value: {},
      configurable: true
    });
    await expect(getStorageEstimate()).resolves.toBeNull();
  });

  it("returns null when navigator.storage.estimate is not a function", async () => {
    Object.defineProperty(globalThis, "navigator", {
      value: { storage: { estimate: "not-a-function" } },
      configurable: true
    });
    await expect(getStorageEstimate()).resolves.toBeNull();
  });

  it("returns null when estimate() rejects", async () => {
    Object.defineProperty(globalThis, "navigator", {
      value: {
        storage: {
          estimate: vi.fn(async () => { throw new Error("sandboxed"); })
        }
      },
      configurable: true
    });
    await expect(getStorageEstimate()).resolves.toBeNull();
  });

  it("returns the StorageEstimate object when estimate() resolves", async () => {
    const fakeEstimate = { usage: 1024, quota: 2048 };
    Object.defineProperty(globalThis, "navigator", {
      value: {
        storage: { estimate: vi.fn(async () => fakeEstimate) }
      },
      configurable: true
    });
    await expect(getStorageEstimate()).resolves.toEqual(fakeEstimate);
  });
});

// ---------------------------------------------------------------------------
// getStorageDiagnostics — end-to-end: localStorage + navigator.storage
// ---------------------------------------------------------------------------

describe("getStorageDiagnostics", () => {
  afterEach(() => {
    try { delete globalThis.localStorage; } catch { /* ignore */ }
    try { delete globalThis.navigator; } catch { /* ignore */ }
  });

  function installStorage({ store = {}, usage = null, quota = null, estimateThrows = false, noStorage = false } = {}) {
    Object.defineProperty(globalThis, "localStorage", {
      value: makeLocalStorageStub(store),
      configurable: true
    });

    if (noStorage) {
      Object.defineProperty(globalThis, "navigator", {
        value: {},
        configurable: true
      });
      return;
    }

    const estimateFn = estimateThrows
      ? vi.fn(async () => { throw new Error("denied"); })
      : vi.fn(async () => ({ usage, quota }));

    Object.defineProperty(globalThis, "navigator", {
      value: { storage: { estimate: estimateFn } },
      configurable: true
    });
  }

  it("reports 0 app bytes and no browser estimate when storage is empty and estimate unsupported", async () => {
    installStorage({ noStorage: true });
    const diag = await getStorageDiagnostics([]);
    expect(diag.appBytes).toBe(0);
    expect(diag.appFormatted).toBe("0 bytes");
    expect(diag.estimateSupported).toBe(false);
    expect(diag.browserUsed).toBeNull();
    expect(diag.browserUsedFormatted).toBeNull();
    expect(diag.browserQuota).toBeNull();
    expect(diag.browserQuotaFormatted).toBeNull();
    expect(diag.browserAvailable).toBeNull();
    expect(diag.browserAvailableFormatted).toBeNull();
  });

  it("populates all browser fields when estimate() returns usage and quota", async () => {
    const usage = 512 * 1024;        // 512 KB
    const quota = 10 * 1024 * 1024; // 10 MB
    installStorage({ usage, quota });
    const diag = await getStorageDiagnostics([]);
    expect(diag.estimateSupported).toBe(true);
    expect(diag.browserUsed).toBe(usage);
    expect(diag.browserUsedFormatted).toBe("512.0 KB");
    expect(diag.browserQuota).toBe(quota);
    expect(diag.browserQuotaFormatted).toBe("10.00 MB");
    expect(diag.browserAvailable).toBe(quota - usage);
    expect(diag.browserAvailableFormatted).toBe("9.50 MB");
  });

  it("calculates available as quota minus usage", async () => {
    installStorage({ usage: 100, quota: 1000 });
    const diag = await getStorageDiagnostics([]);
    expect(diag.browserAvailable).toBe(900);
  });

  it("clamps available to 0 if usage exceeds quota", async () => {
    installStorage({ usage: 1200, quota: 1000 });
    const diag = await getStorageDiagnostics([]);
    expect(diag.browserAvailable).toBe(0);
    expect(diag.browserAvailableFormatted).toBe("0 bytes");
  });

  it("includes app localStorage bytes in appBytes using both app keys", async () => {
    const key1 = "localCampaignTracker_v1";
    const val1 = "z".repeat(200);
    const key2 = "localCampaignTracker_activeTab";
    const val2 = "tracker";
    installStorage({
      store: { [key1]: val1, [key2]: val2 },
      noStorage: true
    });
    const expected = (key1.length + val1.length) * 2 + (key2.length + val2.length) * 2;
    const diag = await getStorageDiagnostics([key1, key2]);
    expect(diag.appBytes).toBe(expected);
    expect(diag.appFormatted).not.toBe("0 bytes");
  });

  it("sets estimateSupported false and nulls all browser fields when estimate() throws", async () => {
    installStorage({ estimateThrows: true });
    const diag = await getStorageDiagnostics([]);
    expect(diag.estimateSupported).toBe(false);
    expect(diag.browserUsed).toBeNull();
    expect(diag.browserQuota).toBeNull();
    expect(diag.browserAvailable).toBeNull();
  });

  it("handles estimate() returning undefined usage/quota gracefully", async () => {
    // Some browsers may return an object without both fields.
    Object.defineProperty(globalThis, "localStorage", {
      value: makeLocalStorageStub({}),
      configurable: true
    });
    Object.defineProperty(globalThis, "navigator", {
      value: { storage: { estimate: vi.fn(async () => ({})) } },
      configurable: true
    });
    const diag = await getStorageDiagnostics([]);
    // estimate() returned an object (not null), so it IS supported,
    // but usage/quota were undefined → fields stay null.
    expect(diag.estimateSupported).toBe(true);
    expect(diag.browserUsed).toBeNull();
    expect(diag.browserQuota).toBeNull();
    expect(diag.browserAvailable).toBeNull();
  });
});
