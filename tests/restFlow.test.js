// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import { makeDefaultBuilderCharacterEntry } from "../js/domain/characterHelpers.js";
import { setActiveCustomContent } from "../js/domain/rules/registry.js";
import { openCharacterRestFlow } from "../js/pages/character/restFlow.js";

function overlay() {
  return /** @type {HTMLElement} */ (document.getElementById("characterRestOverlay"));
}

function texts(selector) {
  return [...overlay().querySelectorAll(selector)].map((node) => node.textContent);
}

function checkboxes() {
  return /** @type {HTMLInputElement[]} */ ([...overlay().querySelectorAll("input[type=checkbox]")]);
}

function radio(value) {
  return /** @type {HTMLInputElement} */ (
    [...overlay().querySelectorAll("input[type=radio]")].find((input) => input.value === value)
  );
}

function button(label) {
  return /** @type {HTMLButtonElement} */ (
    [...overlay().querySelectorAll("button")].find((node) => node.textContent === label)
  );
}

function submitLongRest({ confirmUnderfill = true } = {}) {
  button("Take Long Rest").click();
  const anyway = overlay() ? button("Take Long Rest Anyway") : null;
  if (confirmUnderfill && anyway) anyway.click();
}

function choose(value) {
  const input = radio(value);
  input.checked = true;
  input.dispatchEvent(new Event("change"));
}

function toggle(spellId, checked) {
  const box = checkboxes().find((input) => input.dataset.spellId === spellId);
  box.checked = checked;
  box.dispatchEvent(new Event("change"));
  return box;
}

function cleric(preparedIds, { level = 3, wis = 16 } = {}) {
  const character = makeDefaultBuilderCharacterEntry("Cleric");
  character.build.levels = Array.from({ length: level }, () => ({ classId: "cleric", hp: 5 }));
  character.build.abilities.base = { str: 10, dex: 10, con: 12, int: 10, wis, cha: 10 };
  character.build.spellcasting = { cleric: { cantripIds: [], knownIds: [], preparedIds: [] } };
  character.hpCur = 10;
  character.hpMax = 20;
  character.rest = { hitDiceSpent: {}, preparedByClass: { cleric: preparedIds } };
  return character;
}

function wizard(spellbookIds, preparedIds) {
  const character = makeDefaultBuilderCharacterEntry("Wizard");
  character.build.levels = Array.from({ length: 3 }, () => ({ classId: "wizard", hp: 4 }));
  character.build.abilities.base = { str: 10, dex: 10, con: 12, int: 16, wis: 10, cha: 10 };
  character.build.spellcasting = { wizard: { cantripIds: [], knownIds: spellbookIds, preparedIds: [] } };
  character.hpCur = 10;
  character.hpMax = 20;
  character.rest = { hitDiceSpent: {}, preparedByClass: { wizard: preparedIds } };
  return character;
}

afterEach(() => {
  setActiveCustomContent([]);
  overlay()?.remove();
  document.body.innerHTML = "";
});

