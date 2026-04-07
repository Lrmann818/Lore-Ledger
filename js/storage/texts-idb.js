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
export function textKey_spellNotes(spellId) {
  return `spell_notes_${spellId}`;
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
