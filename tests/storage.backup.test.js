import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../js/ui/dialogs.js", () => ({
  uiAlert: vi.fn(async () => {}),
  uiConfirm: vi.fn(async () => true)
}));

vi.mock("../js/storage/texts-idb.js", async () => {
  const actual = await vi.importActual("../js/storage/texts-idb.js");
  return {
    ...actual,
    deleteText: vi.fn(async () => {})
  };
});

import { CURRENT_SCHEMA_VERSION, migrateState, sanitizeForSave } from "../js/state.js";
import { exportBackup, collectReferencedBlobIds, collectReferencedTextIds, importBackup } from "../js/storage/backup.js";
import { deleteText, textKey_spellNotes } from "../js/storage/texts-idb.js";
import { uiAlert } from "../js/ui/dialogs.js";

function makeState() {
  return migrateState(undefined);
}

function jsonClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeInput(payload, opts = {}) {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload);
  const size = opts.size ?? text.length;
  return new TestInputElement([
    {
      size,
      text: vi.fn(async () => text)
    }
  ]);
}

function makeImportDeps(overrides = {}) {
  const state = Object.prototype.hasOwnProperty.call(overrides, "state")
    ? overrides.state
    : makeState();

  return {
    state,
    ensureMapManager: vi.fn(),
    migrateState,
    saveAll: vi.fn(async () => true),
    putBlob: vi.fn(async (_blob, id) => id ?? "generated-blob-id"),
    putText: vi.fn(async (_text, id) => id),
    deleteBlob: vi.fn(async () => {}),
    dataUrlToBlob: vi.fn(() => ({ type: "image/png" })),
    afterImport: vi.fn(async () => {}),
    sanitizeForSave,
    ...overrides
  };
}

class TestInputElement {
  constructor(files = []) {
    this.files = files;
    this.value = "picked-file";
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("collectReferencedBlobIds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("HTMLInputElement", TestInputElement);
  });

  it("collects blob references across tracker, character, and map shapes", () => {
    const ids = collectReferencedBlobIds({
      tracker: {
        npcs: [{ imgBlobId: "npc-1" }, { imgBlobId: "npc-1" }],
        party: [{ imgBlobId: "party-1" }],
        locationsList: [{ imgBlobId: "loc-1" }, { imgBlobId: "   " }]
      },
      character: { imgBlobId: "char-1" },
      map: {
        bgBlobId: "legacy-bg",
        drawingBlobId: "legacy-drawing",
        maps: [
          { bgBlobId: "map-bg-1", drawingBlobId: "map-drawing-1" },
          { bgBlobId: "map-bg-1", drawingBlobId: null },
          "bad-entry"
        ]
      }
    });

    expect([...ids].sort()).toEqual([
      "char-1",
      "legacy-bg",
      "legacy-drawing",
      "loc-1",
      "map-bg-1",
      "map-drawing-1",
      "npc-1",
      "party-1"
    ]);
  });

});

describe("collectReferencedTextIds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("HTMLInputElement", TestInputElement);
  });

  it("derives spell note storage keys from structured spell ids only", () => {
    const ids = collectReferencedTextIds({
      character: {
        spells: {
          levels: [
            {
              spells: [
                { id: "spell_alpha" },
                { id: " spell_beta " },
                { id: "" },
                { name: "Missing id" }
              ]
            },
            { spells: "bad-shape" },
            "bad-level"
          ]
        }
      }
    });

    expect([...ids].sort()).toEqual([
      textKey_spellNotes("spell_alpha"),
      textKey_spellNotes("spell_beta")
    ]);
  });
});