describe("Long Rest prepared spells — counts", () => {
  it("shows the real selected count immediately, before any interaction", async () => {
    const character = cleric(["bless", "cure-wounds", "guiding-bolt"]);
    const done = openCharacterRestFlow({ type: "longRest", character });

    expect(texts(".characterRestPreparedCount")).toEqual(["Cleric — 3 of 6 prepared"]);
    const liveCount = /** @type {HTMLElement} */ (overlay().querySelector(".characterRestPreparedCount"));
    expect(liveCount.getAttribute("role")).toBe("status");
    expect(liveCount.getAttribute("aria-live")).toBe("polite");
    expect(liveCount.getAttribute("aria-atomic")).toBe("true");
    expect(checkboxes().filter((box) => box.checked)).toHaveLength(3);

    button("Cancel").click();
    await done;
  });

  it("keeps the counts visible while 'No' is selected", async () => {
    const character = cleric(["bless"]);
    const done = openCharacterRestFlow({ type: "longRest", character });

    const summary = /** @type {HTMLElement} */ (overlay().querySelector(".characterRestPreparedSummary"));
    const picker = /** @type {HTMLElement} */ (overlay().querySelector(".characterRestPreparedLists"));

    expect(radio("no").checked).toBe(true);
    expect(summary.hidden).toBe(false);
    expect(summary.closest("[hidden]")).toBeNull();
    expect(picker.hidden).toBe(true);
    expect(texts(".characterRestPreparedCount")).toEqual(["Cleric — 1 of 6 prepared"]);

    button("Cancel").click();
    await done;
  });

  it("reveals the picker on 'Yes' and updates both counts on every toggle", async () => {
    const character = cleric(["bless"]);
    const done = openCharacterRestFlow({ type: "longRest", character });
    choose("yes");

    const picker = /** @type {HTMLElement} */ (overlay().querySelector(".characterRestPreparedLists"));
    expect(picker.hidden).toBe(false);
    expect(texts(".characterRestSectionTitle")).toContain("Cleric — 1 of 6 prepared");

    toggle("command", true);
    expect(texts(".characterRestPreparedCount")).toEqual(["Cleric — 2 of 6 prepared"]);
    expect(texts(".characterRestSectionTitle")).toContain("Cleric — 2 of 6 prepared");

    toggle("bless", false);
    expect(texts(".characterRestPreparedCount")).toEqual(["Cleric — 1 of 6 prepared"]);

    button("Cancel").click();
    await done;
  });
});

describe("Long Rest prepared spells — honest limits", () => {
  it("explains a spellbook-limited wizard and counts against the effective capacity", async () => {
    const character = wizard(["magic-missile", "shield"], ["magic-missile"]);
    const done = openCharacterRestFlow({ type: "longRest", character });

    expect(texts(".characterRestPreparedCount")).toEqual(["Wizard — 1 of 2 prepared"]);
    expect(overlay().textContent).toContain("Limited by the spellbook");
    expect(overlay().textContent).toContain("though this class allows 6");

    button("Cancel").click();
    await done;
  });

  it("explains an unknown capacity and does not offer an unusable picker", async () => {
    const character = cleric(["bless"]);
    character.build.abilities.base.wis = null;
    const done = openCharacterRestFlow({ type: "longRest", character });

    expect(texts(".characterRestPreparedCount")).toEqual(["Cleric — 1 prepared"]);
    expect(overlay().textContent).toContain("spellcasting ability score is set");
    choose("yes");
    expect(checkboxes().every((box) => box.disabled)).toBe(true);

    button("Cancel").click();
    await done;
  });

  it("explains a class with no preparable spells", async () => {
    setActiveCustomContent([{
      id: "oracle",
      kind: "class",
      name: "Oracle",
      hitDie: 8,
      spellcasting: {
        ability: "wis",
        preparationMode: "prepared",
        progression: "full",
        startLevel: 1,
        slotsByLevel: [[2, 0, 0, 0, 0, 0, 0, 0, 0]]
      }
    }]);
    const character = cleric([]);
    character.build.levels = [{ classId: "oracle", hp: 5 }];
    character.build.spellcasting = { oracle: { cantripIds: [], knownIds: [], preparedIds: [] } };
    character.rest = { hitDiceSpent: {}, preparedByClass: {} };

    const done = openCharacterRestFlow({ type: "longRest", character });
    expect(texts(".characterRestPreparedCount")).toEqual(["Oracle — 0 of 0 prepared"]);
    expect(overlay().textContent).toContain("No spells from this class's list can be prepared yet.");

    button("Cancel").click();
    await done;
  });
});

