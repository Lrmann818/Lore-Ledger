import { describe, expect, it } from "vitest";

import { isNativeAppRuntime, syncNativeAppClass } from "../js/utils/runtime.js";

function createClassList() {
  const values = new Set();
  return {
    toggle(name, enabled) {
      if (enabled) values.add(name);
      else values.delete(name);
      return values.has(name);
    },
    contains(name) {
      return values.has(name);
    }
  };
}

describe("runtime helpers", () => {
  it("detects Capacitor-style native runtimes", () => {
    expect(isNativeAppRuntime({
      locationObj: { protocol: "capacitor:" }
    })).toBe(true);

    expect(isNativeAppRuntime({
      locationObj: { protocol: "https:" },
      capacitorObj: { isNativePlatform: () => true }
    })).toBe(true);

    expect(isNativeAppRuntime({
      locationObj: { protocol: "https:" },
      capacitorObj: { isNativePlatform: () => false }
    })).toBe(false);
  });

  it("treats broken Capacitor checks as non-native", () => {
    expect(isNativeAppRuntime({
      locationObj: { protocol: "https:" },
      capacitorObj: {
        isNativePlatform() {
          throw new Error("broken");
        }
      }
    })).toBe(false);
  });

  it("syncs the native runtime class onto the supplied root elements", () => {
    const documentElement = { classList: createClassList() };
    const body = { classList: createClassList() };

    expect(syncNativeAppClass({
      documentElement,
      body,
      enabled: true
    })).toBe(true);
    expect(documentElement.classList.contains("is-native-app")).toBe(true);
    expect(body.classList.contains("is-native-app")).toBe(true);

    expect(syncNativeAppClass({
      documentElement,
      body,
      enabled: false
    })).toBe(false);
    expect(documentElement.classList.contains("is-native-app")).toBe(false);
    expect(body.classList.contains("is-native-app")).toBe(false);
  });
});
