import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const partyCardsSource = readFileSync(new URL("../js/pages/tracker/panels/partyCards.js", import.meta.url), "utf8");
const npcCardsSource = readFileSync(new URL("../js/pages/tracker/panels/npcCards.js", import.meta.url), "utf8");

function expectAcRowContract(source, updateCallText, statusRowDeclaration, statusAppendText) {
  expect(source).toContain('acRow.className = "npcRowBlock npcAcRow"');
  expect(source).toContain('acLabel.textContent = "AC"');
  expect(source).toContain('acInput.dataset.linkedField = "ac"');
  expect(source).toContain('acInput.placeholder = "AC"');
  expect(source).toContain('acInput.value = display.ac != null ? String(display.ac) : ""');
  expect(source).toContain(updateCallText);
  expect(source).toContain('"ac"');

  const hpRowIndex = source.indexOf("const hpRow = document.createElement");
  const acRowIndex = source.indexOf("const acRow = document.createElement");
  const statusRowIndex = source.indexOf(statusRowDeclaration);
  const appendHpIndex = source.indexOf("collapsible.appendChild(hpRow);");
  const appendAcIndex = source.indexOf("collapsible.appendChild(acRow);");
  const appendStatusIndex = source.indexOf(statusAppendText);

  expect(hpRowIndex).toBeGreaterThan(-1);
  expect(acRowIndex).toBeGreaterThan(hpRowIndex);
  expect(statusRowIndex).toBeGreaterThan(acRowIndex);
  expect(appendHpIndex).toBeGreaterThan(-1);
  expect(appendAcIndex).toBeGreaterThan(appendHpIndex);
  expect(appendStatusIndex).toBeGreaterThan(appendAcIndex);

  expect(source).toContain('(field === "hpCurrent" || field === "hpMax" || field === "ac")');
}

describe("tracker card AC row source contracts", () => {
  it("keeps Party cards on the existing Class -> HP -> AC -> Status Effects row pattern", () => {
    expectAcRowContract(
      partyCardsSource,
      'updatePartyLinkedField(member, "ac", parseNumberOrNull(acInput.value), false)',
      'const statusRow = document.createElement("div");',
      "collapsible.appendChild(statusRow);"
    );
  });

  it("keeps NPC cards on the existing Class -> HP -> AC -> Status Effects row pattern", () => {
    expectAcRowContract(
      npcCardsSource,
      'updateNpcLinkedField(npc, "ac", numberOrNull(acInput.value), false)',
      'const statusBlock = document.createElement("div");',
      "collapsible.appendChild(statusBlock);"
    );
  });
});
