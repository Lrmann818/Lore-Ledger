// @vitest-environment jsdom
// Custom content manager dialog (matrix #15): list/create/edit/remove custom
// records through forms. Uses the real domain normalization; only the
// uiConfirm dialog is mocked so destructive confirmations resolve
// deterministically.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../js/ui/dialogs.js", () => ({
  initDialogs: vi.fn(),
  uiAlert: vi.fn(async () => undefined),
  uiConfirm: vi.fn(async () => true),
  uiPrompt: vi.fn(async () => null)
}));

import { createCustomContentManager } from "../js/ui/customContentManager.js";
import { uiConfirm } from "../js/ui/dialogs.js";
import { addCustomContentRecords, listCustomContent } from "../js/domain/customContent.js";
import { migrateState } from "../js/state.js";

const OVERLAY_HTML = `
  <button id="dataCustomContentManageBtn" type="button">Manage Custom Content</button>
  <div id="customContentOverlay" class="modalOverlay" hidden aria-hidden="true">
    <div class="modalPanel customContentPanel" id="customContentPanel" role="dialog" aria-modal="true"
      aria-labelledby="customContentTitle" tabindex="-1">
      <div class="uiDialogHeader">
        <div class="modalTitle" id="customContentTitle">Custom Content</div>
        <button type="button" class="npcSmallBtn" id="customContentClose" aria-label="Close Custom Content">✕</button>
      </div>
      <div class="customContentBody" id="customContentBody"></div>
      <div class="uiDialogFooter customContentFooter" id="customContentFooter"></div>
    </div>
  </div>
`;

const CUSTOM_SPELL = {
  id: "stellar-flare",
  kind: "spell",
  name: "Stellar Flare",
  source: "custom",
  level: 2,
  school: "evocation",
  classIds: ["wizard"],
  subclassIds: [],
  castingTime: "1 action",
  range: "60 feet",
  duration: "Instantaneous",
  components: ["V"],
  material: null,
  ritual: false,
  concentration: false,
  desc: "A lance of starlight burns one creature you can see.",
  higherLevel: null,
  attackType: null,
  saveAbility: "dex",
  damageType: "radiant"
};

let manager = null;
let state = null;
let deps = null;

function setup(records = []) {
  document.body.innerHTML = OVERLAY_HTML;
  state = migrateState({ schemaVersion: 10 });
  if (records.length) addCustomContentRecords(state, records);
  deps = {
    state,
    markDirty: vi.fn(),
    setStatus: vi.fn(),
    onContentChanged: vi.fn()
  };
  manager = createCustomContentManager(deps);
  return manager;
}

const body = () => document.getElementById("customContentBody");
const footer = () => document.getElementById("customContentFooter");
const overlay = () => document.getElementById("customContentOverlay");

function footerButton(label) {
  return Array.from(footer().querySelectorAll("button")).find((btn) => btn.textContent === label);
}

function setInput(fieldKey, value) {
  const input = document.getElementById(`customContentInput-${fieldKey}`);
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  return input;
}

function fillValidSpellForm() {
  setInput("name", "Stellar Flare");
  setInput("level", "2");
  setInput("school", "evocation");
  setInput("range", "60 feet");
  setInput("duration", "Instantaneous");
  setInput("desc", "A lance of starlight burns one creature you can see.");
  const wizardBox = body().querySelector('[data-checklist="classIds"] input[value="wizard"]');
  wizardBox.checked = true;
  wizardBox.dispatchEvent(new Event("change", { bubbles: true }));
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.mocked(uiConfirm).mockClear();
  vi.mocked(uiConfirm).mockResolvedValue(true);
});

afterEach(() => {
  manager?.destroy?.();
  manager = null;
  document.body.innerHTML = "";
});

