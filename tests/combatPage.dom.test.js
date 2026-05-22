import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const combatPageSource = readFileSync(new URL("../js/pages/combat/combatPage.js", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

describe("combat page style contracts", () => {
  it("marks Pass death saves with explicit success classes while keeping Fail boxes on failure classes", () => {
    expect(combatPageSource).toContain('combatDeathSaveBox ${field === "failures" ? "isFailure" : "isSuccess"}');
    expect(stylesSource).toContain(".combatDeathSaveBox.isSuccess");
    expect(stylesSource).toContain("var(--success)");
    expect(stylesSource).toContain(".combatDeathSaveBox.isFailure");
    expect(stylesSource).toContain("var(--danger)");
  });

  it("keeps combat HP and AC markup on the compact centered stat-tile classes", () => {
    expect(combatPageSource).toContain('hpBtn.className = "combatHpBtn combatStatTile combatVitalTile"');
    expect(combatPageSource).toContain('hpLabel.className = "combatHpLabel combatStatLabel"');
    expect(combatPageSource).toContain('hpValue.className = "combatHpValue combatStatValue"');
    expect(combatPageSource).toContain('acValue.className = "combatAcValue combatStatTile combatVitalTile"');
    expect(combatPageSource).toContain('createTextEl("AC", "combatAcLabel combatStatLabel")');
    expect(combatPageSource).toContain('createTextEl(card.acLabel, "combatAcNumber combatStatValue")');
    expect(stylesSource).toContain(".combatVitalTile");
    expect(stylesSource).toContain(".combatVitalTile .combatStatLabel");
    expect(stylesSource).toContain(".combatVitalTile .combatStatValue");
  });
});

describe("stabilize button UX contracts", () => {
  it("renders a Stabilize button inside the title wrap when the card shows death saves", () => {
    // The button must be guarded by card.showsDeathSaves and carry the stabilize action
    expect(combatPageSource).toContain("if (card.showsDeathSaves)");
    expect(combatPageSource).toContain('stabilizeBtn.dataset.combatAction = "stabilize"');
    expect(combatPageSource).toContain('stabilizeBtn.textContent = "Stabilize"');
    // Must be appended to titleWrap (near the name), not inside the death-save controls
    expect(combatPageSource).toContain("titleWrap.appendChild(stabilizeBtn)");
    // Accessible label includes the combatant name
    expect(combatPageSource).toContain('stabilizeBtn.setAttribute("aria-label", `Stabilize ${card.name}`)');
    // Styled with the dedicated class
    expect(combatPageSource).toContain('stabilizeBtn.className = "combatStabilizeBtn"');
    expect(stylesSource).toContain(".combatStabilizeBtn");
  });

  it("routes the stabilize button click to the openStabilizeModal helper via the click handler", () => {
    // The click handler dispatches to openStabilizeModal, not to inline logic
    expect(combatPageSource).toContain('action === "stabilize"');
    expect(combatPageSource).toContain("openStabilizeModal(participantId, card)");
    // openStabilizeModal shows the confirm dialog with the expected title and text
    expect(combatPageSource).toContain("const openStabilizeModal = (participantId, card) => {");
    expect(combatPageSource).toContain('title: "Mark Stable?"');
    expect(combatPageSource).toContain('okText: "Mark Stable"');
    expect(combatPageSource).toContain("markCombatParticipantStable(state, participantId)");
  });

  it("does not render a Stabilize button for combatants not in the death-save state", () => {
    // The button creation is exclusively inside the card.showsDeathSaves branch.
    // Verify the death-saves branch and the else-branch (normal vitals) are distinct code paths —
    // the stabilize button markup must not appear outside the showsDeathSaves guard.
    const deathSavesBranchStart = combatPageSource.indexOf("if (card.showsDeathSaves)");
    const elseStart = combatPageSource.indexOf("} else {", deathSavesBranchStart);
    const normalBranch = combatPageSource.slice(elseStart);
    expect(normalBranch).not.toContain('stabilizeBtn');
  });

  it("no longer uses a long-press timer to open the stabilize modal", () => {
    expect(combatPageSource).not.toContain("deathSavesLongPressTimer");
    expect(combatPageSource).not.toContain("deathSavesLongPressParticipantId");
    expect(combatPageSource).not.toContain("clearDeathSavesLongPress");
    expect(combatPageSource).not.toContain('"death-saves-long-press"');
    expect(combatPageSource).not.toContain("Long press to mark stable");
  });

  it("death save pass/fail checkboxes still use the change handler", () => {
    // The change handler for death-save checkbox state must still be present
    expect(combatPageSource).toContain("combatDeathSavesField");
    expect(combatPageSource).toContain("setCombatParticipantDeathSaveSuccesses");
    expect(combatPageSource).toContain("setCombatParticipantDeathSaveFailures");
  });
});
