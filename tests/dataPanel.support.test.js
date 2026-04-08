import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  uiAlertMock,
  uiConfirmMock
} = vi.hoisted(() => ({
  uiAlertMock: vi.fn(async () => {}),
  uiConfirmMock: vi.fn(async () => false)
}));

vi.mock("../js/ui/dialogs.js", () => ({
  uiAlert: uiAlertMock,
  uiConfirm: uiConfirmMock
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
    this.className = "";
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
    this.lastModified = "2026-04-08";
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
    new FakeElement("dataReportBugBtn"),
    new FakeElement("dataCopyDebugInfoBtn"),
    new FakeElement("dataSupportMeta"),
    new FakeElement("dataAboutBtn")
  ];
  const document = new FakeDocument(elements);
  const location = {
    href: "https://example.test/#tracker",
    hash: "#tracker",
    pathname: "/",
    search: ""
  };
  const navigator = {
    userAgent: "LoreLedgerTest/1.0",
    clipboard: {
      writeText: vi.fn(async () => {})
    }
  };

  Object.defineProperty(globalThis, "document", {
    value: document,
    configurable: true
  });
  Object.defineProperty(globalThis, "window", {
    value: {
      matchMedia: vi.fn(() => ({ matches: false }))
    },
    configurable: true
  });
  Object.defineProperty(globalThis, "navigator", {
    value: navigator,
    configurable: true
  });
  Object.defineProperty(globalThis, "location", {
    value: location,
    configurable: true
  });

  return {
    document,
    location,
    navigator,
    reportBugBtn: document.getElementById("dataReportBugBtn"),
    copyDebugInfoBtn: document.getElementById("dataCopyDebugInfoBtn"),
    supportMeta: document.getElementById("dataSupportMeta")
  };
}

function createDeps() {
  return {
    state: { ui: { activeTab: "tracker", theme: "system", textareaHeights: {}, panelCollapsed: {} }, tracker: { ui: {} } },
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

describe("initDataPanel support actions", () => {
  /** @type {ReturnType<typeof installFakeDom>} */
  let dom;

  beforeEach(() => {
    vi.resetModules();
    uiAlertMock.mockReset();
    uiConfirmMock.mockReset();
    dom = installFakeDom();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete globalThis.document;
    delete globalThis.window;
    delete globalThis.navigator;
    delete globalThis.location;
  });

  it("shows support metadata and launches a bug-report mailto URL", async () => {
    const deps = createDeps();
    const { initDataPanel } = await import("../js/ui/dataPanel.js");

    initDataPanel(deps);

    expect(dom.supportMeta.textContent).toMatch(/^Version /);
    expect(dom.reportBugBtn.hidden).toBe(false);
    expect(dom.copyDebugInfoBtn.hidden).toBe(false);

    dom.reportBugBtn.dispatchEvent(new Event("click"));
    await vi.waitFor(() => {
      expect(dom.location.href.startsWith("mailto:support%40lore-ledger.com?")).toBe(true);
    });

    expect(deps.setStatus).toHaveBeenCalledWith("Opening bug report email…");

    const params = new URLSearchParams(dom.location.href.split("?")[1]);
    expect(params.get("subject")).toBe("Lore Ledger Bug Report");
    expect(params.get("body")).toContain("Debug info:");
    expect(params.get("body")).toContain("Current page: #tracker");
    expect(params.get("body")).toContain("User agent: LoreLedgerTest/1.0");
  });

  it("copies debug info to the clipboard and reports success through status text", async () => {
    const deps = createDeps();
    const { initDataPanel } = await import("../js/ui/dataPanel.js");

    initDataPanel(deps);

    dom.copyDebugInfoBtn.dispatchEvent(new Event("click"));
    await vi.waitFor(() => {
      expect(dom.navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    });
    await vi.waitFor(() => {
      expect(deps.setStatus).toHaveBeenCalledWith("Debug info copied.");
    });

    expect(dom.navigator.clipboard.writeText.mock.calls[0][0]).toContain("App version:");
    expect(dom.navigator.clipboard.writeText.mock.calls[0][0]).toContain("Current page: #tracker");
    expect(dom.navigator.clipboard.writeText.mock.calls[0][0]).toContain("User agent: LoreLedgerTest/1.0");
  });

  it("falls back to an alert when clipboard copy fails", async () => {
    const deps = createDeps();
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    dom.navigator.clipboard.writeText.mockRejectedValueOnce(new Error("denied"));
    const { initDataPanel } = await import("../js/ui/dataPanel.js");

    initDataPanel(deps);

    dom.copyDebugInfoBtn.dispatchEvent(new Event("click"));
    await vi.waitFor(() => {
      expect(uiAlertMock).toHaveBeenCalledTimes(1);
    });

    expect(uiAlertMock.mock.calls[0][0]).toContain("App version:");
    expect(uiAlertMock.mock.calls[0][0]).toContain("Current page: #tracker");
    expect(uiAlertMock.mock.calls[0][0]).toContain("User agent: LoreLedgerTest/1.0");
    expect(uiAlertMock.mock.calls[0][1]).toEqual({ title: "Debug info" });
    expect(deps.setStatus).toHaveBeenCalledWith("Couldn't copy automatically. Debug info shown in dialog.");
    consoleErrorSpy.mockRestore();
  });
});