describe("Long Rest prepared spells — C2-B underfill confirmation", () => {
  it("requires explicit inline confirmation when the preselected 'No' keeps an underfilled list", async () => {
    const character = cleric(["bless"]);
    const done = openCharacterRestFlow({ type: "longRest", character });

    submitLongRest({ confirmUnderfill: false });

    expect(overlay()).not.toBeNull();
    expect(radio("no").checked).toBe(true);
    const validation = /** @type {HTMLElement} */ (overlay().querySelector(".characterRestValidation"));
    expect(validation.hidden).toBe(false);
    expect(validation.getAttribute("role")).toBe("alert");
    expect(validation.textContent).toBe(
      "Prepared spells are below capacity: Cleric has 1 of 6 prepared. Choose Take Long Rest Anyway to continue."
    );
    expect(button("Take Long Rest Anyway")).toBeTruthy();

    button("Take Long Rest Anyway").click();
    expect(await done).toEqual({});
  });

  it("requires the same confirmation for a no-edit 'Yes'", async () => {
    const character = cleric(["bless", "command"]);
    const done = openCharacterRestFlow({ type: "longRest", character });
    choose("yes");

    submitLongRest({ confirmUnderfill: false });
    expect(overlay()).not.toBeNull();
    expect(button("Take Long Rest Anyway")).toBeTruthy();

    button("Take Long Rest Anyway").click();
    expect(await done).toEqual({});
  });

  it("re-evaluates the edited 'Yes' result and invalidates a stale confirmation", async () => {
    const character = cleric(["bless"]);
    const done = openCharacterRestFlow({ type: "longRest", character });

    submitLongRest({ confirmUnderfill: false });
    expect(button("Take Long Rest Anyway")).toBeTruthy();

    choose("yes");
    expect(button("Take Long Rest")).toBeTruthy();
    expect(/** @type {HTMLElement} */ (overlay().querySelector(".characterRestValidation")).hidden).toBe(true);
    toggle("command", true);

    submitLongRest({ confirmUnderfill: false });
    expect(overlay()).not.toBeNull();
    expect(overlay().querySelector(".characterRestValidation").textContent).toContain("2 of 6 prepared");

    button("Take Long Rest Anyway").click();
    expect(await done).toEqual({ preparedByClass: { cleric: ["bless", "command"] } });
  });

  // Independent-review finding F1. Choosing "Yes", editing, and returning to
  // "No" abandons the edits: nothing is submitted, so the stored list is what
  // survives the rest. The confirmation must follow that surviving list, never
  // the picker state left behind in the hidden section.
  it("ignores an abandoned full picker edit when 'No' keeps an underfilled stored list", async () => {
    const character = cleric(["bless"]);
    const done = openCharacterRestFlow({ type: "longRest", character });

    choose("yes");
    for (const spellId of ["bane", "command", "cure-wounds", "guiding-bolt", "healing-word"]) {
      toggle(spellId, true);
    }
    expect(texts(".characterRestPreparedCount")).toEqual(["Cleric — 6 of 6 prepared"]);
    choose("no");
    // The abandoned edits are still sitting in the now-hidden picker…
    expect(checkboxes().filter((box) => box.checked)).toHaveLength(6);
    // …but the visible count describes what "No" actually keeps.
    expect(texts(".characterRestPreparedCount")).toEqual(["Cleric — 1 of 6 prepared"]);

    submitLongRest({ confirmUnderfill: false });

    // …but the rest keeps the stored 1-of-6 list, so it still needs confirming,
    // and the count reported is the surviving one.
    expect(overlay()).not.toBeNull();
    expect(overlay().querySelector(".characterRestValidation").textContent).toBe(
      "Prepared spells are below capacity: Cleric has 1 of 6 prepared. Choose Take Long Rest Anyway to continue."
    );

    button("Take Long Rest Anyway").click();
    expect(await done).toEqual({});
  });

  it("ignores an abandoned underfilled picker edit when 'No' keeps a full stored list", async () => {
    const character = cleric(["bless", "bane", "command", "cure-wounds", "guiding-bolt", "healing-word"]);
    const done = openCharacterRestFlow({ type: "longRest", character });

    choose("yes");
    for (const spellId of ["cure-wounds", "guiding-bolt", "healing-word"]) {
      toggle(spellId, false);
    }
    expect(texts(".characterRestPreparedCount")).toEqual(["Cleric — 3 of 6 prepared"]);
    choose("no");
    expect(checkboxes().filter((box) => box.checked)).toHaveLength(3);
    expect(texts(".characterRestPreparedCount")).toEqual(["Cleric — 6 of 6 prepared"]);

    submitLongRest({ confirmUnderfill: false });

    // The surviving list is the untouched full one: nothing to confirm, and
    // nothing submitted.
    expect(await done).toEqual({});
    expect(document.getElementById("characterRestOverlay")).toBeNull();
  });

  it("restores the preserved picker draft, and its count, on returning to 'Yes'", async () => {
    const character = cleric(["bless"]);
    const done = openCharacterRestFlow({ type: "longRest", character });

    choose("yes");
    for (const spellId of ["bane", "command", "cure-wounds", "guiding-bolt", "healing-word"]) {
      toggle(spellId, true);
    }
    expect(texts(".characterRestPreparedCount")).toEqual(["Cleric — 6 of 6 prepared"]);

    choose("no");
    expect(texts(".characterRestPreparedCount")).toEqual(["Cleric — 1 of 6 prepared"]);

    choose("yes");
    // Switching away and back neither discards nor resets the draft.
    expect(texts(".characterRestPreparedCount")).toEqual(["Cleric — 6 of 6 prepared"]);
    expect(checkboxes().filter((box) => box.checked)).toHaveLength(6);

    // And the draft is genuinely intact, not merely displayed: submitting now
    // commits the full list without any underfill confirmation.
    submitLongRest({ confirmUnderfill: false });
    const result = /** @type {{ preparedByClass: Record<string, string[]> }} */ (await done);
    expect(Object.keys(result)).toEqual(["preparedByClass"]);
    expect([...result.preparedByClass.cleric].sort()).toEqual(
      ["bane", "bless", "command", "cure-wounds", "guiding-bolt", "healing-word"]
    );
  });

  it("does not confirm a full list or an unknown capacity", async () => {
    const full = cleric(["bless"], { level: 1, wis: 6 });
    const fullDone = openCharacterRestFlow({ type: "longRest", character: full });
    submitLongRest({ confirmUnderfill: false });
    expect(await fullDone).toEqual({});
    expect(document.getElementById("characterRestOverlay")).toBeNull();

    const unknown = cleric(["bless"]);
    unknown.build.abilities.base.wis = null;
    const unknownDone = openCharacterRestFlow({ type: "longRest", character: unknown });
    submitLongRest({ confirmUnderfill: false });
    expect(await unknownDone).toEqual({});
    expect(document.getElementById("characterRestOverlay")).toBeNull();
  });
});

