import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeClassList {
  constructor(initial = []) {
    this._values = new Set(initial);
  }

  add(...tokens) {
    tokens.forEach((token) => this._values.add(token));
  }

  remove(...tokens) {
    tokens.forEach((token) => this._values.delete(token));
  }

  toggle(token, force) {
    const shouldAdd = typeof force === "boolean" ? force : !this._values.has(token);
    if (shouldAdd) this._values.add(token);
    else this._values.delete(token);
    return shouldAdd;
  }

  contains(token) {
    return this._values.has(token);
  }
}

class FakeElement extends EventTarget {
  constructor(id = "", { classes = [], dataset = {} } = {}) {
    super();
    this.id = id;
    this.dataset = { ...dataset };
    this.hidden = false;
    this.disabled = false;
    this.children = [];
    this.attributes = new Map();
    this.classList = new FakeClassList(classes);
    Object.entries(dataset).forEach(([key, value]) => {
      this.attributes.set(`data-${key}`, String(value));
    });
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  querySelectorAll(selector) {
    if (selector !== ".tab[data-tab]") return [];
    return this.children.filter((child) => child.classList.contains("tab") && !!child.getAttribute("data-tab"));
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  toggleAttribute(name, force) {
    const nextValue = typeof force === "boolean" ? force : !this.attributes.has(name);
    if (name === "hidden") this.hidden = nextValue;
    if (nextValue) this.attributes.set(name, "");
    else this.attributes.delete(name);
    return nextValue;
  }

  focus() {}
}

class FakeDocument extends EventTarget {
  constructor(elements) {
    super();
    this._elements = new Map(elements.map((element) => [element.id, element]));
  }

  getElementById(id) {
    return this._elements.get(id) ?? null;
  }

  querySelector(selector) {
    if (selector === ".tabs") return this.getElementById("campaignTabs");
    if (selector.startsWith("#")) return this.getElementById(selector.slice(1));
    return null;
  }
}

function installNavigationDom() {
  const tabsRoot = new FakeElement("campaignTabs", { classes: ["tabs"] });
  const trackerTab = new FakeElement("trackerTab", { classes: ["tab"], dataset: { tab: "tracker" } });
  const mapTab = new FakeElement("mapTab", { classes: ["tab"], dataset: { tab: "map" } });
  tabsRoot.appendChild(trackerTab);
  tabsRoot.appendChild(mapTab);

  const hubPage = new FakeElement("page-hub");
  const trackerPage = new FakeElement("page-tracker");
  const mapPage = new FakeElement("page-map");
  const document = new FakeDocument([tabsRoot, trackerTab, mapTab, hubPage, trackerPage, mapPage]);
  const localStorageMap = new Map();
  const location = { hash: "" };

  Object.defineProperty(globalThis, "document", {
    value: document,
    configurable: true
  });
  Object.defineProperty(globalThis, "window", {
    value: new EventTarget(),
    configurable: true
  });
  Object.defineProperty(globalThis, "location", {
    value: location,
    configurable: true
  });
  Object.defineProperty(globalThis, "history", {
    value: {
      replaceState: vi.fn((_state, _title, hash) => {
        location.hash = hash;
      })
    },
    configurable: true
  });
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: vi.fn((key) => localStorageMap.get(key) ?? null),
      setItem: vi.fn((key, value) => {
        localStorageMap.set(key, String(value));
      })
    },
    configurable: true
  });

  return { hubPage, trackerPage };
}

describe("initTopTabsNavigation Hub entry", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fires the Hub entry callback on startup when the app lands on Hub without a Hub tab", async () => {
    const { hubPage, trackerPage } = installNavigationDom();
    const onHubEntry = vi.fn();
    const { initTopTabsNavigation } = await import("../js/ui/navigation.js");

    initTopTabsNavigation({
      state: { ui: {} },
      defaultTab: "hub",
      canActivateTab: (tabName) => tabName === "hub",
      onHubEntry
    });

    expect(onHubEntry).toHaveBeenCalledTimes(1);
    expect(hubPage.hidden).toBe(false);
    expect(trackerPage.hidden).toBe(true);
  });

  it("fires once when refreshing from campaign content back into Hub", async () => {
    installNavigationDom();
    const onHubEntry = vi.fn();
    const state = { ui: { activeTab: "tracker" } };
    let hasActiveCampaign = true;
    const { initTopTabsNavigation } = await import("../js/ui/navigation.js");

    const api = initTopTabsNavigation({
      state,
      defaultTab: "hub",
      canActivateTab: (tabName) => {
        if (tabName === "hub") return !hasActiveCampaign;
        return hasActiveCampaign;
      },
      onHubEntry
    });

    expect(onHubEntry).not.toHaveBeenCalled();

    hasActiveCampaign = false;
    api.refresh();
    api.refresh();

    expect(onHubEntry).toHaveBeenCalledTimes(1);
    expect(state.ui.activeTab).toBe("hub");
  });
});
