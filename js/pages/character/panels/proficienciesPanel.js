// js/pages/character/panels/proficienciesPanel.js
// Character page Proficiencies panel (armor/weapon/tool/language textareas)
import { requireMany } from "../../../utils/domGuards.js";
import { getActiveCharacter } from "../../../domain/characterHelpers.js";
import { createStateActions } from "../../../domain/stateActions.js";

export function initProficienciesPanel(deps = {}) {
  const { state, SaveManager, bindText, setStatus } = deps;

  if (!state || !SaveManager || !bindText) return;
  if (!getActiveCharacter(state)) return;
  const { updateCharacterField } = createStateActions({ state, SaveManager });

  const required = {
    panel: "#charProfPanel",
    armor: "#charArmorProf",
    weapons: "#charWeaponProf",
    tools: "#charToolProf",
    languages: "#charLanguages"
  };
  const guard = requireMany(required, { root: document, setStatus, context: "Proficiencies panel" });
  if (!guard.ok) return guard.destroy;

  bindText("charArmorProf", () => getActiveCharacter(state)?.armorProf, (v) => updateCharacterField("armorProf", v, { queueSave: false }));
  bindText("charWeaponProf", () => getActiveCharacter(state)?.weaponProf, (v) => updateCharacterField("weaponProf", v, { queueSave: false }));
  bindText("charToolProf", () => getActiveCharacter(state)?.toolProf, (v) => updateCharacterField("toolProf", v, { queueSave: false }));
  bindText("charLanguages", () => getActiveCharacter(state)?.languages, (v) => updateCharacterField("languages", v, { queueSave: false }));
}