describe("Long Rest prepared spells — granted spells", () => {
  const grantingSubclass = {
    id: "storm-custom",
    kind: "subclass",
    name: "Storm (custom)",
    classId: "cleric",
    grantedSpells: [{ spellId: "bless", classLevel: 1, grantType: "always_prepared" }]
  };

  it("lists grants as read-only information with no checkbox and no capacity cost", async () => {
    setActiveCustomContent([grantingSubclass]);
    const character = cleric(["bless", "cure-wounds"]);
    character.build.subclassByClass = { cleric: "storm-custom" };
    const done = openCharacterRestFlow({ type: "longRest", character });

    expect(overlay().textContent).toContain("Always prepared (no capacity used): Bless");
    // Bless is granted: it is not counted and has no ordinary checkbox.
    expect(texts(".characterRestPreparedCount")).toEqual(["Cleric — 1 of 6 prepared"]);
    choose("yes");
    expect(checkboxes().some((box) => box.dataset.spellId === "bless")).toBe(false);
    expect(checkboxes().some((box) => box.dataset.spellId === "cure-wounds")).toBe(true);

    button("Cancel").click();
    await done;
  });
});

describe("Long Rest prepared spells — submitted selection", () => {
  it("submits only the classes whose ordinary list actually changed", async () => {
    const character = cleric(["bless"]);
    character.build.levels = [
      ...Array.from({ length: 3 }, () => ({ classId: "cleric", hp: 5 })),
      ...Array.from({ length: 3 }, () => ({ classId: "wizard", hp: 4 }))
    ];
    character.build.abilities.base = { str: 10, dex: 10, con: 12, int: 16, wis: 16, cha: 10 };
    character.build.spellcasting = {
      cleric: { cantripIds: [], knownIds: [], preparedIds: [] },
      wizard: { cantripIds: [], knownIds: ["magic-missile"], preparedIds: [] }
    };
    character.rest = { hitDiceSpent: {}, preparedByClass: { cleric: ["bless"], wizard: ["magic-missile"] } };

    const done = openCharacterRestFlow({ type: "longRest", character });
    choose("yes");
    toggle("command", true);
    submitLongRest();

    expect(await done).toEqual({ preparedByClass: { cleric: ["bless", "command"] } });
  });

  it("omits prepared spells entirely when 'Yes' is chosen but nothing changes", async () => {
    const character = cleric(["bless", "command"]);
    const done = openCharacterRestFlow({ type: "longRest", character });
    choose("yes");
    // Uncheck and recheck: same spells, so this is not a change.
    toggle("bless", false);
    toggle("bless", true);
    submitLongRest();

    expect(await done).toEqual({});
  });

  it("omits prepared spells when 'No' is kept", async () => {
    const character = cleric(["bless"]);
    const done = openCharacterRestFlow({ type: "longRest", character });
    submitLongRest();

    expect(await done).toEqual({});
  });

  it("blocks a selection above the effective capacity without closing", async () => {
    // Cleric 1 with Wisdom 6: capacity 1, but 15 candidates are selectable.
    const character = cleric([], { level: 1, wis: 6 });
    const done = openCharacterRestFlow({ type: "longRest", character });
    choose("yes");
    toggle("bless", true);
    toggle("command", true);
    expect(texts(".characterRestPreparedCount")).toEqual(["Cleric — 2 of 1 prepared"]);

    button("Take Long Rest").click();
    expect(overlay()).not.toBeNull();
    const validation = /** @type {HTMLElement} */ (overlay().querySelector(".characterRestValidation"));
    expect(validation.hidden).toBe(false);
    expect(validation.textContent).toBe("Cleric can prepare at most 1 spell.");

    toggle("command", false);
    button("Take Long Rest").click();
    expect(await done).toEqual({ preparedByClass: { cleric: ["bless"] } });
  });
});

