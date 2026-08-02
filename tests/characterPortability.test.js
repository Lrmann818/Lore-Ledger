import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../js/storage/blobs.js", () => ({
  blobToDataUrl: vi.fn(async (blob) => `data:${blob.type || "application/octet-stream"};base64,cG9ydHJhaXQ=`),
  dataUrlToBlob: vi.fn((dataUrl) => {
    const mime = String(dataUrl).match(/^data:([^;,]+)/)?.[1] || "application/octet-stream";
    return new Blob(["portrait"], { type: mime });
  })
}));

import {
  EXPORT_FORMAT_TYPE,
  EXPORT_FORMAT_VERSION,
  MAX_IMPORT_FILE_SIZE,
  collectCharacterSpellIds,
  commitImport,
  exportActiveCharacter,
  exportCharacterToObject,
  parseAndValidateImport,
  prepareImportedCharacter,
  validateImportFile
} from "../js/domain/characterPortability.js";
import {
  makeDefaultCharacterBuild,
  makeDefaultCharacterOverrides
} from "../js/domain/characterHelpers.js";
import { migrateState, sanitizeForSave } from "../js/state.js";
import { saveAllLocal } from "../js/storage/persistence.js";
import { blobToDataUrl } from "../js/storage/blobs.js";
import { textKey_spellNotes } from "../js/storage/texts-idb.js";
import { installStateMutationGuard, withAllowedStateMutation } from "../js/utils/dev.js";

const PORTRAIT_DATA_URL = "data:image/webp;base64,cG9ydHJhaXQ=";

function makeCharacter(overrides = {}) {
  return {
    id: "char_original",
    name: "Mira",
    imgBlobId: "portrait-original",
    classLevel: "Wizard 5",
    spells: {
      levels: [
        {
          id: "lvl_0",
          spells: [
            { id: "spell_alpha", name: "Light" },
            { id: "spell_beta", name: "Mage Hand" }
          ]
        }
      ]
    },
    inventoryItems: [{ title: "Inventory", notes: "" }],
    ...overrides
  };
}

function makeExportObject(overrides = {}) {
  return {
    formatVersion: EXPORT_FORMAT_VERSION,
    type: EXPORT_FORMAT_TYPE,
    character: makeCharacter(),
    portrait: { dataUrl: PORTRAIT_DATA_URL, mimeType: "image/webp" },
    spellNotes: {
      spell_alpha: "Use before entering ruins.",
      spell_beta: "For traps."
    },
    ...overrides
  };
}

function makeState(character = makeCharacter()) {
  return {
    appShell: { activeCampaignId: "campaign_alpha" },
    characters: {
      activeId: character.id,
      entries: [character]
    }
  };
}

function makeSaveManager() {
  return { markDirty: vi.fn() };
}

function makeMutateState(state) {
  return vi.fn((mutator) => mutator(state));
}

function makeFile(text, size = text.length) {
  return {
    size,
    text: vi.fn(async () => text)
  };
}

function installLocalStorageMock() {
  let stored = null;
  vi.stubGlobal("localStorage", {
    getItem: vi.fn(() => stored),
    setItem: vi.fn((key, value) => {
      if (!key) throw new Error("missing key");
      stored = String(value);
    })
  });
  return {
    getStoredValue: () => stored
  };
}

