// @vitest-environment jsdom
//
// R5-B1: the incomplete-required-choices banner and the focused Complete
// Choices dialog. The controller is driven with injected fake deps
// (mutateCharacter / rerender / setStatus / uiAlert) so every rule — banner
// derivation, "required only, never under-cap", draft isolation, the single
// atomic commit, additive seeding, active-character and campaign isolation, and
// the dialog's focus/keyboard contract — is tested independently of the page.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  formatIncompleteChoicesBannerMessage,
  initCompleteChoicesFlow
} from "../js/pages/character/completeChoicesFlow.js";
import {
  makeDefaultBuilderCharacterEntry,
  makeDefaultCharacterEntry
} from "../js/domain/characterHelpers.js";

const FLOW_HTML = `
  <section id="page-character">
    <div class="charSelectorBar" id="charSelectorBar"></div>
    <div class="charIncompleteChoices" id="charIncompleteChoices" role="status" aria-live="polite" hidden>
      <span class="charIncompleteChoicesMsg" id="charIncompleteChoicesText"></span>
      <div class="charIncompleteChoicesActions">
        <button type="button" class="panelBtnSm charIncompleteChoicesBtn"
          id="charIncompleteChoicesBtn">Complete Choices</button>
      </div>
    </div>
    <div class="charColumns" id="charColumns"></div>
  </section>
  <div id="completeChoicesOverlay" class="modalOverlay" hidden aria-hidden="true">
    <div class="modalPanel completeChoicesPanel" id="completeChoicesPanel" role="dialog" aria-modal="true"
      aria-labelledby="completeChoicesTitle" tabindex="-1">
      <div class="completeChoicesHeader">
        <div class="modalTitle" id="completeChoicesTitle">Complete Choices</div>
        <button type="button" class="npcSmallBtn" id="completeChoicesClose" aria-label="Close">✕</button>
      </div>
      <div class="completeChoicesScroll">
        <p class="completeChoicesIntro" id="completeChoicesIntro">intro</p>
        <div class="completeChoicesEmpty" id="completeChoicesEmpty" hidden>
          All required choices are complete. Choose Apply to save them.
        </div>
        <div class="completeChoicesBody" id="completeChoicesBody"></div>
        <div class="completeChoicesStatus" id="completeChoicesStatus" role="status" aria-live="polite" hidden></div>
      </div>
      <div class="completeChoicesFooter">
        <button type="button" class="npcSmallBtn" id="completeChoicesCancel">Cancel</button>
        <button type="button" class="npcSmallBtn" id="completeChoicesApply">Apply</button>
      </div>
    </div>
  </div>
`;

let flows = [];
const track = (api) => { flows.push(api); return api; };

beforeEach(() => {
  document.body.innerHTML = FLOW_HTML;
});

