// js/pages/character/panels/proficienciesPanel.js
// Character page Proficiencies panel (armor/weapon/tool/language textareas)
import { requireMany } from "../../../utils/domGuards.js";
import { getActiveCharacter } from "../../../domain/characterHelpers.js";

export function initProficienciesPanel(deps = {}) {
  const { state, SaveManager, bindText, setStatus } = deps;

  if (!state || !SaveManager || !bindText) return;
  const char = getActiveCharacter(state);
  if (!char) return;

  const required = {
    panel: "#charProfPanel",
    armor: "#charArmorProf",
    weapons: "#charWeaponProf",
    tools: "#charToolProf",
    languages: "#charLanguages"
  };
  const guard = requireMany(required, { root: document, setStatus, context: "Proficiencies panel" });
  if (!guard.ok) return guard.destroy;

  bindText("charArmorProf", () => char.armorProf, (v) => char.armorProf = v);
  bindText("charWeaponProf", () => char.weaponProf, (v) => char.weaponProf = v);
  bindText("charToolProf", () => char.toolProf, (v) => char.toolProf = v);
  bindText("charLanguages", () => char.languages, (v) => char.languages = v);
}