describe("custom content manager list view", () => {
  it("opens with an empty state and a New Spell action", () => {
    setup().open();
    expect(overlay().hidden).toBe(false);
    expect(body().textContent).toContain("no custom content yet");
    expect(footerButton("New Spell")).toBeTruthy();
    expect(document.activeElement).toBe(document.getElementById("customContentPanel"));
  });

  it("lists existing records with kind:id and offers Edit only for authorable kinds", () => {
    setup([
      CUSTOM_SPELL,
      { id: "starfolk", kind: "race", name: "Starfolk" }
    ]).open();
    const rows = body().querySelectorAll(".customContentRow");
    expect(rows).toHaveLength(2);
    expect(body().textContent).toContain("spell:stellar-flare");
    expect(body().textContent).toContain("race:starfolk");
    const spellRow = Array.from(rows).find((row) => row.textContent.includes("spell:stellar-flare"));
    const raceRow = Array.from(rows).find((row) => row.textContent.includes("race:starfolk"));
    expect(Array.from(spellRow.querySelectorAll("button")).map((btn) => btn.textContent)).toEqual(["Edit", "Remove"]);
    expect(Array.from(raceRow.querySelectorAll("button")).map((btn) => btn.textContent)).toEqual(["Remove"]);
  });

  it("closes from Escape in list view and restores nothing destructive", () => {
    setup([CUSTOM_SPELL]).open();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(overlay().hidden).toBe(true);
    expect(listCustomContent(state)).toHaveLength(1);
    expect(deps.markDirty).not.toHaveBeenCalled();
  });
});

describe("creating a spell through the form", () => {
  it("creates a canonical custom spell record and returns to the list", () => {
    setup().open();
    footerButton("New Spell").click();
    expect(document.getElementById("customContentTitle").textContent).toBe("New Custom Spell");
    expect(document.activeElement).toBe(document.getElementById("customContentInput-name"));

    fillValidSpellForm();
    footerButton("Save Spell").click();

    const records = listCustomContent(state);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      id: "stellar-flare",
      kind: "spell",
      name: "Stellar Flare",
      source: "custom",
      level: 2,
      school: "evocation",
      classIds: ["wizard"],
      castingTime: "1 action",
      components: ["V"],
      material: null
    });
    expect(deps.markDirty).toHaveBeenCalledTimes(1);
    expect(deps.onContentChanged).toHaveBeenCalledTimes(1);
    expect(body().textContent).toContain("spell:stellar-flare");
  });

  it("shows inline field errors on save and preserves everything already typed", () => {
    setup().open();
    footerButton("New Spell").click();
    setInput("name", "Half Finished");
    footerButton("Save Spell").click();

    expect(listCustomContent(state)).toHaveLength(0);
    expect(deps.markDirty).not.toHaveBeenCalled();
    const formError = body().querySelector(".customContentFormError");
    expect(formError.hidden).toBe(false);
    const schoolError = document.getElementById("customContentError-school");
    expect(schoolError.hidden).toBe(false);
    expect(schoolError.textContent).toContain("school");
    // The form was not rebuilt: the typed name is still there.
    expect(document.getElementById("customContentInput-name").value).toBe("Half Finished");

    // Correcting the fields saves without retyping anything.
    setInput("level", "2");
    setInput("school", "evocation");
    setInput("range", "60 feet");
    setInput("duration", "Instantaneous");
    setInput("desc", "Now finished.");
    footerButton("Save Spell").click();
    expect(listCustomContent(state)).toHaveLength(1);
    expect(listCustomContent(state)[0].name).toBe("Half Finished");
  });

  it("reveals the material field with the M component and requires its text", () => {
    setup().open();
    footerButton("New Spell").click();
    const materialRow = document.getElementById("customContentInput-material").closest(".customContentField");
    expect(materialRow.hidden).toBe(true);

    const mBox = document.getElementById("customContentInput-componentM");
    mBox.checked = true;
    mBox.dispatchEvent(new Event("change", { bubbles: true }));
    expect(materialRow.hidden).toBe(false);

    fillValidSpellForm();
    footerButton("Save Spell").click();
    expect(listCustomContent(state)).toHaveLength(0);
    expect(document.getElementById("customContentError-material").hidden).toBe(false);

    setInput("material", "A pinch of stardust.");
    footerButton("Save Spell").click();
    expect(listCustomContent(state)[0]).toMatchObject({
      components: ["V", "M"],
      material: "A pinch of stardust."
    });
  });

  it("cancels a dirty form only after confirmation and never mutates state", async () => {
    setup().open();
    footerButton("New Spell").click();
    setInput("name", "Abandoned Spell");

    footerButton("Cancel").click();
    await tick();
    expect(uiConfirm).toHaveBeenCalledTimes(1);
    expect(String(uiConfirm.mock.calls[0][0])).toContain("Discard");
    expect(document.getElementById("customContentTitle").textContent).toBe("Custom Content");
    expect(listCustomContent(state)).toHaveLength(0);
    expect(deps.markDirty).not.toHaveBeenCalled();
  });

  it("keeps a dirty form open when the discard confirmation is declined", async () => {
    setup().open();
    footerButton("New Spell").click();
    setInput("name", "Kept Spell");
    vi.mocked(uiConfirm).mockResolvedValueOnce(false);

    footerButton("Cancel").click();
    await tick();
    expect(document.getElementById("customContentTitle").textContent).toBe("New Custom Spell");
    expect(document.getElementById("customContentInput-name").value).toBe("Kept Spell");
  });

  it("ignores backdrop clicks while a form is open", () => {
    setup().open();
    footerButton("New Spell").click();
    overlay().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(overlay().hidden).toBe(false);
    expect(document.getElementById("customContentTitle").textContent).toBe("New Custom Spell");
  });
});

