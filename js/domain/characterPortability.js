// @ts-check
// js/domain/characterPortability.js — character import/export foundation

import { blobToDataUrl, dataUrlToBlob as defaultDataUrlToBlob } from "../storage/blobs.js";
import { textKey_spellNotes } from "../storage/texts-idb.js";
import { getActiveCharacter, makeDefaultCharacterEntry } from "./characterHelpers.js";
import { addCustomContentRecords, listCustomContent } from "./customContent.js";

export const EXPORT_FORMAT_VERSION = 1;
export const EXPORT_FORMAT_TYPE = "lore-ledger-character";

/**
 * UX/safety guard for user-selected character import files. This prevents
 * accidentally reading huge portrait bundles in the UI; it is not a schema
 * or architectural file-format limit.
 */
export const MAX_IMPORT_FILE_SIZE = 10 * 1024 * 1024;

/**
 * @typedef {import("../state.js").CharacterEntry} CharacterEntry
 * @typedef {Record<string, string>} SpellNotesMap
 * @typedef {{
 *   formatVersion: number,
 *   type: string,
 *   character: CharacterEntry,
 *   portrait: { dataUrl: string, mimeType: string } | null,
 *   spellNotes: SpellNotesMap,
 *   customContent?: Array<Record<string, unknown>>
 * }} CharacterExportObject
 */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * @template T
 * @param {T} value
 * @returns {T}
 */
function cloneJsonSafe(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

/**
 * @param {unknown} value
 * @param {WeakSet<object>} [seen]
 * @returns {unknown}
 */
function normalizePortableData(value, seen = new WeakSet()) {
  if (value === null) return null;

  const valueType = typeof value;
  if (valueType === "string" || valueType === "boolean") return value;
  if (valueType === "number") return Number.isFinite(value) ? value : null;
  if (valueType !== "object") return undefined;

  if (seen.has(value)) return undefined;
  seen.add(value);

  if (Array.isArray(value)) {
    const out = value.map((item) => {
      const normalized = normalizePortableData(item, seen);
      return normalized === undefined ? null : normalized;
    });
    seen.delete(value);
    return out;
  }

  if (!isPlainObject(value)) {
    seen.delete(value);
    return undefined;
  }

  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    const normalized = normalizePortableData(item, seen);
    if (normalized !== undefined) out[key] = normalized;
  }
  seen.delete(value);
  return out;
}

/**
 * @param {unknown} value
 * @returns {string | null}
 */
function cleanString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

/**
 * @param {unknown} stateLike
 * @returns {string | null}
 */
function getActiveCampaignId(stateLike) {
  if (!isPlainObject(stateLike) || !isPlainObject(stateLike.appShell)) return null;
  return cleanString(stateLike.appShell.activeCampaignId);
}

/**
 * @param {unknown} notes
 * @returns {SpellNotesMap}
 */
function normalizeSpellNotes(notes) {
  if (!isPlainObject(notes)) return {};
  /** @type {SpellNotesMap} */
  const out = {};
  for (const [spellId, noteText] of Object.entries(notes)) {
    if (typeof noteText === "string") out[spellId] = noteText;
  }
  return out;
}

/**
 * @param {CharacterEntry} character
 * @param {Blob | null | undefined} portraitBlob
 * @param {SpellNotesMap | null | undefined} spellNotes
 * @param {Array<Record<string, unknown>>} [customContent] referenced campaign
 *   custom records to bundle so the character survives import into a
 *   campaign that lacks them (matrix #17)
 * @returns {Promise<CharacterExportObject>}
 */
export async function exportCharacterToObject(character, portraitBlob = null, spellNotes = {}, customContent = []) {
  const clonedCharacter = /** @type {CharacterEntry} */ (normalizePortableData(character) || {});
  const clonedNotes = cloneJsonSafe(normalizeSpellNotes(spellNotes));
  const portrait = portraitBlob
    ? {
      dataUrl: await blobToDataUrl(portraitBlob),
      mimeType: portraitBlob.type || "application/octet-stream"
    }
    : null;

  return {
    formatVersion: EXPORT_FORMAT_VERSION,
    type: EXPORT_FORMAT_TYPE,
    character: clonedCharacter,
    portrait,
    spellNotes: clonedNotes,
    ...(Array.isArray(customContent) && customContent.length ? { customContent } : {})
  };
}

