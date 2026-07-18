import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../js/pages/tracker/trackerSectionReorder.js", () => ({
  setupTrackerSectionReorder: vi.fn(() => ({ destroy: vi.fn() }))
}));
vi.mock("../js/pages/tracker/panels/sessions.js", () => ({
  initSessionsPanel: vi.fn(() => ({ destroy: vi.fn() }))
}));
vi.mock("../js/pages/tracker/panels/npcCards.js", () => ({
  initNpcsPanel: vi.fn(() => ({ destroy: vi.fn(), render: vi.fn() }))
}));
vi.mock("../js/pages/tracker/panels/partyCards.js", () => ({
  initPartyPanel: vi.fn(() => ({ destroy: vi.fn(), render: vi.fn() }))
}));
vi.mock("../js/pages/tracker/panels/locationCards.js", () => ({
  initLocationsPanel: vi.fn(() => ({ destroy: vi.fn(), render: vi.fn() }))
}));
vi.mock("../js/pages/character/characterPage.js", () => ({
  initCharacterPageUI: vi.fn(() => ({ destroy: vi.fn() })),
  destroyActiveCharacterPageUI: vi.fn()
}));
vi.mock("../js/ui/panelHeaderCollapse.js", () => ({
  initPanelHeaderCollapse: vi.fn(() => ({ destroy: vi.fn() }))
}));
vi.mock("../js/ui/panelInvalidation.js", () => ({
  subscribePanelDataChanged: vi.fn(() => vi.fn())
}));
vi.mock("../js/utils/domGuards.js", () => ({
  requireMany: vi.fn(() => ({ ok: true, destroy: vi.fn() })),
  getNoopDestroyApi: () => ({ destroy: vi.fn() })
}));

import { initTrackerPage } from "../js/pages/tracker/trackerPage.js";
import { initCharacterPageUI } from "../js/pages/character/characterPage.js";

describe("initTrackerPage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("passes getBlob through to the Character page export dependencies", () => {
    vi.stubGlobal("document", { getElementById: vi.fn(() => null) });
    vi.stubGlobal("window", { addEventListener: vi.fn() });

    const getBlob = vi.fn();
    const controller = initTrackerPage({
      state: {
        tracker: { campaignTitle: "Campaign", misc: "" },
        characters: { activeId: "char_a", entries: [] }
      },
      SaveManager: { markDirty: vi.fn() },
      Popovers: {},
      uiPrompt: vi.fn(),
      uiAlert: vi.fn(),
      uiConfirm: vi.fn(),
      setStatus: vi.fn(),
      makeNpc: vi.fn(),
      makePartyMember: vi.fn(),
      makeLocation: vi.fn(),
      enhanceNumberSteppers: vi.fn(() => ({ destroy: vi.fn() })),
      numberOrNull: vi.fn(),
      pickCropStorePortrait: vi.fn(),
      ImagePicker: {},
      getBlob,
      deleteBlob: vi.fn(),
      putBlob: vi.fn(),
      dataUrlToBlob: vi.fn(),
      cropImageModal: vi.fn(),
      getPortraitAspect: vi.fn(),
      blobIdToObjectUrl: vi.fn(),
      textKey_spellNotes: vi.fn(),
      putText: vi.fn(),
      getText: vi.fn(),
      deleteText: vi.fn(),
      autoSizeInput: vi.fn(),
      applyTextareaSize: vi.fn()
    });

    expect(initCharacterPageUI).toHaveBeenCalledWith(expect.objectContaining({ getBlob }));

    controller.destroy();
  });
});