describe("Long Rest prepared spells — dismissal", () => {
  it("resolves null and restores focus on Cancel", async () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();

    const done = openCharacterRestFlow({ type: "longRest", character: cleric(["bless"]) });
    button("Cancel").click();

    expect(await done).toBeNull();
    await Promise.resolve();
    expect(document.activeElement).toBe(opener);
    expect(document.getElementById("characterRestOverlay")).toBeNull();
  });

  it("resolves null on Escape", async () => {
    const done = openCharacterRestFlow({ type: "longRest", character: cleric(["bless"]) });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(await done).toBeNull();
    expect(document.getElementById("characterRestOverlay")).toBeNull();
  });

  it("resolves null on an overlay click", async () => {
    const done = openCharacterRestFlow({ type: "longRest", character: cleric(["bless"]) });
    overlay().dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(await done).toBeNull();
    expect(document.getElementById("characterRestOverlay")).toBeNull();
  });

  it("does not render a prepared block for a known-spell caster", async () => {
    const bard = makeDefaultBuilderCharacterEntry("Bard");
    bard.build.levels = Array.from({ length: 3 }, () => ({ classId: "bard", hp: 5 }));
    bard.build.abilities.base = { str: 10, dex: 10, con: 12, int: 10, wis: 10, cha: 16 };
    bard.build.spellcasting = { bard: { cantripIds: [], knownIds: [], preparedIds: [] } };
    bard.hpCur = 10;
    bard.hpMax = 20;
    bard.rest = { hitDiceSpent: {}, preparedByClass: {} };

    const done = openCharacterRestFlow({ type: "longRest", character: bard });
    expect(overlay().querySelector(".characterRestPreparedSummary")).toBeNull();
    expect(overlay().textContent).not.toContain("prepared spells?");

    button("Cancel").click();
    await done;
  });
});