/**
 * The campaign custom records this character's build/play-state actually
 * references: race/subrace/background/class/subclass ids, chosen feats,
 * spell selections (build, prepared play-state, and builder-managed sheet
 * rows), and equipment ids. Only records persisted in `state.content.custom`
 * are returned — builtin SRD content never needs bundling.
 *
 * @param {unknown} character
 * @param {unknown} state
 * @returns {Array<Record<string, unknown>>}
 */
export function collectReferencedCustomContent(character, state) {
  const custom = listCustomContent(/** @type {import("../state.js").State} */ (state));
  if (!custom.length || !isPlainObject(character)) return [];

  /** @type {Set<string>} */
  const refs = new Set();
  /**
   * @param {string} kind
   * @param {unknown} id
   */
  const add = (kind, id) => {
    const clean = typeof id === "string" ? id.trim() : "";
    if (clean) refs.add(`${kind}:${clean}`);
  };

  const build = isPlainObject(character.build) ? character.build : null;
  if (build) {
    add("race", build.raceId);
    add("subrace", build.subraceId);
    add("background", build.backgroundId);
    add("class", build.classId); // legacy v1 builds
    for (const row of Array.isArray(build.levels) ? build.levels : []) {
      if (isPlainObject(row)) add("class", row.classId);
    }
    if (isPlainObject(build.subclassByClass)) {
      for (const subclassId of Object.values(build.subclassByClass)) add("subclass", subclassId);
    }
    if (isPlainObject(build.choicesByLevel)) {
      for (const levelChoices of Object.values(build.choicesByLevel)) {
        if (!isPlainObject(levelChoices)) continue;
        for (const [choiceId, value] of Object.entries(levelChoices)) {
          if (choiceId.startsWith("asi-") && isPlainObject(value) && value.type === "feat") {
            add("feat", value.featId);
          }
        }
      }
    }
    if (isPlainObject(build.spellcasting)) {
      for (const selection of Object.values(build.spellcasting)) {
        if (!isPlainObject(selection)) continue;
        for (const key of ["cantripIds", "knownIds", "preparedIds"]) {
          const ids = selection[key];
          for (const id of Array.isArray(ids) ? ids : []) add("spell", id);
        }
      }
    }
    if (isPlainObject(build.equipment)) {
      add("armor", build.equipment.armorId);
      const weaponIds = build.equipment.weaponIds;
      for (const id of Array.isArray(weaponIds) ? weaponIds : []) add("weapon", id);
    }
  }

  const rest = isPlainObject(character.rest) ? character.rest : null;
  if (rest && isPlainObject(rest.preparedByClass)) {
    for (const ids of Object.values(rest.preparedByClass)) {
      for (const id of Array.isArray(ids) ? ids : []) add("spell", id);
    }
  }
  const spells = isPlainObject(character.spells) ? character.spells : null;
  for (const level of Array.isArray(spells?.levels) ? spells.levels : []) {
    if (!isPlainObject(level) || !Array.isArray(level.spells)) continue;
    for (const spell of level.spells) {
      if (isPlainObject(spell)) add("spell", spell.builderSpellId);
    }
  }

  return custom
    .filter((record) => refs.has(`${record.kind}:${record.id}`))
    .map((record) => /** @type {Record<string, unknown>} */ (normalizePortableData(record)));
}

/**
 * @param {unknown} character
 * @returns {string[]}
 */
