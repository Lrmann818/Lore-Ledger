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
    this.ownerDocument = null;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  toggleAttribute(name, force) {
    const nextValue = typeof force === "boolean"
      ? force
      : !this.attributes.has(name);
    if (name === "hidden") this.hidden = nextValue;
    if (nextValue) this.attributes.set(name, "");
    else this.attributes.delete(name);
    return nextValue;
  }

  focus() {
    if (this.ownerDocument) {
      this.ownerDocument.activeElement = this;
    }
  }

  blur() {
    if (this.ownerDocument?.activeElement === this) {
      this.ownerDocument.activeElement = this.ownerDocument.body;
    }
  }

  contains(node) {
    if (node === this) return true;
    if (this.id !== "dataPanelOverlay") return false;
    return node instanceof FakeElement && node.id.startsWith("data");
  }
}

class FakeDocument extends EventTarget {
  constructor(elements) {
    super();
    this._elements = new Map(elements.map((element) => [element.id, element]));
    this.lastModified = "2026-04-08";
    this.body = new FakeElement("body");
    this.activeElement = this.body;
    this.body.ownerDocument = this;
    elements.forEach((element) => {
      element.ownerDocument = this;
    });
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
    new FakeElement("dataPlayHubOpenSoundToggleItem"),
    new FakeElement("dataPlayHubOpenSoundToggle"),
    new FakeElement("dataCampaignSection"),
    new FakeElement("dataCampaignDivider"),
    new FakeElement("dataOpenHubBtn"),
    new FakeElement("dataReportBugBtn"),
    new FakeElement("dataCopyDebugInfoBtn"),
    new FakeElement("dataSupportMeta"),
    new FakeElement("dataAboutBtn"),
    new FakeElement("settingsBtn")
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
      matchMedia: vi.fn(() => ({ matches: false })),
      scrollY: 0,
      scrollTo: vi.fn()
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
    campaignSection: document.getElementById("dataCampaignSection"),
    campaignDivider: document.getElementById("dataCampaignDivider"),
    playHubOpenSoundToggleItem: document.getElementById("dataPlayHubOpenSoundToggleItem"),
    playHubOpenSoundToggle: document.getElementById("dataPlayHubOpenSoundToggle"),
    openHubBtn: document.getElementById("dataOpenHubBtn"),
    reportBugBtn: document.getElementById("dataReportBugBtn"),
    copyDebugInfoBtn: document.getElementById("dataCopyDebugInfoBtn"),
    supportMeta: document.getElementById("dataSupportMeta")
  };
}

