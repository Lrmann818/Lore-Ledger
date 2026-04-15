// js/pages/character/panels/personalityPanel.js
// Character page Personality panel (traits/ideals/bonds/flaws/notes + collapsible textareas)

import { initCollapsibleTextareas } from "../../../ui/collapsibleTextareas.js";
import { requireMany } from "../../../utils/domGuards.js";
import { getActiveCharacter } from "../../../domain/characterHelpers.js";
import { createStateActions } from "../../../domain/stateActions.js";

/**
 * @typedef {{
 *   state?: unknown,
 *   SaveManager?: { markDirty?: () => void },
 *   root?: Document | HTMLElement
 * }} CharacterCollapsibleTextareaDeps
 */

function ensureStringField(obj, key) {
  if (typeof obj[key] !== "string") obj[key] = "";
}

export function initPersonalityPanel(deps = {}) {
  const { state, SaveManager, bindText, setStatus } = deps;
  if (!state || !SaveManager || !bindText) return;
  if (!getActiveCharacter(state)) return;
  const { updateCharacterField, mutateCharacter } = createStateActions({ state, SaveManager });

  const required = {
    panel: "#charPersonalityPanel",
    traits: "#charTraits",
    ideals: "#charIdeals",
    bonds: "#charBonds",
    flaws: "#charFlaws",
    notes: "#charCharNotes"
  };
  const guard = requireMany(required, { root: document, setStatus, context: "Personality panel" });
  if (!guard.ok) return guard.destroy;

  mutateCharacter((character) => {
    if (!character.personality || typeof character.personality !== "object") {
      character.personality = { traits: "", ideals: "", bonds: "", flaws: "", notes: "" };
    }
    ensureStringField(character.personality, "traits");
    ensureStringField(character.personality, "ideals");
    ensureStringField(character.personality, "bonds");
    ensureStringField(character.personality, "flaws");
    ensureStringField(character.personality, "notes");
    return true;
  }, { queueSave: false });

  bindText("charTraits", () => getActiveCharacter(state)?.personality?.traits, (v) => updateCharacterField("personality.traits", v, { queueSave: false }));
  bindText("charIdeals", () => getActiveCharacter(state)?.personality?.ideals, (v) => updateCharacterField("personality.ideals", v, { queueSave: false }));
  bindText("charBonds", () => getActiveCharacter(state)?.personality?.bonds, (v) => updateCharacterField("personality.bonds", v, { queueSave: false }));
  bindText("charFlaws", () => getActiveCharacter(state)?.personality?.flaws, (v) => updateCharacterField("personality.flaws", v, { queueSave: false }));
  bindText("charCharNotes", () => getActiveCharacter(state)?.personality?.notes, (v) => updateCharacterField("personality.notes", v, { queueSave: false }));
}

/**
 * @param {CharacterCollapsibleTextareaDeps} [deps]
 */
export function setupCharacterCollapsibleTextareas({ state, SaveManager, root } = {}) {
  initCollapsibleTextareas({ state, SaveManager, root });
}