describe("exportBackup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("HTMLInputElement", TestInputElement);
  });

  it("exports the clean backup shape with referenced blobs and all texts", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-02T15:30:00.000Z"));

    const state = makeState();
    state.tracker.campaignTitle = "Exported Campaign";
    state.tracker.npcs = [{ name: "Scout", imgBlobId: "npc-blob" }];
    state.character.imgBlobId = "char-blob";
    state.map.bgBlobId = "map-bg";
    state.map.undo = [{ step: 1 }];
    state.map.redo = [{ step: 2 }];
    state.ui.dice = { history: [{ text: "1d20" }], last: { count: 1, sides: 20, mod: 0, mode: "normal" } };
    state.ui.calc = { history: [{ total: 10 }], mode: "scientific" };

    /** @type {Blob|undefined} */
    let exportedBlob;
    const anchor = { click: vi.fn(), href: "", download: "" };

    vi.stubGlobal("URL", {
      createObjectURL: vi.fn((blob) => {
        exportedBlob = blob;
        return "blob:backup-export";
      }),
      revokeObjectURL: vi.fn()
    });
    vi.stubGlobal("document", {
      createElement: vi.fn(() => anchor)
    });

    const blobRecords = {
      "npc-blob": { id: "npc-blob" },
      "char-blob": { id: "char-blob" },
      "map-bg": { id: "map-bg" }
    };

    await exportBackup({
      state,
      ensureMapManager: vi.fn(),
      getBlob: vi.fn(async (id) => blobRecords[id] ?? null),
      blobToDataUrl: vi.fn(async (blob) => `data:image/png;base64,${blob.id}`),
      getAllTexts: vi.fn(async () => ({
        [textKey_spellNotes("spell-1")]: "Magic missile notes",
        unrelated_text: "Still exported"
      })),
      sanitizeForSave
    });

    expect(anchor.click).toHaveBeenCalledTimes(1);
    expect(anchor.href).toBe("blob:backup-export");
    expect(anchor.download).toBe("campaign-backup-2026-04-02.json");
    expect(exportedBlob).toBeInstanceOf(Blob);

    const parsed = JSON.parse(await exportedBlob.text());
    expect(parsed).toEqual({
      version: 2,
      exportedAt: "2026-04-02T15:30:00.000Z",
      state: jsonClone(sanitizeForSave(state)),
      blobs: {
        "npc-blob": "data:image/png;base64,npc-blob",
        "char-blob": "data:image/png;base64,char-blob",
        "map-bg": "data:image/png;base64,map-bg"
      },
      texts: {
        [textKey_spellNotes("spell-1")]: "Magic missile notes",
        unrelated_text: "Still exported"
      }
    });
    expect(parsed.state.map.undo).toBeUndefined();
    expect(parsed.state.map.redo).toBeUndefined();
    expect(parsed.state.ui.dice).toBeUndefined();
    expect(parsed.state.ui.calc).toEqual({ mode: "scientific" });
  });

});

