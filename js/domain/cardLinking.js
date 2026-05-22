// @ts-check
// Centralized Character <-> tracker card linking helpers.

import { getCharacterById } from "./characterHelpers.js";
import { withAllowedStateMutation } from "../utils/dev.js";

/** @typedef {import("../state.js").State} State */
/** @typedef {import("../state.js").CharacterEntry} CharacterEntry */
/** @typedef {import("./factories.js").NpcCard | import("./factories.js").PartyMemberCard} LinkedTrackerCard */
/** @typedef {{ markDirty?: () => void }} SaveManagerLike */
/** @typedef {"name" | "className" | "hpCurrent" | "hpMax" | "ac" | "status" | "imgBlobId"} LinkedCardField */

/** @type {Readonly<Record<LinkedCardField, keyof CharacterEntry>>} */
export const LINKED_FIELD_MAP = Object.freeze({
  name: "name",
  className: "classLevel",
  hpCurrent: "hpCur",
  hpMax: "hpMax",
  ac: "ac",
  status: "status",
  imgBlobId: "imgBlobId"
});

const LINKED_CARD_FIELDS = new Set(Object.keys(LINKED_FIELD_MAP));

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {unknown} field
 * @returns {field is LinkedCardField}
 */
function isLinkedField(field) {
  return typeof field === "string" && LINKED_CARD_FIELDS.has(field);
}

/**
 * @param {LinkedTrackerCard | Record<string, unknown> | null | undefined} card
 * @param {State | Record<string, unknown> | null | undefined} state
 * @returns {CharacterEntry | null}
 */
export function getLinkedCharacter(card, state) {
  const characterId = typeof card?.characterId === "string" ? card.characterId : "";
  return characterId ? getCharacterById(/** @type {State} */ (state), characterId) : null;
}

/**
 * Resolve the user-visible card data from either the linked character entry or
 * the card's standalone fallback fields.
 *
 * @param {LinkedTrackerCard | Record<string, unknown>} card
 * @param {State | Record<string, unknown> | null | undefined} state
 * @returns {Record<string, unknown> & {
 *   name: string,
 *   className: string,
 *   hpCurrent: number | null,
 *   hpMax: number | null,
 *   ac: number | null,
 *   status: string,
 *   imgBlobId: string | null,
 *   isLinked: boolean,
 *   isOrphanedLink: boolean,
 *   linkedCharacterName: string
 * }}
 */
export function resolveCardDisplayData(card, state) {
  const base = isPlainObject(card) ? card : {};
  const character = getLinkedCharacter(base, state);
  const hasLink = typeof base.characterId === "string" && !!base.characterId;

  if (!character) {
    return /** @type {ReturnType<typeof resolveCardDisplayData>} */ ({
      ...base,
      name: typeof base.name === "string" ? base.name : "",
      className: typeof base.className === "string" ? base.className : "",
      hpCurrent: base.hpCurrent ?? null,
      hpMax: base.hpMax ?? null,
      ac: base.ac ?? null,
      status: typeof base.status === "string" ? base.status : "",
      imgBlobId: typeof base.imgBlobId === "string" ? base.imgBlobId : null,
      isLinked: false,
      isOrphanedLink: hasLink,
      linkedCharacterName: ""
    });
  }

  return /** @type {ReturnType<typeof resolveCardDisplayData>} */ ({
    ...base,
    name: character.name || "",
    className: character.classLevel || "",
    hpCurrent: character.hpCur ?? null,
    hpMax: character.hpMax ?? null,
    ac: character.ac ?? null,
    status: character.status || "",
    imgBlobId: character.imgBlobId || null,
    isLinked: true,
    isOrphanedLink: false,
    linkedCharacterName: character.name || "Unnamed Character"
  });
}

/**
 * @param {LinkedTrackerCard | Record<string, unknown>} card
 * @param {string} field
 * @param {unknown} value
 * @param {State | Record<string, unknown>} state
 * @param {{ SaveManager?: SaveManagerLike, queueSave?: boolean }} [deps]
 * @returns {{ target: "character" | "card", written: boolean }}
 */
export function writeCardLinkedField(card, field, value, state, deps = {}) {
  if (!isPlainObject(card) || !field) return { target: "card", written: false };

  const character = isLinkedField(field) ? getLinkedCharacter(card, state) : null;
  const target = character ? "character" : "card";
  const wrote = withAllowedStateMutation(() => {
    if (character && isLinkedField(field)) {
      const characterField = LINKED_FIELD_MAP[field];
      character[characterField] = value;
      return true;
    }
    card[field] = value;
    return true;
  });

  if (!wrote) return { target, written: false };
  if (deps.queueSave !== false) deps.SaveManager?.markDirty?.();
  return { target, written: true };
}

/**
 * Copies current linked character fields into the card's own fallback fields,
 * then clears the link.
 *
 * @param {LinkedTrackerCard | Record<string, unknown>} card
 * @param {State | Record<string, unknown> | null | undefined} state
 * @returns {boolean}
 */
export function snapshotLinkedFieldsToCard(card, state) {
  if (!isPlainObject(card)) return false;
  const character = getLinkedCharacter(card, state);
  if (!character) {
    card.characterId = null;
    return false;
  }

  return !!withAllowedStateMutation(() => {
    for (const [cardField, characterField] of Object.entries(LINKED_FIELD_MAP)) {
      card[cardField] = character[characterField];
    }
    card.characterId = null;
    return true;
  });
}

/**
 * @param {LinkedTrackerCard | Record<string, unknown>} card
 * @param {string | null | undefined} characterId
 * @returns {boolean}
 */
export function linkCardToCharacter(card, characterId) {
  if (!isPlainObject(card)) return false;
  const id = typeof characterId === "string" && characterId.trim() ? characterId.trim() : null;
  return !!withAllowedStateMutation(() => {
    card.characterId = id;
    return true;
  });
}

/**
 * @param {State | Record<string, unknown> | null | undefined} state
 * @param {string | null | undefined} characterId
 * @returns {Array<{ type: "npc" | "party", card: LinkedTrackerCard }>}
 */
export function getLinkedCards(state, characterId) {
  const id = typeof characterId === "string" ? characterId : "";
  if (!id) return [];
  const tracker = isPlainObject(state?.tracker) ? state.tracker : {};
  /** @type {Array<{ type: "npc" | "party", card: LinkedTrackerCard }>} */
  const out = [];

  if (Array.isArray(tracker.npcs)) {
    for (const card of tracker.npcs) {
      if (isPlainObject(card) && card.characterId === id) {
        out.push({ type: "npc", card: /** @type {LinkedTrackerCard} */ (card) });
      }
    }
  }
  if (Array.isArray(tracker.party)) {
    for (const card of tracker.party) {
      if (isPlainObject(card) && card.characterId === id) {
        out.push({ type: "party", card: /** @type {LinkedTrackerCard} */ (card) });
      }
    }
  }

  return out;
}
