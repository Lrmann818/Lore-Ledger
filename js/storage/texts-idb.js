// @ts-check
// js/storage/texts-idb.js — large text storage helpers (IndexedDB)

import { openDb, TEXT_STORE } from "./idb.js";

/**
 * @typedef {{
 *   id: string,
 *   text: string,
 *   updatedAt: number
 * }} TextStoreRecord
 */

/**
 * @param {string} spellId
 * @returns {string}
 */
export function legacyTextKey_spellNotes(spellId) {
  return `spell_notes_${spellId}`;
}

/**
 * @param {string} campaignIdOrSpellId
 * @param {string} [spellId]
 * @returns {string}
 */
export function textKey_spellNotes(campaignIdOrSpellId, spellId) {
  if (typeof spellId === "string") {
    return `spell_notes_${campaignIdOrSpellId}__${spellId}`;
  }
  return legacyTextKey_spellNotes(campaignIdOrSpellId);
}

/**
 * @param {string} campaignId
 * @param {Iterable<string>} spellIds
 * @param {{
 *   getTextRecord?: typeof getTextRecord,
 *   putText?: typeof putText,
 *   deleteText?: typeof deleteText
 * }} [deps]
 * @returns {Promise<boolean>}
 */
export async function migrateLegacySpellNotesToCampaignScope(campaignId, spellIds, deps = {}) {
  const {
    getTextRecord: readTextRecord = getTextRecord,
    putText: writeText = putText,
    deleteText: removeText = deleteText
  } = deps;
  const normalizedCampaignId = String(campaignId || "").trim();
  if (!normalizedCampaignId) return false;

  let changed = false;
  const seen = new Set();

  for (const rawSpellId of spellIds) {
    const spellId = String(rawSpellId || "").trim();
    if (!spellId || seen.has(spellId)) continue;
    seen.add(spellId);

    const legacyId = legacyTextKey_spellNotes(spellId);
    const scopedId = textKey_spellNotes(normalizedCampaignId, spellId);
    const legacyRecord = await readTextRecord(legacyId);
    if (!legacyRecord) continue;

    const scopedRecord = await readTextRecord(scopedId);
    if (!scopedRecord) {
      await writeText(legacyRecord.text || "", scopedId);
      changed = true;
    }

    await removeText(legacyId);
    changed = true;
  }

  return changed;
}

/**
 * @param {string} text
 * @param {string} id
 * @returns {Promise<string>}
 */
export async function putText(text, id) {
  const db = await openDb();
  const textId = id;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TEXT_STORE, "readwrite");
    tx.objectStore(TEXT_STORE).put(/** @type {TextStoreRecord} */ ({
      id: textId,
      text: String(text ?? ""),
      updatedAt: Date.now()
    }));
    tx.oncomplete = () => resolve(textId);
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * @param {string | null | undefined} id
 * @returns {Promise<TextStoreRecord | null>}
 */
export async function getTextRecord(id) {
  if (!id) return Promise.resolve(null);
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TEXT_STORE, "readonly");
    const req = tx.objectStore(TEXT_STORE).get(id);
    req.onsuccess = () => resolve((/** @type {TextStoreRecord | undefined} */ (req.result)) ?? null);
    req.onerror = () => reject(req.error);
  });
}

/**
 * @param {string | null | undefined} id
 * @returns {Promise<string>}
 */
export async function getText(id) {
  return (await getTextRecord(id))?.text ?? "";
}

/**
 * @param {string | null | undefined} id
 * @returns {Promise<void>}
 */
export async function deleteText(id) {
  if (!id) return Promise.resolve();
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TEXT_STORE, "readwrite");
    tx.objectStore(TEXT_STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * @returns {Promise<void>}
 */
export async function clearAllTexts() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TEXT_STORE, "readwrite");
    tx.objectStore(TEXT_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * @returns {Promise<Record<string, string>>}
 */
export async function getAllTexts() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TEXT_STORE, "readonly");
    const req = tx.objectStore(TEXT_STORE).getAll();
    req.onsuccess = () => {
      /** @type {Record<string, string>} */
      const out = {};
      for (const row of /** @type {TextStoreRecord[]} */ (req.result || [])) out[row.id] = row.text ?? "";
      resolve(out);
    };
    req.onerror = () => reject(req.error);
  });
}