function normalizeRoundTripExport(exportObject) {
  return {
    ...exportObject,
    character: {
      ...exportObject.character,
      id: "<regenerated>",
      imgBlobId: exportObject.portrait ? "<portrait>" : null
    }
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("exportCharacterToObject", () => {
  it("exports a character with portrait and spell notes", async () => {
    const character = makeCharacter();
    const portraitBlob = new Blob(["portrait"], { type: "image/webp" });
    const spellNotes = { spell_alpha: "Use before entering ruins." };

    const result = await exportCharacterToObject(character, portraitBlob, spellNotes);

    expect(blobToDataUrl).toHaveBeenCalledWith(portraitBlob);
    expect(result).toEqual({
      formatVersion: EXPORT_FORMAT_VERSION,
      type: EXPORT_FORMAT_TYPE,
      character,
      portrait: {
        dataUrl: PORTRAIT_DATA_URL,
        mimeType: "image/webp"
      },
      spellNotes
    });
    expect(validateImportFile(result)).toEqual({ valid: true });

    result.character.name = "Changed";
    result.spellNotes.spell_alpha = "Changed";
    expect(character.name).toBe("Mira");
    expect(spellNotes.spell_alpha).toBe("Use before entering ruins.");
  });

  it("exports without portrait", async () => {
    const result = await exportCharacterToObject(makeCharacter({ imgBlobId: null }), null, {
      spell_alpha: "Note"
    });

    expect(result.portrait).toBeNull();
    expect(blobToDataUrl).not.toHaveBeenCalled();
  });

  it("exports with no notes", async () => {
    const result = await exportCharacterToObject(makeCharacter(), null);

    expect(result.spellNotes).toEqual({});
  });

  it("exports portable data when the live character has runtime-only fields", async () => {
    const runtimeHandle = () => "not portable";
    const character = makeCharacter({
      runtimeHandle,
      runtimeBucket: new WeakMap(),
      runtimeNested: {
        label: "safe",
        onClick: runtimeHandle
      },
      runtimeList: ["safe", runtimeHandle]
    });

    expect(() => structuredClone(character)).toThrow();

    const result = await exportCharacterToObject(character, null);

    expect(result.character.name).toBe("Mira");
    expect(result.character.runtimeNested).toEqual({ label: "safe" });
    expect(result.character.runtimeList).toEqual(["safe", null]);
    expect(result.character).not.toHaveProperty("runtimeHandle");
    expect(result.character).not.toHaveProperty("runtimeBucket");
    expect(() => JSON.stringify(result.character)).not.toThrow();
  });
});

describe("collectCharacterSpellIds", () => {
  it("collects valid spell ids", () => {
    expect(collectCharacterSpellIds(makeCharacter())).toEqual(["spell_alpha", "spell_beta"]);
  });

  it("is defensive around malformed spell structures", () => {
    expect(collectCharacterSpellIds(null)).toEqual([]);
    expect(collectCharacterSpellIds({})).toEqual([]);
    expect(collectCharacterSpellIds({ spells: null })).toEqual([]);
    expect(collectCharacterSpellIds({ spells: { levels: "bad" } })).toEqual([]);
    expect(collectCharacterSpellIds({
      spells: {
        levels: [
          null,
          { spells: "bad" },
          { spells: [{ id: "" }, { id: 42 }, { id: "  spell_gamma  " }, null] }
        ]
      }
    })).toEqual(["spell_gamma"]);
  });
});

describe("validateImportFile", () => {
  it("rejects invalid format version", () => {
    expect(validateImportFile(makeExportObject({ formatVersion: 0 }))).toEqual({
      valid: false,
      reason: "Unsupported character export format version."
    });
  });

  it("rejects a newer format version clearly", () => {
    expect(validateImportFile(makeExportObject({ formatVersion: 2 }))).toEqual({
      valid: false,
      reason: "This file was created by a newer version of Lore Ledger."
    });
  });

  it("rejects invalid type", () => {
    expect(validateImportFile(makeExportObject({ type: "other-app-character" }))).toEqual({
      valid: false,
      reason: "This is not a Lore Ledger character file."
    });
  });

  it("rejects malformed character objects", () => {
    expect(validateImportFile(makeExportObject({ character: null }))).toMatchObject({ valid: false });
    expect(validateImportFile(makeExportObject({ character: { id: "char_missing_name" } }))).toEqual({
      valid: false,
      reason: "Imported character is missing a name."
    });
  });

  it("tolerates a non-string original imported id", () => {
    expect(validateImportFile(makeExportObject({
      character: makeCharacter({ id: 42 })
    }))).toEqual({ valid: true });
  });

  it("rejects malformed portrait objects", () => {
    expect(validateImportFile(makeExportObject({ portrait: "bad" }))).toEqual({
      valid: false,
      reason: "Imported portrait must be an object or null."
    });
    expect(validateImportFile(makeExportObject({ portrait: { dataUrl: "http://example.test/x.png" } }))).toEqual({
      valid: false,
      reason: "Imported portrait has an invalid data URL."
    });
    expect(validateImportFile(makeExportObject({ portrait: { dataUrl: PORTRAIT_DATA_URL, mimeType: 42 } }))).toEqual({
      valid: false,
      reason: "Imported portrait has an invalid MIME type."
    });
  });

  it("tolerates portrait dataUrl and mimeType mismatch", () => {
    expect(validateImportFile(makeExportObject({
      portrait: {
        dataUrl: "data:image/png;base64,cG9ydHJhaXQ=",
        mimeType: "image/webp"
      }
    }))).toEqual({ valid: true });
  });

  it("rejects malformed spellNotes", () => {
    expect(validateImportFile(makeExportObject({ spellNotes: "bad" }))).toEqual({
      valid: false,
      reason: "Imported spell notes must be an object."
    });
    expect(validateImportFile(makeExportObject({ spellNotes: { spell_alpha: { nested: true } } }))).toEqual({
      valid: false,
      reason: "Imported spell notes must be strings."
    });
    expect(validateImportFile(makeExportObject({ spellNotes: { spell_missing: "No matching spell." } }))).toEqual({
      valid: false,
      reason: "Imported spell notes reference an unknown spell."
    });
  });
});

describe("prepareImportedCharacter", () => {
  it("always regenerates the character id", () => {
    const prepared = prepareImportedCharacter(makeExportObject(), { newBlobId: "new-portrait" });

    expect(prepared.characterEntry.id).not.toBe("char_original");
    expect(prepared.characterEntry.id).toMatch(/^char_/);
    expect(prepared.characterEntry.imgBlobId).toBe("new-portrait");
  });

  it("clears imgBlobId when no portrait is present", () => {
    const prepared = prepareImportedCharacter(makeExportObject({
      character: makeCharacter({ imgBlobId: "old-portrait" }),
      portrait: null,
      spellNotes: {}
    }));

    expect(prepared.characterEntry.imgBlobId).toBeNull();
    expect(prepared.portraitBlob).toBeNull();
  });

  it("passes through spell notes by value", () => {
    const importObject = makeExportObject();
    const prepared = prepareImportedCharacter(importObject, { newBlobId: "new-portrait" });

    expect(prepared.spellNotes).toEqual(importObject.spellNotes);
    expect(prepared.spellNotes).not.toBe(importObject.spellNotes);
  });

  it("preserves Step 3 builder state and overrides while regenerating the character id", () => {
    const build = makeDefaultCharacterBuild();
    const overrides = {
      ...makeDefaultCharacterOverrides(),
      abilities: { str: 1, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
      skills: { athletics: 2 }
    };
    const importObject = makeExportObject({
      character: makeCharacter({ build, overrides }),
      portrait: null,
      spellNotes: {}
    });

    const prepared = prepareImportedCharacter(importObject);

    expect(prepared.characterEntry.id).not.toBe(importObject.character.id);
    expect(prepared.characterEntry.build).toEqual(build);
    expect(prepared.characterEntry.overrides).toEqual(overrides);
    expect(prepared.characterEntry.build).not.toBe(build);
    expect(prepared.characterEntry.overrides).not.toBe(overrides);
  });

  // R5-B2: the acknowledgement record is character data, so a character that
  // moves between campaigns carries the levels it acknowledged with it.
  it("preserves the under-cap acknowledgement record through export and import", async () => {
    const character = makeCharacter({ underCapAckLevels: [1, 3] });
    const exported = await exportCharacterToObject(character, null, {});
    expect(exported.character.underCapAckLevels).toEqual([1, 3]);

    const prepared = prepareImportedCharacter({ ...exported, portrait: null });
    expect(prepared.characterEntry.underCapAckLevels).toEqual([1, 3]);
    expect(prepared.characterEntry.underCapAckLevels)
      .not.toBe(exported.character.underCapAckLevels);

    // Negative control: a character that never acknowledged one gains nothing.
    const plain = prepareImportedCharacter({
      ...(await exportCharacterToObject(makeCharacter(), null, {})),
      portrait: null
    });
    expect(plain.characterEntry.underCapAckLevels).toBeUndefined();
  });
});

describe("exportActiveCharacter", () => {
  it("exports the active character with portrait and non-empty notes", async () => {
    const character = makeCharacter();
    const state = makeState(character);
    const portraitBlob = new Blob(["portrait"], { type: "image/webp" });
    const getBlob = vi.fn(async () => portraitBlob);
    const getText = vi.fn(async (key) => (
      key.endsWith("__spell_alpha") ? "Alpha note" : ""
    ));

    const result = await exportActiveCharacter({ state, getBlob, getText });

    expect(getBlob).toHaveBeenCalledWith("portrait-original");
    expect(getText).toHaveBeenCalledWith(textKey_spellNotes("campaign_alpha", "spell_alpha"));
    expect(getText).toHaveBeenCalledWith(textKey_spellNotes("campaign_alpha", "spell_beta"));
    expect(result.character.id).toBe("char_original");
    expect(result.portrait?.dataUrl).toBe(PORTRAIT_DATA_URL);
    expect(result.spellNotes).toEqual({ spell_alpha: "Alpha note" });
  });
});

describe("parseAndValidateImport", () => {
  it("returns the parsed object for a valid file", async () => {
    const importObject = makeExportObject();

    await expect(parseAndValidateImport(makeFile(JSON.stringify(importObject)))).resolves.toEqual(importObject);
  });

  it("throws a clear error for invalid JSON", async () => {
    await expect(parseAndValidateImport(makeFile("{not json"))).rejects.toThrow("Invalid JSON file.");
  });

  it("throws validation failures", async () => {
    const invalid = makeExportObject({ type: "wrong" });

    await expect(parseAndValidateImport(makeFile(JSON.stringify(invalid)))).rejects.toThrow(
      "This is not a Lore Ledger character file."
    );
  });

  it("rejects oversized files before reading them", async () => {
    const file = makeFile("{}", MAX_IMPORT_FILE_SIZE + 1);

    await expect(parseAndValidateImport(file)).rejects.toThrow("Import file is too large.");
    expect(file.text).not.toHaveBeenCalled();
  });
});

describe("commitImport", () => {
  it("commits a valid import, stores the portrait, activates the character, and writes notes", async () => {
    const importObject = makeExportObject();
    const state = makeState(makeCharacter({ id: "char_existing", name: "Existing" }));
    const SaveManager = makeSaveManager();
    const putBlob = vi.fn(async () => "new-portrait");
    const deleteBlob = vi.fn(async () => {});
    const putText = vi.fn(async () => {});
    const dataUrlToBlob = vi.fn(() => new Blob(["portrait"], { type: "image/webp" }));
    const mutateState = makeMutateState(state);

    const newId = await commitImport(importObject, {
      state,
      SaveManager,
      putBlob,
      deleteBlob,
      putText,
      dataUrlToBlob,
      mutateState
    });

    expect(dataUrlToBlob).toHaveBeenCalledWith(PORTRAIT_DATA_URL);
    expect(putBlob).toHaveBeenCalledTimes(1);
    expect(state.characters.entries).toHaveLength(2);
    expect(state.characters.entries[1]).toMatchObject({
      id: newId,
      name: "Mira",
      imgBlobId: "new-portrait"
    });
    expect(state.characters.activeId).toBe(newId);
    expect(SaveManager.markDirty).toHaveBeenCalledTimes(1);
    expect(putText).toHaveBeenCalledWith(
      "Use before entering ruins.",
      textKey_spellNotes("campaign_alpha", "spell_alpha")
    );
    expect(putText).toHaveBeenCalledWith("For traps.", textKey_spellNotes("campaign_alpha", "spell_beta"));
    expect(deleteBlob).not.toHaveBeenCalled();
  });

  it("imports into guarded runtime state and lets the post-commit persistence snapshot save", async () => {
    const { getStoredValue } = installLocalStorageMock();
    const runtimeState = migrateState(undefined);
    runtimeState.appShell.activeCampaignId = "campaign_alpha";
    runtimeState.tracker.campaignTitle = "Alpha";
    runtimeState.characters = { activeId: null, entries: [] };

    const guardedState = installStateMutationGuard(runtimeState, { mode: "throw" }).state;
    const vaultRuntime = { current: null };
    const SaveManager = {
      markDirty: vi.fn(() => {
        const ok = saveAllLocal({
          storageKey: "test-storage",
          state: guardedState,
          migrateState,
          sanitizeForSave,
          vaultRuntime
        });
        expect(ok).toBe(true);
      })
    };

    const importObject = makeExportObject({
      portrait: null,
      spellNotes: {}
    });

    const newId = await commitImport(importObject, {
      state: guardedState,
      SaveManager,
      putBlob: vi.fn(async () => "unused"),
      deleteBlob: vi.fn(async () => {}),
      putText: vi.fn(async () => {}),
      dataUrlToBlob: vi.fn(() => new Blob(["portrait"], { type: "image/webp" })),
      mutateState: vi.fn((mutator) => withAllowedStateMutation(() => mutator(guardedState)))
    });

    const stored = JSON.parse(getStoredValue());
    expect(SaveManager.markDirty).toHaveBeenCalledTimes(1);
    expect(guardedState.characters.activeId).toBe(newId);
    expect(stored.campaignDocs.campaign_alpha.characters.activeId).toBe(newId);
    expect(stored.campaignDocs.campaign_alpha.characters.entries[0]).toMatchObject({
      id: newId,
      name: "Mira",
      imgBlobId: null
    });
  });

  it("leaves no partial state when putBlob fails", async () => {
    const importObject = makeExportObject();
    const state = makeState(makeCharacter({ id: "char_existing", name: "Existing" }));
    const before = structuredClone(state.characters);
    const SaveManager = makeSaveManager();
    const putBlob = vi.fn(async () => {
      throw new Error("quota");
    });
    const deleteBlob = vi.fn(async () => {});
    const putText = vi.fn(async () => {});
    const dataUrlToBlob = vi.fn(() => new Blob(["portrait"], { type: "image/webp" }));
    const mutateState = makeMutateState(state);

    await expect(commitImport(importObject, {
      state,
      SaveManager,
      putBlob,
      deleteBlob,
      putText,
      dataUrlToBlob,
      mutateState
    })).rejects.toThrow("Failed to store portrait.");

    expect(state.characters).toEqual(before);
    expect(mutateState).not.toHaveBeenCalled();
    expect(deleteBlob).not.toHaveBeenCalled();
    expect(SaveManager.markDirty).not.toHaveBeenCalled();
    expect(putText).not.toHaveBeenCalled();
  });

  it("cleans up the portrait blob when state mutation fails", async () => {
    const importObject = makeExportObject();
    const state = makeState(makeCharacter({ id: "char_existing", name: "Existing" }));
    const before = structuredClone(state.characters);
    const SaveManager = makeSaveManager();
    const putBlob = vi.fn(async () => "new-portrait");
    const deleteBlob = vi.fn(async () => {});
    const putText = vi.fn(async () => {});
    const dataUrlToBlob = vi.fn(() => new Blob(["portrait"], { type: "image/webp" }));
    const mutateState = vi.fn((mutator) => {
      mutator(state);
      throw new Error("mutation failed");
    });

    await expect(commitImport(importObject, {
      state,
      SaveManager,
      putBlob,
      deleteBlob,
      putText,
      dataUrlToBlob,
      mutateState
    })).rejects.toThrow("mutation failed");

    expect(state.characters).toEqual(before);
    expect(deleteBlob).toHaveBeenCalledWith("new-portrait");
    expect(SaveManager.markDirty).not.toHaveBeenCalled();
    expect(putText).not.toHaveBeenCalled();
  });

  it("does not roll back the character when a notes write fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const importObject = makeExportObject();
    const state = makeState(makeCharacter({ id: "char_existing", name: "Existing" }));
    const SaveManager = makeSaveManager();
    const putBlob = vi.fn(async () => "new-portrait");
    const deleteBlob = vi.fn(async () => {});
    const putText = vi.fn(async (text) => {
      if (text === "Use before entering ruins.") throw new Error("text store failed");
    });
    const dataUrlToBlob = vi.fn(() => new Blob(["portrait"], { type: "image/webp" }));
    const mutateState = makeMutateState(state);

    const newId = await commitImport(importObject, {
      state,
      SaveManager,
      putBlob,
      deleteBlob,
      putText,
      dataUrlToBlob,
      mutateState
    });

    expect(state.characters.entries.some((entry) => entry.id === newId)).toBe(true);
    expect(state.characters.activeId).toBe(newId);
    expect(deleteBlob).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("allows duplicate character names because ids are regenerated", async () => {
    const importObject = makeExportObject({
      character: makeCharacter({ id: "char_source", name: "Mira" }),
      portrait: null,
      spellNotes: {}
    });
    const state = makeState(makeCharacter({ id: "char_existing", name: "Mira", imgBlobId: null }));
    const SaveManager = makeSaveManager();

    const newId = await commitImport(importObject, {
      state,
      SaveManager,
      putBlob: vi.fn(async () => "unused"),
      deleteBlob: vi.fn(async () => {}),
      putText: vi.fn(async () => {}),
      dataUrlToBlob: vi.fn(() => new Blob(["portrait"], { type: "image/webp" })),
      mutateState: makeMutateState(state)
    });

    expect(state.characters.entries.map((entry) => entry.name)).toEqual(["Mira", "Mira"]);
    expect(state.characters.entries.map((entry) => entry.id)).toEqual(["char_existing", newId]);
    expect(newId).not.toBe("char_source");
  });

  it("initializes missing character entries before pushing an import", async () => {
    const importObject = makeExportObject({
      character: makeCharacter({ id: 123, name: "Mira" }),
      portrait: null,
      spellNotes: {}
    });
    const state = {
      appShell: { activeCampaignId: "campaign_alpha" },
      characters: { activeId: "stale", entries: null }
    };
    const SaveManager = makeSaveManager();

    const newId = await commitImport(importObject, {
      state,
      SaveManager,
      putBlob: vi.fn(async () => "unused"),
      deleteBlob: vi.fn(async () => {}),
      putText: vi.fn(async () => {}),
      dataUrlToBlob: vi.fn(() => new Blob(["portrait"], { type: "image/webp" })),
      mutateState: makeMutateState(state)
    });

    expect(state.characters.entries).toHaveLength(1);
    expect(state.characters.entries[0]).toMatchObject({ id: newId, name: "Mira", imgBlobId: null });
    expect(state.characters.activeId).toBe(newId);
    expect(SaveManager.markDirty).toHaveBeenCalledTimes(1);
  });
});

describe("character portability round trip", () => {
  it("exports, imports, and exports equivalent data modulo regenerated ids", async () => {
    const originalCharacter = makeCharacter();
    const firstExport = await exportCharacterToObject(
      originalCharacter,
      new Blob(["portrait"], { type: "image/webp" }),
      { spell_alpha: "Use before entering ruins." }
    );
    const state = {
      appShell: { activeCampaignId: "campaign_beta" },
      characters: { activeId: null, entries: [] }
    };
    const blobStore = new Map();
    const textStore = new Map();
    const SaveManager = makeSaveManager();

    const newId = await commitImport(firstExport, {
      state,
      SaveManager,
      putBlob: vi.fn(async (blob) => {
        blobStore.set("new-portrait", blob);
        return "new-portrait";
      }),
      deleteBlob: vi.fn(async (id) => {
        blobStore.delete(id);
      }),
      putText: vi.fn(async (text, id) => {
        textStore.set(id, text);
      }),
      dataUrlToBlob: vi.fn(() => new Blob(["portrait"], { type: "image/webp" })),
      mutateState: makeMutateState(state)
    });

    const secondExport = await exportActiveCharacter({
      state,
      getBlob: vi.fn(async (id) => blobStore.get(id) || null),
      getText: vi.fn(async (id) => textStore.get(id) || "")
    });

    expect(newId).not.toBe(originalCharacter.id);
    expect(normalizeRoundTripExport(secondExport)).toEqual(normalizeRoundTripExport(firstExport));
  });

  it("round-trips Step 3 build and overrides without changing the export format version", async () => {
    const build = {
      ...makeDefaultCharacterBuild(),
      raceId: "race_human",
      classId: "class_fighter",
      backgroundId: "background_soldier",
      level: 4,
      abilities: { base: { str: 15, dex: 14, con: 13, int: 10, wis: 8, cha: 12 } },
      choicesByLevel: { 1: { fightingStyle: "defense" } }
    };
    const overrides = {
      ...makeDefaultCharacterOverrides(),
      abilities: { str: 1, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
      saves: { str: 2, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
      skills: { athletics: 1 },
      initiative: 1
    };
    const originalCharacter = makeCharacter({ build, overrides, imgBlobId: null });
    const firstExport = await exportCharacterToObject(originalCharacter, null, {});
    const state = {
      appShell: { activeCampaignId: "campaign_gamma" },
      characters: { activeId: null, entries: [] }
    };

    const newId = await commitImport(firstExport, {
      state,
      SaveManager: makeSaveManager(),
      putBlob: vi.fn(async () => "unused"),
      deleteBlob: vi.fn(async () => {}),
      putText: vi.fn(async () => {}),
      dataUrlToBlob: vi.fn(() => new Blob(["portrait"], { type: "image/webp" })),
      mutateState: makeMutateState(state)
    });
    const secondExport = await exportActiveCharacter({
      state,
      getBlob: vi.fn(async () => null),
      getText: vi.fn(async () => "")
    });

    expect(EXPORT_FORMAT_VERSION).toBe(1);
    expect(firstExport.character.build).toEqual(build);
    expect(firstExport.character.overrides).toEqual(overrides);
    expect(newId).not.toBe(originalCharacter.id);
    expect(secondExport.character.id).toBe(newId);
    expect(secondExport.character.build).toEqual(build);
    expect(secondExport.character.overrides).toEqual(overrides);
  });
});

describe("bundled custom content (matrix #17)", () => {
  const customClass = {
    id: "runeweaver",
    kind: "class",
    name: "Runeweaver",
    source: "custom",
    hitDie: 8
  };
  const customSpell = {
    id: "rune-bolt",
    kind: "spell",
    name: "Rune Bolt",
    source: "custom",
    level: 1
  };
  const unrelatedCustom = {
    id: "sky-elf",
    kind: "race",
    name: "Sky Elf",
    source: "custom"
  };

  function makeCustomBuilderCharacter() {
    const character = makeCharacter({
      build: {
        ...makeDefaultCharacterBuild(),
        levels: [{ classId: "runeweaver", hp: null }],
        spellcasting: { runeweaver: { cantripIds: [], knownIds: ["rune-bolt"], preparedIds: [] } }
      }
    });
    return character;
  }

  function makeStateWithCustom(character) {
    const state = makeState(character);
    state.content = { custom: [customClass, customSpell, unrelatedCustom] };
    return state;
  }

  it("exports only the custom records the character references", async () => {
    const character = makeCustomBuilderCharacter();
    const state = makeStateWithCustom(character);
    const exported = await exportActiveCharacter({
      state,
      getBlob: vi.fn(async () => null),
      getText: vi.fn(async () => "")
    });

    expect(exported.customContent.map((record) => record.id).sort()).toEqual(["rune-bolt", "runeweaver"]);
    expect(exported.customContent.map((record) => record.id)).not.toContain("sky-elf");
  });

  it("omits the customContent field entirely when nothing custom is referenced", async () => {
    const character = makeCharacter();
    const state = makeStateWithCustom(character);
    const exported = await exportActiveCharacter({
      state,
      getBlob: vi.fn(async () => null),
      getText: vi.fn(async () => "")
    });
    expect(exported.customContent).toBeUndefined();
  });

  it("rejects a malformed customContent field at validation", () => {
    expect(validateImportFile(makeExportObject({ customContent: "nope" })).valid).toBe(false);
    expect(validateImportFile(makeExportObject({ customContent: [42] })).valid).toBe(false);
    expect(validateImportFile(makeExportObject({ customContent: [] })).valid).toBe(true);
    expect(validateImportFile(makeExportObject({ customContent: [customClass] })).valid).toBe(true);
  });

  it("adopts missing bundled records on import and keeps existing ones as-is", async () => {
    const destination = makeState(makeCharacter({ id: "char_existing" }));
    const existingRuneweaver = { ...customClass, name: "Runeweaver (house rules)" };
    destination.content = { custom: [existingRuneweaver] };
    const importObject = makeExportObject({
      character: makeCustomBuilderCharacter(),
      portrait: null,
      spellNotes: {},
      customContent: [customClass, customSpell]
    });

    const newId = await commitImport(importObject, {
      state: destination,
      SaveManager: makeSaveManager(),
      putBlob: vi.fn(async () => "blob_new"),
      deleteBlob: vi.fn(),
      putText: vi.fn(),
      dataUrlToBlob: vi.fn(),
      mutateState: makeMutateState(destination)
    });

    expect(typeof newId).toBe("string");
    const ids = destination.content.custom.map((record) => `${record.kind}:${record.id}`);
    expect(ids).toContain("class:runeweaver");
    expect(ids).toContain("spell:rune-bolt");
    // The destination's existing record is preserved, not overwritten.
    const runeweaver = destination.content.custom.find((record) => record.id === "runeweaver");
    expect(runeweaver.name).toBe("Runeweaver (house rules)");
    expect(destination.content.custom).toHaveLength(2);
  });

  it("skips invalid bundled records without failing the character import", async () => {
    const destination = makeState(makeCharacter({ id: "char_existing" }));
    const importObject = makeExportObject({
      portrait: null,
      spellNotes: {},
      customContent: [
        { id: "Bad Id!", kind: "class", name: "Broken" },
        customSpell
      ]
    });

    const newId = await commitImport(importObject, {
      state: destination,
      SaveManager: makeSaveManager(),
      putBlob: vi.fn(async () => "blob_new"),
      deleteBlob: vi.fn(),
      putText: vi.fn(),
      dataUrlToBlob: vi.fn(),
      mutateState: makeMutateState(destination)
    });

    expect(typeof newId).toBe("string");
    expect(destination.characters.entries).toHaveLength(2);
    const ids = destination.content.custom.map((record) => record.id);
    expect(ids).toEqual(["rune-bolt"]);
  });

  it("imports legacy files without a customContent field unchanged", async () => {
    const destination = makeState(makeCharacter({ id: "char_existing" }));
    const importObject = makeExportObject({ portrait: null, spellNotes: {} });
    delete importObject.customContent;

    const newId = await commitImport(importObject, {
      state: destination,
      SaveManager: makeSaveManager(),
      putBlob: vi.fn(async () => "blob_new"),
      deleteBlob: vi.fn(),
      putText: vi.fn(),
      dataUrlToBlob: vi.fn(),
      mutateState: makeMutateState(destination)
    });

    expect(typeof newId).toBe("string");
    expect(destination.content).toBeUndefined();
  });
});