describe("creating a feat through the form", () => {
  it("builds a feat with repeatable prerequisite and effect rows", () => {
    setup().open();
    footerButton("New Feat").click();
    expect(document.getElementById("customContentTitle").textContent).toBe("New Custom Feat");

    setInput("name", "Iron Will");
    setInput("desc", "Your resolve is unshakeable.");

    // Add a prerequisite row and fill it.
    Array.from(body().querySelectorAll("button")).find((btn) => btn.textContent === "+ Add prerequisite").click();
    const prereqRow = body().querySelector('[data-repeat="prerequisites"] .customContentRepeatRow');
    prereqRow.querySelector(".prereqAbility").value = "wis";
    prereqRow.querySelector(".prereqMin").value = "13";

    // Add two effect rows; the second gets removed again.
    const addEffectBtn = Array.from(body().querySelectorAll("button")).find((btn) => btn.textContent === "+ Add effect");
    addEffectBtn.click();
    addEffectBtn.click();
    let effectRows = body().querySelectorAll('[data-repeat="effects"] .customContentRepeatRow');
    expect(effectRows).toHaveLength(2);
    const firstEffect = effectRows[0];
    firstEffect.querySelector(".effectType").value = "save_proficiency";
    firstEffect.querySelector(".effectType").dispatchEvent(new Event("change", { bubbles: true }));
    // Conditional inputs follow the chosen type.
    expect(firstEffect.querySelector(".effectAbility").hidden).toBe(false);
    expect(firstEffect.querySelector(".effectValue").hidden).toBe(true);
    expect(firstEffect.querySelector(".effectSkill").hidden).toBe(true);
    firstEffect.querySelector(".effectAbility").value = "wis";
    effectRows[1].querySelector("button").click();
    effectRows = body().querySelectorAll('[data-repeat="effects"] .customContentRepeatRow');
    expect(effectRows).toHaveLength(1);

    footerButton("Save Feat").click();
    const records = listCustomContent(state);
    expect(records).toHaveLength(1);
    expect(records[0]).toEqual({
      id: "iron-will",
      kind: "feat",
      name: "Iron Will",
      source: "custom",
      prerequisites: [{ ability: "wis", minimum: 13 }],
      desc: "Your resolve is unshakeable.",
      effects: [{ type: "save_proficiency", ability: "wis" }]
    });
    expect(body().textContent).toContain("feat:iron-will");
  });

  it("reports row-level errors without dropping the rows", () => {
    setup().open();
    footerButton("New Feat").click();
    setInput("name", "Broken Feat");
    setInput("desc", "Testing errors.");
    Array.from(body().querySelectorAll("button")).find((btn) => btn.textContent === "+ Add prerequisite").click();
    footerButton("Save Feat").click();

    expect(listCustomContent(state)).toHaveLength(0);
    const prereqError = document.getElementById("customContentError-prerequisites");
    expect(prereqError.hidden).toBe(false);
    expect(prereqError.textContent).toContain("Prerequisite 1");
    // The row survives the failed save for correction in place.
    expect(body().querySelectorAll('[data-repeat="prerequisites"] .customContentRepeatRow')).toHaveLength(1);
  });

  it("edits an existing feat with rows prefilled from the record", () => {
    setup([{
      id: "iron-will",
      kind: "feat",
      name: "Iron Will",
      source: "custom",
      prerequisites: [{ ability: "wis", minimum: 13 }],
      desc: "Your resolve is unshakeable.",
      effects: [{ type: "hp_per_level_bonus", value: 1 }]
    }]).open();
    const featRow = Array.from(body().querySelectorAll(".customContentRow"))
      .find((row) => row.textContent.includes("feat:iron-will"));
    Array.from(featRow.querySelectorAll("button")).find((btn) => btn.textContent === "Edit").click();

    expect(body().querySelector(".prereqAbility").value).toBe("wis");
    expect(body().querySelector(".prereqMin").value).toBe("13");
    const effectRow = body().querySelector('[data-repeat="effects"] .customContentRepeatRow');
    expect(effectRow.querySelector(".effectType").value).toBe("hp_per_level_bonus");
    expect(effectRow.querySelector(".effectValue").hidden).toBe(false);
    expect(effectRow.querySelector(".effectValue").value).toBe("1");

    setInput("name", "Iron Will, Greater");
    footerButton("Save Changes").click();
    const records = listCustomContent(state);
    expect(records[0]).toMatchObject({ id: "iron-will", name: "Iron Will, Greater" });
  });
});