afterEach(() => {
  flows.forEach((api) => { try { api?.destroy?.(); } catch { /* noop */ } });
  flows = [];
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

const tick = () => new Promise((r) => setTimeout(r, 0));
async function settle() { await tick(); await tick(); await tick(); }

const $ = (id) => document.getElementById(id);
const banner = () => $("charIncompleteChoices");
const bannerBtn = () => $("charIncompleteChoicesBtn");
const body = () => $("completeChoicesBody");
const overlay = () => $("completeChoicesOverlay");
const applyBtn = () => $("completeChoicesApply");
const itemKeys = () => Array.from(body().querySelectorAll(".completeChoicesItem[data-choice-key]"))
  .map((node) => node.dataset.choiceKey);

function click(node) {
  node.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
}
function change(node) {
  node.dispatchEvent(new Event("change", { bubbles: true }));
}

/** A builder character with the supplied build overlaid on the defaults. */
function builderCharacter(over = {}, id = "char_a") {
  const entry = makeDefaultBuilderCharacterEntry("Ada");
  entry.id = id;
  Object.assign(entry.build, {
    raceId: "human",
    backgroundId: "acolyte",
    levels: [{ classId: "fighter", hp: null }],
    ...over
  });
  return entry;
}

function makeHarness({ entries, activeId, campaignId = "camp_1", uiAlert, rerender } = {}) {
  const state = {
    appShell: { activeCampaignId: campaignId },
    characters: { activeId: activeId ?? entries[0]?.id ?? null, entries, snapshots: [] }
  };
  const markDirty = vi.fn();
  // Mirrors createStateActions().mutateCharacter: a mutator returning false
  // aborts without queueing a save; anything else marks dirty exactly once.
  const mutateCharacter = vi.fn((mutator) => {
    const entry = state.characters.entries.find((e) => e.id === state.characters.activeId);
    if (!entry) return false;
    const result = mutator(entry, state);
    if (result === false) return false;
    markDirty();
    return result;
  });
  const deps = {
    root: $("page-character"),
    overlayRoot: document,
    state,
    mutateCharacter,
    rerender: rerender || vi.fn(),
    setStatus: vi.fn(),
    uiAlert: uiAlert || vi.fn().mockResolvedValue(undefined),
    Popovers: null
  };
  const api = track(initCompleteChoicesFlow(deps));
  return { api, state, deps, markDirty, mutateCharacter };
}

/* ------------------------------- banner -------------------------------- */

describe("incomplete choices banner", () => {
  it("shows for an active builder character with unresolved required choices", () => {
    makeHarness({ entries: [builderCharacter()] });
    expect(banner().hidden).toBe(false);
    // Human language + Acolyte languages + Fighter skills + Fighting Style.
    expect($("charIncompleteChoicesText").textContent)
      .toBe("Character setup is incomplete — 4 required choices are unfinished.");
  });

  it("stays hidden for a freeform character", () => {
    const freeform = makeDefaultCharacterEntry("Manual");
    freeform.id = "char_f";
    expect(freeform.build).toBeNull();
    makeHarness({ entries: [freeform] });
    expect(banner().hidden).toBe(true);
  });

  it("stays hidden for a complete builder character", () => {
    makeHarness({
      entries: [builderCharacter({
        choicesByLevel: {
          "1": {
            "human-language": "dwarvish",
            "acolyte-language": ["elvish", "giant"],
            "class-skill-fighter": ["athletics", "perception"],
            "feature-fighter-fighting-style": "fighter-fighting-style-defense"
          }
        }
      })]
    });
    expect(banner().hidden).toBe(true);
  });

  it("stays hidden when the only shortfall is a permitted under-cap spell category", () => {
    makeHarness({
      entries: [builderCharacter({
        raceId: "dragonborn",
        backgroundId: null,
        levels: [{ classId: "sorcerer", hp: null }],
        subclassByClass: { sorcerer: "draconic-bloodline" },
        choicesByLevel: {
          "1": {
            "dragonborn-ancestry": "red",
            "class-skill-sorcerer": ["arcana", "deception"],
            "feature-dragon-ancestor": "dragon-ancestor-red-fire-damage"
          }
        },
        spellcasting: { sorcerer: { cantripIds: [], knownIds: [], preparedIds: [] } }
      })]
    });
    // Negative control for the three tests above: this character genuinely has
    // an unfilled spell allowance, and the banner still stays down.
    expect(banner().hidden).toBe(true);
  });

  it("stays hidden with no active character", () => {
    makeHarness({ entries: [], activeId: null });
    expect(banner().hidden).toBe(true);
  });

  it("re-derives on an active-character change", () => {
    const incomplete = builderCharacter({}, "char_a");
    const complete = builderCharacter({
      choicesByLevel: {
        "1": {
          "human-language": "dwarvish",
          "acolyte-language": ["elvish", "giant"],
          "class-skill-fighter": ["athletics", "perception"],
          "feature-fighter-fighting-style": "fighter-fighting-style-defense"
        }
      }
    }, "char_b");
    const { state } = makeHarness({ entries: [incomplete, complete], activeId: "char_a" });
    expect(banner().hidden).toBe(false);

    state.characters.activeId = "char_b";
    window.dispatchEvent(new CustomEvent("loreledger:active-character-changed", { detail: {} }));
    expect(banner().hidden).toBe(true);

    state.characters.activeId = "char_a";
    window.dispatchEvent(new CustomEvent("loreledger:active-character-changed", { detail: {} }));
    expect(banner().hidden).toBe(false);
  });

  it("pluralizes its message", () => {
    expect(formatIncompleteChoicesBannerMessage(1))
      .toBe("Character setup is incomplete — 1 required choice is unfinished.");
    expect(formatIncompleteChoicesBannerMessage(3))
      .toBe("Character setup is incomplete — 3 required choices are unfinished.");
  });
});

describe("banner markup placement (index.html)", () => {
  const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");

  it("sits directly above #charColumns and outside every panel", () => {
    const bannerIdx = html.indexOf('id="charIncompleteChoices"');
    const columnsIdx = html.indexOf('id="charColumns"');
    const pageIdx = html.indexOf('id="page-character"');
    expect(bannerIdx).toBeGreaterThan(pageIdx);
    expect(bannerIdx).toBeLessThan(columnsIdx);
    // Nothing but whitespace/comment separates the banner block from the
    // columns container, and no panel opens in between.
    const between = html.slice(bannerIdx, columnsIdx);
    expect(between).not.toMatch(/class="[^"]*\bpanel\b/);
    expect(between).not.toContain("<section");
    expect(html).toContain(">Complete Choices</button>");
  });

  it("ships the dialog anchors the controller binds", () => {
    for (const id of [
      "completeChoicesOverlay", "completeChoicesPanel", "completeChoicesTitle",
      "completeChoicesClose", "completeChoicesIntro", "completeChoicesBody",
      "completeChoicesEmpty", "completeChoicesStatus", "completeChoicesApply",
      "completeChoicesCancel"
    ]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain('id="completeChoicesPanel"');
    expect(html).toMatch(/id="completeChoicesPanel"[^>]*role="dialog"/);
  });
});

/* ------------------------------- dialog -------------------------------- */

describe("Complete Choices dialog contents", () => {
  it("opens from the banner and renders only unresolved required choices", () => {
    makeHarness({
      entries: [builderCharacter({
        choicesByLevel: { "1": { "class-skill-fighter": ["athletics", "perception"] } }
      })]
    });
    click(bannerBtn());
    expect(overlay().hidden).toBe(false);

    const keys = itemKeys();
    expect(keys).toEqual([
      "choice:human-language",
      "choice:acolyte-language",
      "choice:feature-fighter-fighting-style"
    ]);
    // A resolved choice is unreachable: no control exists for it at all.
    expect(keys).not.toContain("choice:class-skill-fighter");
    expect(body().querySelector('[data-choice-id="class-skill-fighter"]')).toBeNull();
  });

  it("never renders a permitted under-cap spell category", () => {
    makeHarness({
      entries: [builderCharacter({
        levels: [{ classId: "wizard", hp: null }],
        spellcasting: { wizard: { cantripIds: [], knownIds: [], preparedIds: [] } }
      })]
    });
    click(bannerBtn());
    const keys = itemKeys();
    // Negative control: the wizard genuinely is under its cantrip and
    // spellbook allowances, and required work IS rendered for the same build.
    expect(keys).toContain("choice:class-skill-wizard");
    expect(keys.some((key) => key.startsWith("spells:"))).toBe(false);
    expect(body().textContent).not.toContain("cantrip");
    expect(body().textContent).not.toContain("spellbook");
    expect(body().textContent).not.toContain("prepared");
  });

  it("renders a control for every required kind", () => {
    makeHarness({
      entries: [builderCharacter({
        raceId: "dragonborn",
        backgroundId: "acolyte",
        levels: Array.from({ length: 4 }, () => ({ classId: "rogue", hp: null }))
      })]
    });
    click(bannerBtn());

    const keys = itemKeys();
    expect(keys).toEqual([
      "choice:dragonborn-ancestry",     // ancestry
      "choice:acolyte-language",        // language
      "choice:class-skill-rogue",       // skills
      "subclass:rogue",                 // reached subclass
      "choice:feature-rogue-expertise-1", // expertise
      "choice:asi-4"                    // ASI slot
    ]);

    // Multi-pick choices render one select per required pick.
    const skillItem = body().querySelector('[data-choice-key="choice:class-skill-rogue"]');
    expect(skillItem.querySelectorAll("select")).toHaveLength(4);
    const expertiseItem = body().querySelector('[data-choice-key="choice:feature-rogue-expertise-1"]');
    expect(expertiseItem.querySelectorAll("select")).toHaveLength(2);
    // The ASI slot uses the shared renderer (mode select + two ability selects).
    const asiItem = body().querySelector('[data-choice-key="choice:asi-4"]');
    expect(asiItem.querySelector(".builderAsiSlot")).toBeTruthy();
    expect(asiItem.querySelectorAll("select").length).toBeGreaterThanOrEqual(3);
    // The subclass control is labelled with the class's own flavor term.
    const subclassItem = body().querySelector('[data-choice-key="subclass:rogue"]');
    expect(subclassItem.textContent).toContain("Rogue —");
  });

  it("shows the empty state when nothing required is left", () => {
    makeHarness({
      entries: [builderCharacter({
        choicesByLevel: {
          "1": {
            "human-language": "dwarvish",
            "acolyte-language": ["elvish", "giant"],
            "class-skill-fighter": ["athletics", "perception"],
            "feature-fighter-fighting-style": "fighter-fighting-style-defense"
          }
        }
      })]
    });
    // The banner is down, but a direct open (e.g. a stale click) is still safe.
    flows[flows.length - 1].open();
    expect(overlay().hidden).toBe(false);
    expect($("completeChoicesEmpty").hidden).toBe(false);
    expect(itemKeys()).toEqual([]);
  });

  it("drops a choice from the dialog as soon as it is resolved, and surfaces newly unlocked ones", () => {
    // Sorcerer 1 must pick a Sorcerous Origin; choosing Draconic Bloodline
    // grants Dragon Ancestor, which carries its own required pick.
    makeHarness({
      entries: [builderCharacter({
        raceId: "dragonborn",
        backgroundId: null,
        levels: [{ classId: "sorcerer", hp: null }]
      })]
    });
    click(bannerBtn());
    expect(itemKeys()).toContain("subclass:sorcerer");
    // Dragon Ancestor's own required pick is not offered yet.
    expect(itemKeys()).not.toContain("choice:feature-dragon-ancestor");

    const subclassSelect = body()
      .querySelector('.completeChoicesItem[data-choice-key="subclass:sorcerer"] select');
    subclassSelect.value = "draconic";
    change(subclassSelect);

    const keys = itemKeys();
    // Resolved choice disappears...
    expect(keys).not.toContain("subclass:sorcerer");
    // ...and the choice it unlocked appears in the same session.
    expect(keys).toContain("choice:feature-dragon-ancestor");
  });

  it("keeps a partially filled multi-pick in place without rebuilding", () => {
    makeHarness({ entries: [builderCharacter()] });
    click(bannerBtn());
    const item = body().querySelector('[data-choice-key="choice:class-skill-fighter"]');
    const selects = item.querySelectorAll("select");
    expect(selects).toHaveLength(2);

    selects[0].value = "athletics";
    change(selects[0]);

    // Still rendered (1 of 2), and the same DOM node — focus is not stolen.
    expect(itemKeys()).toContain("choice:class-skill-fighter");
    expect(body().querySelector('[data-choice-key="choice:class-skill-fighter"]')).toBe(item);
  });
});

/* -------------------------------- apply --------------------------------- */

describe("Complete Choices apply", () => {
  function openAndResolveFightingStyle(harness) {
    click(bannerBtn());
    const select = body()
      .querySelector('[data-choice-key="choice:feature-fighter-fighting-style"] select');
    select.value = "fighter-fighting-style-defense";
    change(select);
    return harness;
  }

  it("commits the build and the additive seed patch in one mutation with one dirty mark", async () => {
    const harness = makeHarness({ entries: [builderCharacter()] });
    openAndResolveFightingStyle(harness);
    click(applyBtn());
    await settle();

    expect(harness.mutateCharacter).toHaveBeenCalledTimes(1);
    expect(harness.markDirty).toHaveBeenCalledTimes(1);

    const entry = harness.state.characters.entries[0];
    expect(entry.build.choicesByLevel["1"]["feature-fighter-fighting-style"])
      .toBe("fighter-fighting-style-defense");
    // Additive sheet seeding ran in the same commit.
    expect(entry.features).toContain("Fighting Style: Defense");
    expect(overlay().hidden).toBe(true);
    expect(harness.deps.rerender).toHaveBeenCalledTimes(1);
    expect(harness.deps.setStatus).toHaveBeenCalledWith(
      "Character choices updated.", expect.anything()
    );
  });

  it("leaves the banner up after a partial-progress commit", async () => {
    const harness = makeHarness({ entries: [builderCharacter()] });
    openAndResolveFightingStyle(harness);
    click(applyBtn());
    await settle();

    // The saved choice persisted...
    expect(harness.state.characters.entries[0].build.choicesByLevel["1"]
      ["feature-fighter-fighting-style"]).toBe("fighter-fighting-style-defense");
    // ...and the still-unresolved languages/skills keep the banner visible.
    harness.api.refresh();
    expect(banner().hidden).toBe(false);
    expect($("charIncompleteChoicesText").textContent)
      .toBe("Character setup is incomplete — 3 required choices are unfinished.");
  });

  it("hides the banner once the last required choice is committed", async () => {
    const harness = makeHarness({
      entries: [builderCharacter({
        choicesByLevel: {
          "1": {
            "human-language": "dwarvish",
            "acolyte-language": ["elvish", "giant"],
            "class-skill-fighter": ["athletics", "perception"]
          }
        }
      })]
    });
    expect(banner().hidden).toBe(false);
    openAndResolveFightingStyle(harness);
    click(applyBtn());
    await settle();

    harness.api.refresh();
    expect(banner().hidden).toBe(true);
  });

  it("does not mutate or mark dirty on a no-op Apply", async () => {
    const harness = makeHarness({ entries: [builderCharacter()] });
    click(bannerBtn());
    click(applyBtn());
    await settle();

    expect(harness.mutateCharacter).not.toHaveBeenCalled();
    expect(harness.markDirty).not.toHaveBeenCalled();
    expect(harness.deps.rerender).not.toHaveBeenCalled();
    expect(overlay().hidden).toBe(true);
    expect(harness.deps.setStatus).toHaveBeenCalledWith("No choices were changed.", expect.anything());
  });

  it("writes nothing on Cancel", async () => {
    const harness = makeHarness({ entries: [builderCharacter()] });
    const before = JSON.stringify(harness.state.characters.entries[0]);
    openAndResolveFightingStyle(harness);
    click($("completeChoicesCancel"));
    await settle();

    expect(harness.mutateCharacter).not.toHaveBeenCalled();
    expect(harness.markDirty).not.toHaveBeenCalled();
    expect(JSON.stringify(harness.state.characters.entries[0])).toBe(before);
    expect(overlay().hidden).toBe(true);
  });

  it("re-applying adds no duplicate seeded content", async () => {
    const harness = makeHarness({ entries: [builderCharacter()] });
    openAndResolveFightingStyle(harness);
    click(applyBtn());
    await settle();
    const afterFirst = harness.state.characters.entries[0].features;
    expect(afterFirst).toContain("Fighting Style: Defense");

    // Resolve a different choice and apply again: the previously seeded line
    // must not be appended a second time.
    click(bannerBtn());
    const skillSelects = body()
      .querySelectorAll('[data-choice-key="choice:class-skill-fighter"] select');
    skillSelects[0].value = "athletics";
    change(skillSelects[0]);
    skillSelects[1].value = "perception";
    change(skillSelects[1]);
    click(applyBtn());
    await settle();

    const features = harness.state.characters.entries[0].features;
    const occurrences = features.split("Fighting Style: Defense").length - 1;
    expect(occurrences).toBe(1);
  });

  it("aborts without writing when the active character changed", async () => {
    const other = builderCharacter({}, "char_b");
    const harness = makeHarness({ entries: [builderCharacter({}, "char_a"), other], activeId: "char_a" });
    click(bannerBtn());
    const select = body()
      .querySelector('[data-choice-key="choice:feature-fighter-fighting-style"] select');
    select.value = "fighter-fighting-style-defense";
    change(select);

    // Switch the active character behind the dialog's back, without firing the
    // event (the harshest case: the dialog is still open on stale identity).
    harness.state.characters.activeId = "char_b";
    click(applyBtn());
    await settle();

    expect(harness.mutateCharacter).not.toHaveBeenCalled();
    expect(harness.markDirty).not.toHaveBeenCalled();
    expect(other.build.choicesByLevel).toEqual({});
    expect(overlay().hidden).toBe(true);
  });

  it("aborts without writing when the active campaign changed", async () => {
    const uiAlert = vi.fn().mockResolvedValue(undefined);
    const harness = makeHarness({ entries: [builderCharacter()], uiAlert });
    openAndResolveFightingStyle(harness);
    harness.state.appShell.activeCampaignId = "camp_2";
    click(applyBtn());
    await settle();

    expect(harness.mutateCharacter).not.toHaveBeenCalled();
    expect(harness.markDirty).not.toHaveBeenCalled();
    expect(uiAlert).toHaveBeenCalledTimes(1);
    expect(overlay().hidden).toBe(true);
  });

  it("closes the open dialog without mutating when the active character changes", async () => {
    const harness = makeHarness({ entries: [builderCharacter()] });
    openAndResolveFightingStyle(harness);
    window.dispatchEvent(new CustomEvent("loreledger:active-character-changed", { detail: {} }));
    await settle();

    expect(overlay().hidden).toBe(true);
    expect(harness.mutateCharacter).not.toHaveBeenCalled();
    expect(harness.state.characters.entries[0].build.choicesByLevel).toEqual({});
  });
});

/* --------------------------- lifecycle / a11y ---------------------------- */

describe("Complete Choices dialog lifecycle", () => {
  it("closes on Escape and restores focus to the banner button", async () => {
    makeHarness({ entries: [builderCharacter()] });
    bannerBtn().focus();
    click(bannerBtn());
    expect(overlay().hidden).toBe(false);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await settle();
    expect(overlay().hidden).toBe(true);
    expect(document.activeElement).toBe(bannerBtn());
  });

  it("closes on an overlay click but not on a panel click", () => {
    makeHarness({ entries: [builderCharacter()] });
    click(bannerBtn());
    click($("completeChoicesPanel"));
    expect(overlay().hidden).toBe(false);

    overlay().dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
    expect(overlay().hidden).toBe(true);
  });

  it("traps Tab inside the panel", () => {
    makeHarness({ entries: [builderCharacter()] });
    click(bannerBtn());
    const focusables = Array.from($("completeChoicesPanel").querySelectorAll(
      "button:not([disabled]), select:not([disabled]), input:not([disabled])"
    ));
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    last.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(first);

    first.focus();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }));
    expect(document.activeElement).toBe(last);
  });

  it("defers Escape to a stacked confirm/alert dialog", () => {
    makeHarness({ entries: [builderCharacter()] });
    click(bannerBtn());
    const stacked = document.createElement("div");
    stacked.id = "uiDialogOverlay";
    const stackedBtn = document.createElement("button");
    stacked.appendChild(stackedBtn);
    document.body.appendChild(stacked);
    stackedBtn.focus();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(overlay().hidden).toBe(false);
  });

  it("is inert after destroy and leaves no banner behind", () => {
    const harness = makeHarness({ entries: [builderCharacter()] });
    expect(banner().hidden).toBe(false);
    harness.api.destroy();

    expect(banner().hidden).toBe(true);
    click(bannerBtn());
    expect(overlay().hidden).toBe(true);
    harness.api.open();
    expect(overlay().hidden).toBe(true);
    harness.api.refresh();
    expect(banner().hidden).toBe(true);
  });

  it("does not duplicate listeners or DOM when re-initialized like a rerender", async () => {
    const entries = [builderCharacter()];
    const first = makeHarness({ entries });
    first.api.destroy();
    const second = makeHarness({ entries });

    click(bannerBtn());
    expect(overlay().hidden).toBe(false);
    // One controller alive → one rendered control set, not two.
    expect(body().querySelectorAll('[data-choice-key="choice:class-skill-fighter"]')).toHaveLength(1);

    const select = body()
      .querySelector('[data-choice-key="choice:feature-fighter-fighting-style"] select');
    select.value = "fighter-fighting-style-defense";
    change(select);
    click(applyBtn());
    await settle();

    // Exactly one mutation, from the live controller only.
    expect(second.mutateCharacter).toHaveBeenCalledTimes(1);
    expect(first.mutateCharacter).not.toHaveBeenCalled();
    expect(second.markDirty).toHaveBeenCalledTimes(1);
  });

  it("survives a malformed build without throwing or raising a false banner", async () => {
    const broken = makeDefaultBuilderCharacterEntry("Broken");
    broken.id = "char_x";
    broken.build = { version: 2, levels: "nope", choicesByLevel: 7, spellcasting: null };
    const harness = (() => {
      let made;
      expect(() => { made = makeHarness({ entries: [broken] }); }).not.toThrow();
      return made;
    })();
    // No affirmative required descriptor can be derived, so no banner.
    expect(banner().hidden).toBe(true);

    // A direct open still degrades safely to the empty state and writes nothing.
    harness.api.open();
    expect(overlay().hidden).toBe(false);
    expect(itemKeys()).toEqual([]);
    expect($("completeChoicesEmpty").hidden).toBe(false);
    click(applyBtn());
    await settle();
    expect(harness.mutateCharacter).not.toHaveBeenCalled();
    expect(harness.markDirty).not.toHaveBeenCalled();
  });
});
