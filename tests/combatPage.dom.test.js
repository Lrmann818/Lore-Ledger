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