export function collectCharacterSpellIds(character) {
  if (!isPlainObject(character)) return [];
  const spells = isPlainObject(character.spells) ? character.spells : null;
  const levels = Array.isArray(spells?.levels) ? spells.levels : [];
  /** @type {string[]} */
  const ids = [];

  for (const level of levels) {
    if (!isPlainObject(level) || !Array.isArray(level.spells)) continue;
    for (const spell of level.spells) {
      if (!isPlainObject(spell)) continue;
      if (typeof spell.id !== "string") continue;
      const spellId = spell.id.trim();
      if (spellId) ids.push(spellId);
    }
  }

  return ids;
}

/**
 * @param {unknown} json
 * @returns {{ valid: true } | { valid: false, reason: string }}
 */
export function validateImportFile(json) {
  if (!isPlainObject(json)) {
    return { valid: false, reason: "Import file must be an object." };
  }
  if (json.formatVersion !== EXPORT_FORMAT_VERSION) {
    if (typeof json.formatVersion === "number" && json.formatVersion > EXPORT_FORMAT_VERSION) {
      return { valid: false, reason: "This file was created by a newer version of Lore Ledger." };
    }
    return { valid: false, reason: "Unsupported character export format version." };
  }
  if (json.type !== EXPORT_FORMAT_TYPE) {
    return { valid: false, reason: "This is not a Lore Ledger character file." };
  }
  if (!isPlainObject(json.character)) {
    return { valid: false, reason: "Imported character must be an object." };
  }
  if (typeof json.character.name !== "string") {
    return { valid: false, reason: "Imported character is missing a name." };
  }

  const portrait = json.portrait;
  if (portrait !== undefined && portrait !== null) {
    if (!isPlainObject(portrait)) {
      return { valid: false, reason: "Imported portrait must be an object or null." };
    }
    if (typeof portrait.dataUrl !== "string" || !portrait.dataUrl.startsWith("data:")) {
      return { valid: false, reason: "Imported portrait has an invalid data URL." };
    }
    if (portrait.mimeType !== undefined && typeof portrait.mimeType !== "string") {
      return { valid: false, reason: "Imported portrait has an invalid MIME type." };
    }
  }

  if (json.spellNotes !== undefined) {
    if (!isPlainObject(json.spellNotes)) {
      return { valid: false, reason: "Imported spell notes must be an object." };
    }
    const knownSpellIds = new Set(collectCharacterSpellIds(json.character));
    for (const [spellId, noteText] of Object.entries(json.spellNotes)) {
      if (!spellId.trim()) {
        return { valid: false, reason: "Imported spell notes include an invalid spell id." };
      }
      if (typeof noteText !== "string") {
        return { valid: false, reason: "Imported spell notes must be strings." };
      }
      if (!knownSpellIds.has(spellId)) {
        return { valid: false, reason: "Imported spell notes reference an unknown spell." };
      }
    }
  }

  if (json.customContent !== undefined) {
    if (!Array.isArray(json.customContent) || json.customContent.some((record) => !isPlainObject(record))) {
      return { valid: false, reason: "Bundled custom content must be an array of records." };
    }
  }

  return { valid: true };
}

/**
 * @param {CharacterExportObject} importObject
 * @param {{
 *   newBlobId?: string | null,
 *   portraitBlob?: Blob | null,
 *   dataUrlToBlob?: typeof defaultDataUrlToBlob
 * }} [options]
 * @returns {{ characterEntry: CharacterEntry, portraitBlob: Blob | null, spellNotes: SpellNotesMap }}
 */
export function prepareImportedCharacter(importObject, options = {}) {
  const validation = validateImportFile(importObject);
  if (validation.valid === false) throw new Error(validation.reason);

  const { newBlobId = null, portraitBlob = null, dataUrlToBlob = defaultDataUrlToBlob } = options;
  const hasPortrait = !!importObject.portrait;
  if (hasPortrait && typeof newBlobId !== "string") {
    throw new Error("Imported portrait is missing a stored blob id.");
  }

  const characterEntry = cloneJsonSafe(importObject.character);
  characterEntry.id = makeDefaultCharacterEntry(characterEntry.name || "New Character").id;
  characterEntry.imgBlobId = hasPortrait ? newBlobId : null;

  const preparedPortraitBlob = hasPortrait
    ? (portraitBlob || dataUrlToBlob(importObject.portrait.dataUrl))
    : null;

  return {
    characterEntry,
    portraitBlob: preparedPortraitBlob,
    spellNotes: cloneJsonSafe(normalizeSpellNotes(importObject.spellNotes))
  };
}

