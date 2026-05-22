import { describe, expect, it, vi } from "vitest";

import {
  LINKED_FIELD_MAP,
  getLinkedCards,
  linkCardToCharacter,
  resolveCardDisplayData,
  snapshotLinkedFieldsToCard,
  writeCardLinkedField
} from "../js/domain/cardLinking.js";

function makeState() {
  return {
    characters: {
      activeId: "char_a",
      entries: [
        {
          id: "char_a",
          name: "Arlen",
          classLevel: "Wizard 5",
          hpCur: 7,
          hpMax: 20,
          ac: 15,
          status: "Poisoned",
          imgBlobId: "char-portrait"
        }
      ]
    },
    tracker: {
      npcs: [
        {
          id: "npc_1",
          characterId: "char_a",
          sectionId: "npc_main",
          group: "foe",
          name: "Fallback NPC",
          className: "Fallback Role",
          hpCurrent: 1,
          hpMax: 2,
          ac: 12,
          status: "Fallback Status",
          imgBlobId: "fallback-portrait",
          notes: "Card notes",
          collapsed: false,
          portraitHidden: false
        }
      ],
      party: [
        {
          id: "party_1",
          characterId: "char_a",
          sectionId: "party_main",
          name: "Fallback Party",
          className: "Fallback Class",
          hpCurrent: 3,
          hpMax: 4,
          ac: 13,
          status: "Fallback Party Status",
          imgBlobId: "fallback-party-portrait",
          notes: "Party notes",
          collapsed: false,
          portraitHidden: false
        }
      ]
    }
  };
}

describe("cardLinking", () => {
  it("defines the Step 2 linked field mapping", () => {
    expect(LINKED_FIELD_MAP).toEqual({
      name: "name",
      className: "classLevel",
      hpCurrent: "hpCur",
      hpMax: "hpMax",
      ac: "ac",
      status: "status",
      imgBlobId: "imgBlobId"
    });
  });

  it("resolves linked display data from the character while preserving card-only fields", () => {
    const state = makeState();
    const card = state.tracker.npcs[0];

    expect(resolveCardDisplayData(card, state)).toMatchObject({
      id: "npc_1",
      sectionId: "npc_main",
      group: "foe",
      notes: "Card notes",
      name: "Arlen",
      className: "Wizard 5",
      hpCurrent: 7,
      hpMax: 20,
      ac: 15,
      status: "Poisoned",
      imgBlobId: "char-portrait",
      isLinked: true,
      isOrphanedLink: false,
      linkedCharacterName: "Arlen"
    });
  });

  it("resolves standalone and orphaned cards from their own fallback fields", () => {
    const state = makeState();
    const standalone = { ...state.tracker.npcs[0], characterId: null };
    const orphaned = { ...state.tracker.npcs[0], characterId: "char_missing" };

    expect(resolveCardDisplayData(standalone, state)).toMatchObject({
      name: "Fallback NPC",
      className: "Fallback Role",
      hpCurrent: 1,
      hpMax: 2,
      ac: 12,
      status: "Fallback Status",
      imgBlobId: "fallback-portrait",
      isLinked: false,
      isOrphanedLink: false
    });
    expect(resolveCardDisplayData(orphaned, state)).toMatchObject({
      name: "Fallback NPC",
      isLinked: false,
      isOrphanedLink: true
    });
  });

  it("writes linked fields through to the character and card-only fields to the card", () => {
    const state = makeState();
    const card = state.tracker.npcs[0];
    const SaveManager = { markDirty: vi.fn() };

    expect(writeCardLinkedField(card, "name", "Mira", state, { SaveManager })).toEqual({
      target: "character",
      written: true
    });
    expect(state.characters.entries[0].name).toBe("Mira");
    expect(card.name).toBe("Fallback NPC");

    expect(writeCardLinkedField(card, "notes", "Updated card note", state, { SaveManager })).toEqual({
      target: "card",
      written: true
    });
    expect(card.notes).toBe("Updated card note");
    expect(SaveManager.markDirty).toHaveBeenCalledTimes(2);
  });

  it("writes standalone and orphaned linked fields to the card", () => {
    const state = makeState();
    const standalone = { ...state.tracker.npcs[0], characterId: null };
    const orphaned = { ...state.tracker.npcs[0], characterId: "char_missing" };

    expect(writeCardLinkedField(standalone, "hpCurrent", 9, state)).toEqual({
      target: "card",
      written: true
    });
    expect(writeCardLinkedField(orphaned, "ac", 17, state)).toEqual({
      target: "card",
      written: true
    });
    expect(writeCardLinkedField(orphaned, "status", "Prone", state)).toEqual({
      target: "card",
      written: true
    });
    expect(standalone.hpCurrent).toBe(9);
    expect(orphaned.ac).toBe(17);
    expect(orphaned.status).toBe("Prone");
    expect(state.characters.entries[0].hpCur).toBe(7);
    expect(state.characters.entries[0].ac).toBe(15);
    expect(state.characters.entries[0].status).toBe("Poisoned");
  });

  it("snapshots linked fields into the card and clears the link", () => {
    const state = makeState();
    const card = state.tracker.npcs[0];

    expect(snapshotLinkedFieldsToCard(card, state)).toBe(true);
    expect(card).toMatchObject({
      characterId: null,
      name: "Arlen",
      className: "Wizard 5",
      hpCurrent: 7,
      hpMax: 20,
      ac: 15,
      status: "Poisoned",
      imgBlobId: "char-portrait",
      notes: "Card notes"
    });
  });

  it("clears an orphaned link without changing fallback data", () => {
    const state = makeState();
    const card = { ...state.tracker.npcs[0], characterId: "char_missing" };

    expect(snapshotLinkedFieldsToCard(card, state)).toBe(false);
    expect(card.characterId).toBeNull();
    expect(card.name).toBe("Fallback NPC");
  });

  it("links cards by id without copying character fields", () => {
    const card = { id: "npc_new", characterId: null, name: "Snapshot" };

    expect(linkCardToCharacter(card, " char_a ")).toBe(true);
    expect(card).toEqual({
      id: "npc_new",
      characterId: "char_a",
      name: "Snapshot"
    });
  });

  it("finds linked NPC and Party cards for a character", () => {
    const state = makeState();

    expect(getLinkedCards(state, "char_a")).toEqual([
      { type: "npc", card: state.tracker.npcs[0] },
      { type: "party", card: state.tracker.party[0] }
    ]);
    expect(getLinkedCards(state, "missing")).toEqual([]);
  });
});
