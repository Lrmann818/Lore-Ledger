import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  initPwaUpdatesMock,
  showUpdateBannerMock
} = vi.hoisted(() => ({
  initPwaUpdatesMock: vi.fn(),
  showUpdateBannerMock: vi.fn()
}));

vi.mock("../js/pwa/updates.js", () => ({
  initPwaUpdates: initPwaUpdatesMock
}));

vi.mock("../js/pwa/updateBanner.js", () => ({
  showUpdateBanner: showUpdateBannerMock
}));

class FakeClassList {
  constructor() {
    this._values = new Set();
  }

  add(...tokens) {
    tokens.forEach((token) => this._values.add(token));
  }

  remove(...tokens) {
    tokens.forEach((token) => this._values.delete(token));
  }

  contains(token) {
    return this._values.has(token);
  }
}

class FakeElement extends EventTarget {
  constructor(id = "") {
    super();
    this.id = id;
    this.dataset = {};
    this.hidden = false;
    this.disabled = false;
    this.value = "";
    this.textContent = "";
    this.classList = new FakeClassList();
    this.attributes = new Map();
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
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
    if (!selector.startsWith("#")) return null;
    return this.getElementById(selector.slice(1));
  }
}

function installFakeDom() {
  const elements = [
    new FakeElement("dataPanelOverlay"),
    new FakeElement("dataPanelPanel"),
    new FakeElement("dataPanelClose"),
    new FakeElement("checkUpdatesBtn"),
    new FakeElement("settingsUpdateStatus")
  ];
  const document = new FakeDocument(elements);

  Object.defineProperty(globalThis, "document", {
    value: document,
    configurable: true
  });
  Object.defineProperty(globalThis, "window", {
    value: {},
    configurable: true
  });
  Object.defineProperty(globalThis, "navigator", {
    value: { serviceWorker: {} },
    configurable: true
  });

  return {
    document,
    overlay: document.getElementById("dataPanelOverlay"),
    panel: document.getElementById("dataPanelPanel"),
    closeBtn: document.getElementById("dataPanelClose"),
    checkUpdatesBtn: document.getElementById("checkUpdatesBtn"),
    settingsUpdateStatus: document.getElementById("settingsUpdateStatus")
  };
}

function createDeps() {
  return {
    state: { tracker: { ui: {} }, ui: { theme: "system", textareaHeights: {}, panelCollapsed: {} } },
    storageKeys: { STORAGE_KEY: "storage", ACTIVE_TAB_KEY: "tab" },
    applyTheme: vi.fn(),
    markDirty: vi.fn(),
    flush: vi.fn(),
    exportBackup: vi.fn(),
    importBackup: vi.fn(),
    resetAll: vi.fn(),
    clearAllBlobs: vi.fn(),
    clearAllTexts: vi.fn(),
    setStatus: vi.fn()
  };
}

describe("initDataPanel PWA wiring", () => {
  /** @type {ReturnType<typeof installFakeDom>} */
  let dom;

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    initPwaUpdatesMock.mockReset();
    showUpdateBannerMock.mockReset();
    dom = installFakeDom();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete globalThis.document;
    delete globalThis.window;
    delete globalThis.navigator;
  });

  it("wires Check for updates to the updater check path", async () => {
    const updatesApi = {
      checkForUpdates: vi.fn(async () => true),
      applyUpdate: vi.fn(async () => true)
    };
    initPwaUpdatesMock.mockReturnValue(updatesApi);

    const { initDataPanel } = await import("../js/ui/dataPanel.js");

    initDataPanel(createDeps());

    dom.checkUpdatesBtn.dispatchEvent(new Event("click"));
    await vi.advanceTimersByTimeAsync(1500);

    expect(initPwaUpdatesMock).toHaveBeenCalledTimes(1);
    expect(updatesApi.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(dom.settingsUpdateStatus.textContent).toBe("You're up to date.");
  });

  it("shows the update banner on refresh-needed and wires the banner action to applyUpdate", async () => {
    let onNeedRefresh = null;
    const updatesApi = {
      checkForUpdates: vi.fn(async () => true),
      applyUpdate: vi.fn(async () => true)
    };
    initPwaUpdatesMock.mockImplementation((options) => {
      onNeedRefresh = options.onNeedRefresh;
      return updatesApi;
    });

    const { initDataPanel } = await import("../js/ui/dataPanel.js");

    initDataPanel(createDeps());

    expect(typeof onNeedRefresh).toBe("function");

    onNeedRefresh();

    expect(showUpdateBannerMock).toHaveBeenCalledTimes(1);
    expect(showUpdateBannerMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        onRefresh: expect.any(Function)
      })
    );

    await showUpdateBannerMock.mock.calls[0][0].onRefresh();

    expect(updatesApi.applyUpdate).toHaveBeenCalledTimes(1);
  });
});