describe("editing and removing records", () => {
  it("edits an existing spell in place with its id locked", () => {
    setup([CUSTOM_SPELL]).open();
    const spellRow = Array.from(body().querySelectorAll(".customContentRow"))
      .find((row) => row.textContent.includes("spell:stellar-flare"));
    Array.from(spellRow.querySelectorAll("button")).find((btn) => btn.textContent === "Edit").click();

    expect(document.getElementById("customContentTitle").textContent).toContain("Edit Spell");
    expect(body().textContent).toContain("spell:stellar-flare — the id never changes");
    expect(document.getElementById("customContentInput-name").value).toBe("Stellar Flare");
    expect(document.getElementById("customContentInput-level").value).toBe("2");

    setInput("name", "Stellar Flare, Greater");
    setInput("level", "3");
    footerButton("Save Changes").click();

    const records = listCustomContent(state);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      id: "stellar-flare",
      name: "Stellar Flare, Greater",
      level: 3
    });
    expect(deps.markDirty).toHaveBeenCalledTimes(1);
  });

  it("removes a record after a confirmation that names referencing characters", async () => {
    setup([CUSTOM_SPELL]);
    state.characters = {
      activeId: "char_a",
      entries: [{
        id: "char_a",
        name: "Mira",
        build: { spellcasting: { wizard: { knownIds: ["stellar-flare"] } } }
      }]
    };
    manager.open();

    const spellRow = Array.from(body().querySelectorAll(".customContentRow"))
      .find((row) => row.textContent.includes("spell:stellar-flare"));
    Array.from(spellRow.querySelectorAll("button")).find((btn) => btn.textContent === "Remove").click();
    await tick();

    expect(uiConfirm).toHaveBeenCalledTimes(1);
    const message = String(uiConfirm.mock.calls[0][0]);
    expect(message).toContain('Remove custom spell "Stellar Flare"');
    expect(message).toContain("Mira");
    expect(listCustomContent(state)).toHaveLength(0);
    expect(deps.markDirty).toHaveBeenCalledTimes(1);
    expect(deps.onContentChanged).toHaveBeenCalledTimes(1);
    expect(body().textContent).toContain("no custom content yet");
  });

  it("keeps the record when removal is declined", async () => {
    setup([CUSTOM_SPELL]).open();
    vi.mocked(uiConfirm).mockResolvedValueOnce(false);
    const spellRow = Array.from(body().querySelectorAll(".customContentRow"))
      .find((row) => row.textContent.includes("spell:stellar-flare"));
    Array.from(spellRow.querySelectorAll("button")).find((btn) => btn.textContent === "Remove").click();
    await tick();
    expect(listCustomContent(state)).toHaveLength(1);
    expect(deps.markDirty).not.toHaveBeenCalled();
  });
});