describe("importBackup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("HTMLInputElement", TestInputElement);
  });

  it("rejects invalid backup JSON before touching state", async () => {
    const input = makeInput("{ definitely not json");

    await importBackup(
      { target: input },
      makeImportDeps({
        migrateState: vi.fn(),
        saveAll: vi.fn()
      })
    );

    expect(uiAlert).toHaveBeenCalledWith("That file isn't valid JSON.", { title: "Import failed" });
    expect(input.value).toBe("");
  });

  it("rejects unsupported backup formats before migration or writes", async () => {
    const input = makeInput({
      version: 99,
      state: sanitizeForSave(makeState())
    });
    const deps = makeImportDeps({
      migrateState: vi.fn(),
      saveAll: vi.fn()
    });

    await importBackup({ target: input }, deps);

    expect(uiAlert).toHaveBeenCalledWith("Unsupported backup format.", { title: "Import failed" });
    expect(deps.migrateState).not.toHaveBeenCalled();
    expect(deps.saveAll).not.toHaveBeenCalled();
    expect(input.value).toBe("");
  });

  it("rejects oversized backup files before reading them", async () => {
    const input = makeInput(
      { version: 2, state: sanitizeForSave(makeState()), blobs: {}, texts: {} },
      { size: 15 * 1024 * 1024 + 1 }
    );

    await importBackup({ target: input }, makeImportDeps());

    expect(uiAlert).toHaveBeenCalledWith("Backup file is too large.", { title: "Import failed" });
    expect(input.files[0].text).not.toHaveBeenCalled();
    expect(input.value).toBe("");
  });

  it("rejects unsupported image data before any blob writes", async () => {
    const input = makeInput({
      version: 2,
      state: sanitizeForSave(makeState()),
      blobs: {
        "npc-blob": "data:text/plain;base64,QQ=="
      },
      texts: {}
    });
    const deps = makeImportDeps({
      dataUrlToBlob: vi.fn()
    });

    await importBackup({ target: input }, deps);

    expect(uiAlert).toHaveBeenCalledWith("Backup contains an unsupported image format.", { title: "Import failed" });
    expect(deps.dataUrlToBlob).not.toHaveBeenCalled();
    expect(deps.putBlob).not.toHaveBeenCalled();
    expect(deps.saveAll).not.toHaveBeenCalled();
    expect(input.value).toBe("");
  });

  it("migrates incoming state before applying it", async () => {
    const state = makeState();
    state.tracker.campaignTitle = "Current Campaign";

    const input = makeInput({
      version: 1,
      state: {
        schemaVersion: 1,
        tracker: { campaignTitle: "Legacy Campaign" },
        character: { equipment: "50 ft rope" },
        map: {},
        ui: {}
      }
    });

    await importBackup(
      { target: input },
      makeImportDeps({
        state,
        migrateState
      })
    );

    expect(state.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(state.tracker.campaignTitle).toBe("Legacy Campaign");
    expect(state.character.inventoryItems[0].notes).toBe("50 ft rope");
    expect(uiAlert).toHaveBeenCalledWith(
      "This backup did not include images. Existing portraits were kept.",
      { title: "Import complete" }
    );
    expect(input.value).toBe("");
  });

  it("writes staged blobs and texts before swapping state, then cleans old assets after save", async () => {
    const state = makeState();
    state.tracker.campaignTitle = "Old Campaign";
    state.tracker.npcs = [{ name: "Old NPC", imgBlobId: "old-npc-blob" }];
    state.character.spells.levels = [
      {
        id: "level-old",
        label: "Cantrips",
        hasSlots: false,
        used: null,
        total: null,
        collapsed: false,
        spells: [{ id: "old-spell", name: "Light", notesCollapsed: true, known: true, prepared: false, expended: false }]
      }
    ];

    const importedState = makeState();
    importedState.tracker.campaignTitle = "Imported Campaign";
    importedState.tracker.npcs = [{ name: "New NPC", imgBlobId: "new-npc-blob" }];
    importedState.character.spells.levels = [
      {
        id: "level-new",
        label: "Cantrips",
        hasSlots: false,
        used: null,
        total: null,
        collapsed: false,
        spells: [{ id: "new-spell", name: "Mage Hand", notesCollapsed: true, known: true, prepared: false, expended: false }]
      }
    ];

    const order = [];
    const input = makeInput({
      version: 2,
      state: sanitizeForSave(importedState),
      blobs: {
        "new-npc-blob": "data:image/png;base64,QQ=="
      },
      texts: {
        [textKey_spellNotes("new-spell")]: "Imported spell notes"
      }
    });

    const deleteBlob = vi.fn(async (id) => {
      order.push(`deleteBlob:${id}`);
    });
    const afterImport = vi.fn(async () => {
      order.push("afterImport");
      expect(input.value).toBe("");
    });

    await importBackup(
      { target: input },
      makeImportDeps({
        state,
        migrateState: vi.fn(() => importedState),
        dataUrlToBlob: vi.fn(() => ({ type: "image/png" })),
        putBlob: vi.fn(async () => {
          order.push("putBlob");
          expect(state.tracker.campaignTitle).toBe("Old Campaign");
          return "new-npc-blob";
        }),
        putText: vi.fn(async () => {
          order.push("putText");
          expect(state.tracker.campaignTitle).toBe("Old Campaign");
          return textKey_spellNotes("new-spell");
        }),
        saveAll: vi.fn(async () => {
          order.push("saveAll");
          expect(state.tracker.campaignTitle).toBe("Imported Campaign");
          return true;
        }),
        deleteBlob,
        afterImport
      })
    );

    expect(state.tracker.campaignTitle).toBe("Imported Campaign");
    expect(deleteBlob).toHaveBeenCalledWith("old-npc-blob");
    expect(deleteText).toHaveBeenCalledWith(textKey_spellNotes("old-spell"));
    expect(order).toEqual([
      "putBlob",
      "putText",
      "saveAll",
      "deleteBlob:old-npc-blob",
      "afterImport"
    ]);
  });

  it("rolls state back and deletes newly written blobs when save fails after the swap", async () => {
    const state = makeState();
    state.tracker.campaignTitle = "Old Campaign";
    state.tracker.npcs = [{ name: "Old NPC", imgBlobId: "old-npc-blob" }];

    const importedState = makeState();
    importedState.tracker.campaignTitle = "Imported Campaign";
    importedState.tracker.npcs = [{ name: "Imported NPC", imgBlobId: "new-npc-blob" }];

    const input = makeInput({
      version: 2,
      state: sanitizeForSave(importedState),
      blobs: {
        "new-npc-blob": "data:image/png;base64,QQ=="
      },
      texts: {}
    });

    const putBlob = vi.fn(async (_blob, id) => id);
    const deleteBlob = vi.fn(async () => {});

    await importBackup(
      { target: input },
      makeImportDeps({
        state,
        migrateState: vi.fn(() => importedState),
        saveAll: vi.fn(async () => {
          expect(state.tracker.campaignTitle).toBe("Imported Campaign");
          return false;
        }),
        putBlob,
        deleteBlob,
        dataUrlToBlob: vi.fn(() => ({ type: "image/png" }))
      })
    );

    expect(putBlob).toHaveBeenCalledWith({ type: "image/png" }, "new-npc-blob");
    expect(deleteBlob).toHaveBeenCalledWith("new-npc-blob");
    expect(state.tracker.campaignTitle).toBe("Old Campaign");
    expect(state.tracker.npcs).toEqual([{ name: "Old NPC", imgBlobId: "old-npc-blob" }]);
    expect(uiAlert).toHaveBeenCalledWith(
      "Import failed: could not save. Your previous data has been restored.",
      { title: "Import failed" }
    );
    expect(input.value).toBe("");
  });

  it("cleans up staged blob writes when a later pre-swap step fails", async () => {
    const state = makeState();
    state.tracker.campaignTitle = "Existing Campaign";

    const importedState = makeState();
    importedState.tracker.campaignTitle = "Incoming Campaign";

    const input = makeInput({
      version: 2,
      state: sanitizeForSave(importedState),
      blobs: {
        "blob-a": "data:image/png;base64,QQ==",
        "blob-b": "data:image/png;base64,Qg=="
      },
      texts: {
        [textKey_spellNotes("new-spell")]: "Incoming notes"
      }
    });

    const deleteBlob = vi.fn(async () => {});

    await importBackup(
      { target: input },
      makeImportDeps({
        state,
        migrateState: vi.fn(() => importedState),
        dataUrlToBlob: vi.fn((dataUrl) => ({ dataUrl, type: "image/png" })),
        putBlob: vi.fn(async (_blob, id) => id),
        putText: vi.fn(async () => {
          throw new Error("text write failed");
        }),
        deleteBlob
      })
    );

    expect(deleteBlob).toHaveBeenCalledTimes(2);
    expect(deleteBlob).toHaveBeenNthCalledWith(1, "blob-a");
    expect(deleteBlob).toHaveBeenNthCalledWith(2, "blob-b");
    expect(state.tracker.campaignTitle).toBe("Existing Campaign");
    expect(uiAlert).toHaveBeenCalledWith("Import failed: could not store text data.", { title: "Import failed" });
  });

  it("remaps blob ids when preserving the original id fails", async () => {
    const state = makeState();
    state.tracker.npcs = [{ name: "Before", imgBlobId: "old-live-blob" }];

    const importedState = makeState();
    importedState.tracker.npcs = [{ name: "After", imgBlobId: "incoming-blob" }];

    const input = makeInput({
      version: 2,
      state: sanitizeForSave(importedState),
      blobs: {
        "incoming-blob": "data:image/png;base64,QQ=="
      },
      texts: {}
    });

    const putBlob = vi.fn(async (_blob, id) => {
      if (id === "incoming-blob") throw new Error("id collision");
      return "remapped-blob";
    });
    const deleteBlob = vi.fn(async () => {});

    await importBackup(
      { target: input },
      makeImportDeps({
        state,
        migrateState: vi.fn(() => importedState),
        putBlob,
        deleteBlob,
        dataUrlToBlob: vi.fn(() => ({ type: "image/png" }))
      })
    );

    expect(putBlob).toHaveBeenNthCalledWith(1, { type: "image/png" }, "incoming-blob");
    expect(putBlob).toHaveBeenNthCalledWith(2, { type: "image/png" });
    expect(state.tracker.npcs).toEqual([{ name: "After", imgBlobId: "remapped-blob" }]);
    expect(deleteBlob).toHaveBeenCalledWith("old-live-blob");
    expect(deleteBlob).not.toHaveBeenCalledWith("remapped-blob");
  });

  it("runs success completion behavior after a no-image import", async () => {
    const state = makeState();
    const importedState = makeState();
    importedState.tracker.campaignTitle = "Imported Without Images";

    const input = makeInput({
      version: 2,
      state: sanitizeForSave(importedState),
      blobs: {},
      texts: {}
    });

    const afterImport = vi.fn(async () => {
      expect(input.value).toBe("");
      expect(state.tracker.campaignTitle).toBe("Imported Without Images");
    });

    await importBackup(
      { target: input },
      makeImportDeps({
        state,
        migrateState: vi.fn(() => importedState),
        afterImport
      })
    );

    expect(uiAlert).toHaveBeenCalledWith(
      "This backup did not include images. Existing portraits were kept.",
      { title: "Import complete" }
    );
    expect(afterImport).toHaveBeenCalledTimes(1);
    expect(input.value).toBe("");
  });
});