/**
 * @param {{
 *   state: unknown,
 *   getBlob: (id: string) => Promise<Blob | null>,
 *   getText: (id: string) => Promise<string>
 * }} deps
 * @returns {Promise<CharacterExportObject>}
 */
export async function exportActiveCharacter({ state, getBlob, getText }) {
  if (typeof getBlob !== "function") throw new Error("exportActiveCharacter: getBlob is required.");
  if (typeof getText !== "function") throw new Error("exportActiveCharacter: getText is required.");

  const character = getActiveCharacter(/** @type {any} */ (state));
  if (!character) throw new Error("No active character.");

  const campaignId = getActiveCampaignId(state);
  if (!campaignId) throw new Error("No active campaign.");

  const portraitBlob = character.imgBlobId ? await getBlob(character.imgBlobId) : null;
  /** @type {SpellNotesMap} */
  const spellNotes = {};
  for (const spellId of Array.from(new Set(collectCharacterSpellIds(character)))) {
    const noteText = await getText(textKey_spellNotes(campaignId, spellId));
    if (typeof noteText === "string" && noteText !== "") {
      spellNotes[spellId] = noteText;
    }
  }

  const customContent = collectReferencedCustomContent(character, state);
  return exportCharacterToObject(character, portraitBlob, spellNotes, customContent);
}

/**
 * @param {{ size?: number, text?: () => Promise<string> }} file
 * @returns {Promise<CharacterExportObject>}
 */
export async function parseAndValidateImport(file) {
  if (!file || typeof file.text !== "function") {
    throw new Error("Could not read import file.");
  }
  if (typeof file.size === "number" && file.size > MAX_IMPORT_FILE_SIZE) {
    throw new Error("Import file is too large.");
  }

  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch (_) {
    throw new Error("Invalid JSON file.");
  }

  const validation = validateImportFile(parsed);
  if (validation.valid === false) throw new Error(validation.reason);
  return /** @type {CharacterExportObject} */ (parsed);
}

/**
 * @param {unknown} state
 * @returns {unknown}
 */
function snapshotCharacters(state) {
  return normalizePortableData(isPlainObject(state) ? state.characters : null);
}

/**
 * @param {unknown} state
 * @param {unknown} snapshot
 * @returns {void}
 */
function restoreCharacters(state, snapshot) {
  if (isPlainObject(state)) {
    state.characters = snapshot;
  }
}

/**
 * @param {string | null} blobId
 * @param {(id: string) => Promise<void>} deleteBlob
 * @returns {Promise<void>}
 */
async function cleanupBlob(blobId, deleteBlob) {
  if (!blobId) return;
  try {
    await deleteBlob(blobId);
  } catch (err) {
    console.warn("commitImport: failed to clean up staged portrait blob.", err);
  }
}

/**
 * @param {CharacterExportObject} importObject
 * @param {{
 *   state: unknown,
 *   SaveManager: { markDirty: () => unknown },
 *   putBlob: (blob: Blob) => Promise<string>,
 *   deleteBlob: (id: string) => Promise<void>,
 *   putText: (text: string, id: string) => Promise<unknown>,
 *   dataUrlToBlob: typeof defaultDataUrlToBlob,
 *   mutateState: (mutator: (state: any) => unknown, options?: { queueSave?: boolean }) => unknown
 * }} deps
 * @returns {Promise<string>}
 */