function createDeps() {
  return {
    state: {
      appShell: { activeCampaignId: null },
      app: { preferences: { playHubOpenSound: false } },
      ui: { activeTab: "tracker", theme: "system", textareaHeights: {}, panelCollapsed: {} },
      tracker: { ui: {} }
    },
    storageKeys: { STORAGE_KEY: "storage", ACTIVE_TAB_KEY: "tab" },
    applyTheme: vi.fn(),
    markDirty: vi.fn(),
    flush: vi.fn(),
    exportBackup: vi.fn(),
    importBackup: vi.fn(),
    resetAll: vi.fn(),
    clearAllBlobs: vi.fn(),
    clearAllTexts: vi.fn(),
    openCampaignHub: vi.fn(),
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

    expect(deps.setStatus).toHaveBeenCalledWith(
      "Opening bug report email… If nothing opens, copy debug info and email support@lore-ledger.com."
    );
    expect(dom.location.href).toContain("subject=Lore%20Ledger%20Bug%20Report");
    expect(dom.location.href).toContain("Please%20describe%20the%20bug%3A");
    expect(dom.location.href).toContain("%0A%0ADebug%20info%3A%0A");
    expect(dom.location.href).not.toContain("+");

    const params = new URLSearchParams(dom.location.href.split("?")[1]);
    expect(params.get("subject")).toBe("Lore Ledger Bug Report");
    expect(params.get("body")).toContain("Debug info:");
    expect(params.get("body")).toContain("Current page: #hub");
    expect(params.get("body")).toContain("Campaign state: no active campaign");
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
    expect(dom.navigator.clipboard.writeText.mock.calls[0][0]).toContain("Current page: #hub");
    expect(dom.navigator.clipboard.writeText.mock.calls[0][0]).toContain("Campaign state: no active campaign");
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
    expect(uiAlertMock.mock.calls[0][0]).toContain("Current page: #hub");
    expect(uiAlertMock.mock.calls[0][0]).toContain("Campaign state: no active campaign");
    expect(uiAlertMock.mock.calls[0][0]).toContain("User agent: LoreLedgerTest/1.0");
    expect(uiAlertMock.mock.calls[0][1]).toEqual({ title: "Debug info" });
    expect(deps.setStatus).toHaveBeenCalledWith("Couldn't copy automatically. Debug info shown in dialog.");
    consoleErrorSpy.mockRestore();
  });

  it("falls back to an in-app support dialog when mailto launch is unavailable", async () => {
    const deps = createDeps();
    const { initDataPanel } = await import("../js/ui/dataPanel.js");

    delete globalThis.location;
    initDataPanel(deps);

    dom.reportBugBtn.dispatchEvent(new Event("click"));
    await vi.waitFor(() => {
      expect(uiAlertMock).toHaveBeenCalledTimes(1);
    });

    expect(uiAlertMock.mock.calls[0][0]).toContain("Email draft launch is unavailable in this app context.");
    expect(uiAlertMock.mock.calls[0][0]).toContain("support@lore-ledger.com");
    expect(uiAlertMock.mock.calls[0][0]).toContain("Current page: #hub");
    expect(uiAlertMock.mock.calls[0][1]).toEqual({ title: "Report Bug" });
    expect(deps.setStatus).toHaveBeenCalledWith("Email draft unavailable here. Debug info shown.");
  });

  it("uses the active campaign state and page in debug info when a campaign is open", async () => {
    const deps = createDeps();
    deps.state.appShell.activeCampaignId = "campaign_alpha";
    deps.state.ui.activeTab = "map";
    const { initDataPanel } = await import("../js/ui/dataPanel.js");

    initDataPanel(deps);

    dom.copyDebugInfoBtn.dispatchEvent(new Event("click"));
    await vi.waitFor(() => {
      expect(dom.navigator.clipboard.writeText).toHaveBeenCalledTimes(1);
    });

    expect(dom.navigator.clipboard.writeText.mock.calls[0][0]).toContain("Current page: #map");
    expect(dom.navigator.clipboard.writeText.mock.calls[0][0]).toContain("Campaign state: active campaign");
  });

  it("shows the Campaign Hub return action only while a campaign is active", async () => {
    const deps = createDeps();
    deps.state.appShell.activeCampaignId = "campaign_alpha";
    const { initDataPanel } = await import("../js/ui/dataPanel.js");

    const panel = initDataPanel(deps);

    expect(dom.campaignSection.hidden).toBe(false);
    expect(dom.campaignDivider.hidden).toBe(false);
    expect(dom.openHubBtn.disabled).toBe(false);

    dom.openHubBtn.dispatchEvent(new Event("click"));
    await vi.waitFor(() => {
      expect(deps.openCampaignHub).toHaveBeenCalledTimes(1);
    });

    deps.state.appShell.activeCampaignId = null;
    panel.open?.();

    expect(dom.campaignSection.hidden).toBe(true);
    expect(dom.campaignDivider.hidden).toBe(true);
    expect(dom.openHubBtn.disabled).toBe(true);
  });

  it("updates the app-scoped Hub intro music preference from the settings toggle", async () => {
    const deps = createDeps();
    const { initDataPanel } = await import("../js/ui/dataPanel.js");

    initDataPanel(deps);

    expect(dom.playHubOpenSoundToggle.checked).toBe(false);
    expect(dom.playHubOpenSoundToggleItem.classList.contains("is-checked")).toBe(false);

    dom.playHubOpenSoundToggle.checked = true;
    dom.playHubOpenSoundToggle.dispatchEvent(new Event("change"));

    expect(deps.state.app.preferences.playHubOpenSound).toBe(true);
    expect(dom.playHubOpenSoundToggleItem.classList.contains("is-checked")).toBe(false);
    expect(deps.markDirty).toHaveBeenCalledTimes(1);

    deps.state.app.preferences.playHubOpenSound = false;
    dom.playHubOpenSoundToggle.checked = true;

    const panel = initDataPanel(deps);
    panel.open?.();

    expect(dom.playHubOpenSoundToggle.checked).toBe(false);
    expect(dom.playHubOpenSoundToggleItem.classList.contains("is-checked")).toBe(false);
  });

  it("moves focus out of the settings modal before returning to the Campaign Hub", async () => {
    const deps = createDeps();
    deps.state.appShell.activeCampaignId = "campaign_alpha";
    const { initDataPanel } = await import("../js/ui/dataPanel.js");

    const panel = initDataPanel(deps);
    panel.open?.();
    dom.openHubBtn.focus();
    expect(dom.document.activeElement).toBe(dom.openHubBtn);

    dom.openHubBtn.dispatchEvent(new Event("click"));

    await vi.waitFor(() => {
      expect(deps.openCampaignHub).toHaveBeenCalledTimes(1);
    });

    expect(dom.document.activeElement).toBe(dom.document.body);
    expect(dom.openHubBtn.getAttribute("aria-hidden")).toBeNull();
    expect(dom.document.getElementById("dataPanelOverlay").getAttribute("aria-hidden")).toBe("true");
  });
});