export async function commitImport(importObject, deps) {
  const validation = validateImportFile(importObject);
  if (validation.valid === false) throw new Error(validation.reason);

  const {
    state,
    SaveManager,
    putBlob,
    deleteBlob,
    putText,
    dataUrlToBlob,
    mutateState
  } = deps || {};

  if (typeof SaveManager?.markDirty !== "function") throw new Error("commitImport: SaveManager.markDirty is required.");
  if (typeof putBlob !== "function") throw new Error("commitImport: putBlob is required.");
  if (typeof deleteBlob !== "function") throw new Error("commitImport: deleteBlob is required.");
  if (typeof putText !== "function") throw new Error("commitImport: putText is required.");
  if (typeof dataUrlToBlob !== "function") throw new Error("commitImport: dataUrlToBlob is required.");
  if (typeof mutateState !== "function") throw new Error("commitImport: mutateState is required.");

  const campaignId = getActiveCampaignId(state);
  if (!campaignId) throw new Error("No active campaign.");

  let portraitBlob = null;
  let newBlobId = null;
  if (importObject.portrait) {
    try {
      portraitBlob = dataUrlToBlob(importObject.portrait.dataUrl);
      newBlobId = await putBlob(portraitBlob);
    } catch (err) {
      throw new Error("Failed to store portrait.", { cause: err });
    }
  }

  const prepared = prepareImportedCharacter(importObject, {
    newBlobId,
    portraitBlob,
    dataUrlToBlob
  });

  const previousCharacters = snapshotCharacters(state);
  const hadContentBucket = isPlainObject(state) && isPlainObject(state.content);
  const previousCustomContent = hadContentBucket
    ? normalizePortableData(/** @type {{ content: { custom?: unknown } }} */ (state).content.custom)
    : null;
  const bundledCustomContent = Array.isArray(importObject.customContent) ? importObject.customContent : [];
  try {
    const result = mutateState((draft) => {
      if (!isPlainObject(draft)) throw new Error("Character collection is unavailable.");
      // Adopt bundled custom records first so the imported character's build
      // resolves immediately. Records that already exist (same kind:id) or
      // would shadow builtin content are skipped — the destination campaign's
      // content always wins; genuinely malformed records are skipped loudly.
      if (bundledCustomContent.length) {
        const adoption = addCustomContentRecords(
          /** @type {import("../state.js").State} */ (draft),
          bundledCustomContent.map((record) => cloneJsonSafe(record))
        );
        for (const failure of adoption.errors) {
          const expectedSkip = failure.errors.every((message) => message.includes("already exists"));
          if (!expectedSkip) {
            console.warn(
              `commitImport: skipped bundled custom record ${failure.index + 1}: ${failure.errors.join(" ")}`
            );
          }
        }
      }
      if (!isPlainObject(draft.characters)) {
        draft.characters = { activeId: null, entries: [] };
      }
      const characters = /** @type {{ activeId: string | null, entries?: unknown }} */ (draft.characters);
      if (!Array.isArray(characters.entries)) {
        characters.entries = [];
      }
      const entries = /** @type {CharacterEntry[]} */ (characters.entries);
      entries.push(prepared.characterEntry);
      characters.activeId = prepared.characterEntry.id;
      return true;
    }, { queueSave: false });

    if (result === false) throw new Error("Failed to apply imported character.");
    SaveManager.markDirty();
  } catch (err) {
    try {
      restoreCharacters(state, previousCharacters);
      if (isPlainObject(state)) {
        if (hadContentBucket && isPlainObject(state.content)) {
          /** @type {{ content: { custom?: unknown } }} */ (state).content.custom = previousCustomContent;
        } else if (!hadContentBucket && "content" in state) {
          delete state.content;
        }
      }
    } catch (restoreErr) {
      console.warn("commitImport: failed to restore character state after import failure.", restoreErr);
    }
    await cleanupBlob(newBlobId, deleteBlob);
    throw err;
  }

  for (const [spellId, noteText] of Object.entries(prepared.spellNotes)) {
    try {
      await putText(noteText, textKey_spellNotes(campaignId, spellId));
    } catch (err) {
      console.warn("commitImport: failed to store imported spell notes.", err);
    }
  }

  return prepared.characterEntry.id;
}
