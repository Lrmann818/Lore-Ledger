// @ts-check
// Level Up wizard: a narrow, guided flow that appends exactly one class level
// to a builder character. It asks only for the choices the appended level
// newly unlocks (subclass, feature/expertise picks, ASI/feat, cantrips, known
// spells, wizard spellbook additions, hit points), previews a before → after
// summary, and hands one validated draft build to `onApply`. Every step edits
// an isolated draft; nothing mutates character state until the caller's apply
// callback commits it in one mutation. Prepared-spell selection never happens
// here — prepared casters get capacity information only (see rest-rules-spec).

import {
  clonePlainBuild,
  isBuilderCharacter,
  normalizeCharacterBuild
} from "../../domain/characterHelpers.js";
import { deriveCharacter } from "../../domain/rules/deriveCharacter.js";
import { getLevelUpSheetSeedPatch } from "../../domain/builderSheetSeeding.js";
import {
  getActiveContentRegistry,
  getContentByKind,
  listContentByKind
} from "../../domain/rules/registry.js";
import {
  appendLevel,
  EXPERTISE_FEATURE_IDS,
  featureChoiceId,
  getLevelUpPlan,
  MAX_CHARACTER_LEVEL,
  normalizeBuildLevels,
  setLevelHpAt
} from "../../domain/rules/progression.js";
import {
  makeSelect,
  renderAsiSlot,
  renderMultiPickChoice
} from "./builderWizardSteps.js";
import { ACTIVE_CHARACTER_CHANGED_EVENT } from "../../domain/characterEvents.js";
import { enhanceSelectDropdown } from "../../ui/selectDropdown.js";
import { getNoopDestroyApi, requireMany } from "../../utils/domGuards.js";

/** @typedef {import("../../state.js").CharacterBuildState} CharacterBuildState */
/** @typedef {import("../../domain/rules/progression.js").LevelUpPlan} LevelUpPlan */

const STEP_CLASS = "class";
const STEP_SUBCLASS = "subclass";
const STEP_FEATURES = "features";
const STEP_ASI = "asi";
const STEP_SPELLS = "spells";
const STEP_HP = "hp";
const STEP_SUMMARY = "summary";
const STEP_ORDER = Object.freeze([
  STEP_CLASS, STEP_SUBCLASS, STEP_FEATURES, STEP_ASI, STEP_SPELLS, STEP_HP, STEP_SUMMARY
]);

const EXPERTISE_CHOICE_COUNT = 2;
const ORDINALS = Object.freeze([
  "Cantrips", "1st Level", "2nd Level", "3rd Level", "4th Level",
  "5th Level", "6th Level", "7th Level", "8th Level", "9th Level"
]);
const ABILITY_LABELS = Object.freeze({
  str: "Strength", dex: "Dexterity", con: "Constitution",
  int: "Intelligence", wis: "Wisdom", cha: "Charisma"
});

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * @param {number} value
 * @returns {string}
 */
function signedNumber(value) {
  return value >= 0 ? `+${value}` : String(value);
}

/**
 * @param {HTMLElement} parent
 * @param {string} tag
 * @param {string} className
 * @param {string} [text]
 * @returns {HTMLElement}
 */
function el(parent, tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  parent.appendChild(node);
  return /** @type {HTMLElement} */ (node);
}

/**
 * Clears an element's children (the unit-test DOM lacks replaceChildren).
 * @param {HTMLElement} node
 */
function clearChildren(node) {
  if (typeof node.replaceChildren === "function") {
    node.replaceChildren();
    return;
  }
  node.innerHTML = "";
}

/**
 * @param {HTMLElement} panel
 * @returns {HTMLElement[]}
 */
function getFocusable(panel) {
  const selectors = [
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "a[href]",
    "[tabindex]:not([tabindex='-1'])"
  ];
  return /** @type {HTMLElement[]} */ (Array.from(panel.querySelectorAll(selectors.join(",")))
    .filter((node) => !!node &&
      typeof /** @type {HTMLElement} */ (node).focus === "function" &&
      !/** @type {HTMLElement} */ (node).hidden &&
      !/** @type {HTMLElement} */ (node).closest("[hidden]") &&
      !/** @type {HTMLElement} */ (node).classList.contains("nativeSelectHidden")));
}

/**
 * Ensures the draft build has a spell selection bucket for a class.
 * @param {CharacterBuildState} build
 * @param {string} classId
 * @returns {{ cantripIds: string[], knownIds: string[], preparedIds: string[] }}
 */
function ensureSpellSelection(build, classId) {
  if (!isPlainObject(build.spellcasting)) build.spellcasting = {};
  const bucket = /** @type {Record<string, unknown>} */ (build.spellcasting);
  if (!isPlainObject(bucket[classId])) bucket[classId] = { cantripIds: [], knownIds: [], preparedIds: [] };
  const selection = /** @type {Record<string, unknown>} */ (bucket[classId]);
  if (!Array.isArray(selection.cantripIds)) selection.cantripIds = [];
  if (!Array.isArray(selection.knownIds)) selection.knownIds = [];
  if (!Array.isArray(selection.preparedIds)) selection.preparedIds = [];
  return /** @type {{ cantripIds: string[], knownIds: string[], preparedIds: string[] }} */ (selection);
}

/**
 * @param {{
 *   root?: ParentNode,
 *   Popovers?: import("../../ui/popovers.js").PopoversApi | null,
 *   rollDie?: (sides: number) => number,
 *   onApply?: (result: { characterId: string | null, build: CharacterBuildState, classId: string, toLevel: number }) => void,
 *   setStatus?: (message: string, options?: Record<string, unknown>) => void
 * }} [deps]
 * @returns {{ open: (options?: { character?: import("../../state.js").CharacterEntry | null }) => void, close: () => void, destroy: () => void }}
 */
export function initLevelUpWizard(deps = {}) {
  const {
    root = document,
    Popovers = null,
    rollDie = (sides) => Math.floor(Math.random() * sides) + 1,
    onApply,
    setStatus
  } = deps;

  const guard = requireMany(
    {
      overlay: "#levelUpOverlay",
      panel: "#levelUpPanel",
      title: "#levelUpTitle",
      closeBtn: "#levelUpClose",
      stepClass: "#levelUpStepClass",
      classBody: "#levelUpClassBody",
      classValidation: "#levelUpClassValidation",
      stepSubclass: "#levelUpStepSubclass",
      subclassBody: "#levelUpSubclassBody",
      subclassValidation: "#levelUpSubclassValidation",
      stepFeatures: "#levelUpStepFeatures",
      featuresBody: "#levelUpFeaturesBody",
      stepAsi: "#levelUpStepAsi",
      asiBody: "#levelUpAsiBody",
      stepSpells: "#levelUpStepSpells",
      spellsBody: "#levelUpSpellsBody",
      spellsValidation: "#levelUpSpellsValidation",
      stepHp: "#levelUpStepHp",
      hpBody: "#levelUpHpBody",
      hpValidation: "#levelUpHpValidation",
      stepSummary: "#levelUpStepSummary",
      summaryBody: "#levelUpSummaryBody",
      cancelBtn: "#levelUpCancel",
      backBtn: "#levelUpBack",
      nextBtn: "#levelUpNext",
      applyBtn: "#levelUpApply"
    },
    {
      root,
      setStatus,
      context: "Level Up wizard",
      devAssert: false,
      warn: false
    }
  );
  if (!guard.ok) {
    const noop = getNoopDestroyApi();
    return { open() {}, close() {}, destroy: noop.destroy };
  }

  const overlay = /** @type {HTMLElement} */ (guard.els.overlay);
  const panel = /** @type {HTMLElement} */ (guard.els.panel);
  const titleEl = /** @type {HTMLElement} */ (guard.els.title);
  const closeBtn = /** @type {HTMLButtonElement} */ (guard.els.closeBtn);
  const stepEls = {
    [STEP_CLASS]: /** @type {HTMLElement} */ (guard.els.stepClass),
    [STEP_SUBCLASS]: /** @type {HTMLElement} */ (guard.els.stepSubclass),
    [STEP_FEATURES]: /** @type {HTMLElement} */ (guard.els.stepFeatures),
    [STEP_ASI]: /** @type {HTMLElement} */ (guard.els.stepAsi),
    [STEP_SPELLS]: /** @type {HTMLElement} */ (guard.els.stepSpells),
    [STEP_HP]: /** @type {HTMLElement} */ (guard.els.stepHp),
    [STEP_SUMMARY]: /** @type {HTMLElement} */ (guard.els.stepSummary)
  };
  const classBody = /** @type {HTMLElement} */ (guard.els.classBody);
  const classValidation = /** @type {HTMLElement} */ (guard.els.classValidation);
  const subclassBody = /** @type {HTMLElement} */ (guard.els.subclassBody);
  const subclassValidation = /** @type {HTMLElement} */ (guard.els.subclassValidation);
  const featuresBody = /** @type {HTMLElement} */ (guard.els.featuresBody);
  const asiBody = /** @type {HTMLElement} */ (guard.els.asiBody);
  const spellsBody = /** @type {HTMLElement} */ (guard.els.spellsBody);
  const spellsValidation = /** @type {HTMLElement} */ (guard.els.spellsValidation);
  const hpBody = /** @type {HTMLElement} */ (guard.els.hpBody);
  const hpValidation = /** @type {HTMLElement} */ (guard.els.hpValidation);
  const summaryBody = /** @type {HTMLElement} */ (guard.els.summaryBody);
  const cancelBtn = /** @type {HTMLButtonElement} */ (guard.els.cancelBtn);
  const backBtn = /** @type {HTMLButtonElement} */ (guard.els.backBtn);
  const nextBtn = /** @type {HTMLButtonElement} */ (guard.els.nextBtn);
  const applyBtn = /** @type {HTMLButtonElement} */ (guard.els.applyBtn);

  const listenerController = new AbortController();
  const signal = listenerController.signal;

  /** @type {Element | null} */
  let previousFocus = null;
  /** @type {string | null} */
  let openingCharacterId = null;
  /** @type {Record<string, unknown> | null} */
  let beforeCharacter = null;
  /** @type {CharacterBuildState | null} */
  let beforeBuild = null;
  let selectedClassId = "";
  let multiclassMode = false;
  /** @type {{ build: CharacterBuildState } | null} */
  let draft = null;
  /** @type {LevelUpPlan | null} */
  let basePlan = null;
  /** @type {LevelUpPlan | null} */
  let plan = null;
  /** @type {"max" | "average" | "roll" | "manual"} */
  let hpMode = "average";
  /** @type {number | null} */
  let hpRolled = null;
  /** @type {number | null} */
  let hpManual = null;
  let currentStep = STEP_CLASS;
  let applying = false;
  /** @type {Array<{ select: HTMLSelectElement, api: { rebuild?: () => void, close?: () => void, destroy?: () => void } }>} */
  const dynamicEnhancedSelects = [];

  /** @param {HTMLSelectElement} select */
  function enhanceDynamicSelect(select) {
    for (let i = dynamicEnhancedSelects.length - 1; i >= 0; i -= 1) {
      if (!dynamicEnhancedSelects[i].select.isConnected) {
        try { dynamicEnhancedSelects[i].api.destroy?.(); } catch { /* noop */ }
        dynamicEnhancedSelects.splice(i, 1);
      }
    }
    if (!Popovers) return;
    const api = enhanceSelectDropdown({
      select,
      Popovers,
      buttonClass: "settingsSelectBtn builderWizardSelectBtn",
      optionClass: "swatchOption",
      groupLabelClass: "dropdownGroupLabel",
      preferRight: false
    });
    if (api) dynamicEnhancedSelects.push({ select, api });
  }

  /** @type {import("./builderWizardSteps.js").WizardStepContext} */
  const stepCtx = {
    getDraft: () => ({ name: "", build: /** @type {CharacterBuildState} */ (draft?.build) }),
    getRegistry: () => getActiveContentRegistry(),
    signal,
    enhanceSelect: enhanceDynamicSelect,
    onDraftChanged: () => {}
  };

  /**
   * The plan build is the BEFORE build plus any pending subclass pick. The
   * subclass is only choosable when the appended level is exactly the class's
   * subclass level, so storing it on the before-build adds no before-features.
   * @returns {LevelUpPlan | null}
   */
  function computePlan() {
    if (!beforeBuild || !selectedClassId) return null;
    const planBuild = /** @type {CharacterBuildState} */ (clonePlainBuild(beforeBuild));
    const pendingSubclass = cleanString(
      isPlainObject(draft?.build?.subclassByClass)
        ? /** @type {Record<string, string>} */ (draft.build.subclassByClass)[selectedClassId]
        : ""
    );
    if (pendingSubclass) {
      if (!isPlainObject(planBuild.subclassByClass)) planBuild.subclassByClass = {};
      /** @type {Record<string, string>} */ (planBuild.subclassByClass)[selectedClassId] = pendingSubclass;
    }
    return getLevelUpPlan(planBuild, selectedClassId, getActiveContentRegistry());
  }

  /** Rebuilds the isolated draft from the before build + selected class. */
  function rebuildDraft() {
    const build = /** @type {CharacterBuildState} */ (clonePlainBuild(beforeBuild));
    if (selectedClassId) appendLevel(build, selectedClassId);
    draft = { build };
    basePlan = beforeBuild && selectedClassId
      ? getLevelUpPlan(beforeBuild, selectedClassId, getActiveContentRegistry())
      : null;
    plan = computePlan();
    hpMode = "average";
    hpRolled = null;
    hpManual = null;
  }

  /**
   * @param {string} step
   * @returns {boolean}
   */
  function isStepAvailable(step) {
    if (step === STEP_CLASS || step === STEP_HP || step === STEP_SUMMARY) return true;
    if (!plan) return false;
    if (step === STEP_SUBCLASS) return !!basePlan?.subclassRequired;
    if (step === STEP_FEATURES) return plan.newFeatureIds.length > 0;
    if (step === STEP_ASI) return !!plan.asiSlot;
    if (step === STEP_SPELLS) return plan.spellcastingDelta.length > 0;
    return true;
  }

  /** @param {string} step */
  function getNextStep(step) {
    const index = STEP_ORDER.indexOf(step);
    for (let i = index + 1; i < STEP_ORDER.length; i += 1) {
      if (isStepAvailable(STEP_ORDER[i])) return STEP_ORDER[i];
    }
    return STEP_SUMMARY;
  }

  /** @param {string} step */
  function getPreviousStep(step) {
    const index = STEP_ORDER.indexOf(step);
    for (let i = index - 1; i >= 0; i -= 1) {
      if (isStepAvailable(STEP_ORDER[i])) return STEP_ORDER[i];
    }
    return STEP_CLASS;
  }

  /**
   * @param {HTMLElement} target
   * @param {string} message
   */
  function showValidation(target, message) {
    target.textContent = message;
    target.hidden = !message;
    if (message) setStatus?.(message, { stickyMs: 2500 });
  }

  function clearValidations() {
    showValidation(classValidation, "");
    showValidation(subclassValidation, "");
    showValidation(spellsValidation, "");
    showValidation(hpValidation, "");
  }

  /** @returns {ReturnType<typeof deriveCharacter> | null} */
  function getDraftDerived() {
    if (!beforeCharacter || !draft) return null;
    try {
      return deriveCharacter({ ...beforeCharacter, build: draft.build }, getActiveContentRegistry());
    } catch {
      return null;
    }
  }

  /* ------------------------------- steps ------------------------------- */

  function renderClassStep() {
    clearChildren(classBody);
    const registry = getActiveContentRegistry();
    const levels = beforeBuild ? normalizeBuildLevels(beforeBuild) : [];
    const continueClassId = levels.length ? levels[levels.length - 1].classId : "";
    const continueEntry = continueClassId ? getContentByKind(registry, "class", continueClassId) : null;

    const beforeDerived = beforeCharacter
      ? deriveCharacter(beforeCharacter, registry)
      : null;
    el(classBody, "p", "levelUpLockedContext",
      `Current: ${beforeDerived?.labels.classLevel || "—"} (Level ${levels.length})`);

    const modeField = el(classBody, "div", "builderIdentityField levelUpClassModeField");
    if (continueEntry) {
      const continueLabel = /** @type {HTMLLabelElement} */ (document.createElement("label"));
      continueLabel.className = "builderAbilityMethodOption levelUpClassMode";
      const continueRadio = /** @type {HTMLInputElement} */ (document.createElement("input"));
      continueRadio.type = "radio";
      continueRadio.name = "levelUpClassMode";
      continueRadio.value = "continue";
      continueRadio.checked = !multiclassMode;
      continueLabel.appendChild(continueRadio);
      const continueText = document.createElement("span");
      continueText.textContent = `Continue as ${continueEntry.name}`;
      continueLabel.appendChild(continueText);
      modeField.appendChild(continueLabel);

      const otherLabel = /** @type {HTMLLabelElement} */ (document.createElement("label"));
      otherLabel.className = "builderAbilityMethodOption levelUpClassMode";
      const otherRadio = /** @type {HTMLInputElement} */ (document.createElement("input"));
      otherRadio.type = "radio";
      otherRadio.name = "levelUpClassMode";
      otherRadio.value = "multiclass";
      otherRadio.checked = multiclassMode;
      otherLabel.appendChild(otherRadio);
      const otherText = document.createElement("span");
      otherText.textContent = "Take a level in another class (multiclass)";
      otherLabel.appendChild(otherText);
      modeField.appendChild(otherLabel);

      continueRadio.addEventListener("change", () => {
        if (!continueRadio.checked) return;
        multiclassMode = false;
        selectedClassId = continueClassId;
        rebuildDraft();
        renderClassStep();
      }, { signal });
      otherRadio.addEventListener("change", () => {
        if (!otherRadio.checked) return;
        multiclassMode = true;
        renderClassStep();
      }, { signal });
    } else {
      multiclassMode = true;
    }

    if (multiclassMode) {
      const classField = el(classBody, "div", "builderIdentityField");
      el(classField, "span", "", "Class");
      const classOptions = listContentByKind(registry, "class")
        .map((entry) => ({ value: entry.id, label: entry.name }));
      const classSelect = makeSelect(classField, classOptions,
        selectedClassId === continueClassId && !multiclassMode ? "" : selectedClassId, "Choose class");
      classSelect.id = "levelUpClassSelect";
      classSelect.addEventListener("change", () => {
        const value = cleanString(classSelect.value);
        selectedClassId = value || "";
        rebuildDraft();
        renderClassStep();
      }, { signal });
      enhanceDynamicSelect(classSelect);
    }

    if (plan?.prerequisiteWarnings.length) {
      el(classBody, "div", "builderWizardValidation builderMulticlassWarning",
        `Multiclass prerequisites not met (allowed, but house-rules territory): ${plan.prerequisiteWarnings.join("; ")}.`);
      const warning = classBody.lastChild;
      if (warning && /** @type {HTMLElement} */ (warning).hidden !== undefined) {
        /** @type {HTMLElement} */ (warning).hidden = false;
      }
    }

    if (plan) {
      el(classBody, "p", "builderAbilityMethodNote",
        `This adds one level: ${plan.className} ${plan.classLevel} (character level ${plan.toLevel}).`);
    }

    // A brand-new class's SRD multiclass skill choice is asked here (spec §5).
    if (plan?.multiclassSkillChoiceId && draft) {
      const classEntry = getContentByKind(registry, "class", plan.classId);
      const skillChoices = isPlainObject(classEntry?.data?.multiclassing)
        ? classEntry.data.multiclassing.skillChoices
        : null;
      if (isPlainObject(skillChoices) && Array.isArray(skillChoices.from)) {
        const choose = Number(skillChoices.choose) || 1;
        const options = skillChoices.from
          .map((skillId) => {
            const entry = getContentByKind(registry, "skill", cleanString(skillId));
            return { value: cleanString(skillId), label: entry?.name || cleanString(skillId) };
          })
          .filter((option) => option.value);
        renderMultiPickChoice(stepCtx, classBody, {
          label: `${classEntry?.name || plan.classId} (multiclass): choose ${choose} skill${choose > 1 ? "s" : ""}`,
          count: choose,
          options,
          choiceId: plan.multiclassSkillChoiceId,
          // Class/multiclass skill choices live under level key "1" (existing
          // storage convention — see level-up spec Gap D).
          levelKey: "1",
          emptyLabel: "Choose skill"
        });
      }
    }
  }

  function renderSubclassStep() {
    clearChildren(subclassBody);
    const registry = getActiveContentRegistry();
    const required = basePlan?.subclassRequired;
    if (!required || !draft) return;
    const classEntry = getContentByKind(registry, "class", required.classId);
    const flavor = cleanString(classEntry?.data && /** @type {{subclassFlavor?: unknown}} */ (classEntry.data).subclassFlavor);
    const field = el(subclassBody, "div", "builderIdentityField builderSubclassField");
    el(field, "span", "", `${classEntry?.name || required.classId} — ${flavor || "Subclass"}`);
    const options = required.options
      .map((subclassId) => {
        const entry = getContentByKind(registry, "subclass", subclassId);
        return { value: subclassId, label: entry?.name || subclassId };
      });
    if (!isPlainObject(draft.build.subclassByClass)) draft.build.subclassByClass = {};
    const stored = cleanString(
      /** @type {Record<string, string>} */ (draft.build.subclassByClass)[required.classId]
    );
    const select = makeSelect(field, options, stored, "Choose subclass");
    select.id = "levelUpSubclassSelect";
    select.addEventListener("change", () => {
      const value = cleanString(select.value);
      if (value) /** @type {Record<string, string>} */ (draft.build.subclassByClass)[required.classId] = value;
      else delete /** @type {Record<string, string>} */ (draft.build.subclassByClass)[required.classId];
      plan = computePlan();
      showValidation(subclassValidation, "");
      renderSubclassPreview();
    }, { signal });
    enhanceDynamicSelect(select);

    const preview = el(subclassBody, "div", "levelUpGainList levelUpSubclassPreview");
    preview.id = "levelUpSubclassPreview";
    function renderSubclassPreview() {
      clearChildren(preview);
      const chosen = cleanString(
        /** @type {Record<string, string>} */ (draft.build.subclassByClass)[required.classId]
      );
      if (!chosen) return;
      const subclassEntry = getContentByKind(registry, "subclass", chosen);
      const desc = cleanString(subclassEntry?.data?.desc);
      if (desc) {
        const item = el(preview, "div", "levelUpGainItem");
        el(item, "div", "levelUpGainName", subclassEntry?.name || chosen);
        el(item, "div", "levelUpGainDesc", desc);
      }
    }
    renderSubclassPreview();
  }

  function renderFeaturesStep() {
    clearChildren(featuresBody);
    const registry = getActiveContentRegistry();
    if (!plan || !draft) return;

    const levelKey = String(plan.toLevel);
    const skillOptions = listContentByKind(registry, "skill")
      .map((entry) => ({ value: entry.id, label: entry.name }));

    /** @type {string[]} */
    const readOnlyFeatureIds = [];
    for (const featureId of plan.newFeatureIds) {
      const featureEntry = getContentByKind(registry, "feature", featureId);
      const subOptions = featureEntry && isPlainObject(featureEntry.data?.subfeatureOptions)
        ? featureEntry.data.subfeatureOptions
        : null;
      if (subOptions && Array.isArray(subOptions.from) && subOptions.from.length) {
        const choose = Number.isInteger(Number(subOptions.choose)) ? Number(subOptions.choose) : 1;
        const options = subOptions.from.map((subId) => {
          const subEntry = getContentByKind(registry, "feature", cleanString(subId));
          return {
            value: cleanString(subId),
            label: (subEntry?.name || cleanString(subId)).replace(/^Fighting Style:\s*/, "")
          };
        });
        renderMultiPickChoice(stepCtx, featuresBody, {
          label: `${featureEntry?.name || featureId} (Level ${plan.toLevel})`,
          count: choose,
          options,
          choiceId: featureChoiceId(featureId),
          levelKey,
          emptyLabel: "Choose option"
        });
        continue;
      }
      if (EXPERTISE_FEATURE_IDS.has(featureId)) {
        renderMultiPickChoice(stepCtx, featuresBody, {
          label: `${featureEntry?.name || "Expertise"} (Level ${plan.toLevel}): choose ${EXPERTISE_CHOICE_COUNT} skills`,
          count: EXPERTISE_CHOICE_COUNT,
          options: skillOptions,
          choiceId: featureChoiceId(featureId),
          levelKey,
          emptyLabel: "Choose skill"
        });
        continue;
      }
      readOnlyFeatureIds.push(featureId);
    }

    if (readOnlyFeatureIds.length) {
      el(featuresBody, "h4", "builderWizardSubTitle", "You also gain");
      const list = el(featuresBody, "div", "levelUpGainList");
      for (const featureId of readOnlyFeatureIds) {
        const featureEntry = getContentByKind(registry, "feature", featureId);
        const item = el(list, "div", "levelUpGainItem");
        el(item, "div", "levelUpGainName", featureEntry?.name || featureId);
        const desc = cleanString(featureEntry?.data?.desc);
        if (desc) el(item, "div", "levelUpGainDesc", desc);
      }
    }
  }

  function renderAsiStep() {
    clearChildren(asiBody);
    const registry = getActiveContentRegistry();
    if (!plan?.asiSlot || !draft) return;
    const featOptions = listContentByKind(registry, "feat")
      .map((entry) => ({ value: entry.id, label: entry.source === "custom" ? `${entry.name} (custom)` : entry.name }));
    const abilityOptions = Object.entries(ABILITY_LABELS)
      .map(([value, label]) => ({ value, label }));
    renderAsiSlot(stepCtx, asiBody, plan.asiSlot, featOptions, abilityOptions);
  }

  function renderSpellsStep() {
    clearChildren(spellsBody);
    const registry = getActiveContentRegistry();
    if (!plan || !draft) return;

    const allSpells = listContentByKind(registry, "spell");
    /** @param {string} spellId @returns {string} */
    const spellName = (spellId) => getContentByKind(registry, "spell", spellId)?.name || spellId;

    for (const delta of plan.spellcastingDelta) {
      const section = el(spellsBody, "section", "builderSpellClassSection levelUpSpellSection");
      el(section, "h4", "builderWizardSubTitle", `${delta.className} Spellcasting`);

      const beforeSelection = isPlainObject(beforeBuild?.spellcasting) &&
        isPlainObject(/** @type {Record<string, unknown>} */ (beforeBuild.spellcasting)[delta.classId])
        ? /** @type {{ cantripIds?: unknown, knownIds?: unknown }} */ (
          /** @type {Record<string, unknown>} */ (beforeBuild.spellcasting)[delta.classId])
        : {};
      const lockedCantrips = Array.isArray(beforeSelection.cantripIds)
        ? beforeSelection.cantripIds.map(cleanString).filter(Boolean)
        : [];
      const lockedKnown = Array.isArray(beforeSelection.knownIds)
        ? beforeSelection.knownIds.map(cleanString).filter(Boolean)
        : [];

      // Informational lines: prepared capacity and newly available levels.
      if (delta.preparationMode === "prepared" || delta.preparationMode === "spellbook") {
        if (delta.preparedCapacityAfter != null) {
          const row = el(section, "div", "levelUpInfoRow");
          el(row, "span", "builderSummaryLabel", "Prepared capacity");
          el(row, "span", "builderSummaryValue",
            delta.preparedCapacityBefore != null && delta.preparedCapacityBefore !== delta.preparedCapacityAfter
              ? `${delta.preparedCapacityBefore} → ${delta.preparedCapacityAfter}`
              : String(delta.preparedCapacityAfter));
        }
        el(section, "p", "builderAbilityMethodNote",
          "Prepared spells are chosen when finishing a Long Rest, not here.");
      }
      if (delta.newSpellLevels.length) {
        const row = el(section, "div", "levelUpInfoRow");
        el(row, "span", "builderSummaryLabel", "New spell levels");
        el(row, "span", "builderSummaryValue",
          delta.newSpellLevels.map((level) => ORDINALS[level]).join(", "));
      }
      if (delta.grantedSpellIds.length) {
        const row = el(section, "div", "levelUpInfoRow");
        el(row, "span", "builderSummaryLabel", "Granted");
        el(row, "span", "builderSummaryValue", delta.grantedSpellIds.map(spellName).join(", "));
      }

      const classSpells = allSpells.filter((entry) => {
        const classIds = Array.isArray(entry.data?.classIds) ? entry.data.classIds : [];
        return classIds.includes(delta.classId);
      });
      const maxSpellLevel = (() => {
        if (delta.progression === "pact") return plan.pactAfter?.slotLevel ?? 1;
        let max = 0;
        plan.slotsAfter.forEach((count, index) => { if (count > 0) max = index + 1; });
        return Math.max(1, max);
      })();
      const selection = ensureSpellSelection(draft.build, delta.classId);

      /**
       * @param {{
       *   title: string,
       *   gained: number,
       *   listKey: "cantripIds" | "knownIds",
       *   spellLevels: number[],
       *   locked: string[]
       * }} config
       */
      const renderDeltaPicker = ({ title, gained, listKey, spellLevels, locked }) => {
        if (gained <= 0) return;
        const group = el(section, "div", "builderSpellGroup levelUpSpellGroup");
        const head = el(group, "div", "builderSpellGroupHead");
        el(head, "span", "builderSpellGroupTitle", title);
        const lockedSet = new Set(locked);
        const newlyChosen = () => selection[listKey].filter((id) => !lockedSet.has(id));
        const countEl = el(head, "span", "builderSpellGroupCount",
          `${newlyChosen().length} / ${gained} chosen`);
        if (locked.length) {
          el(group, "p", "levelUpLockedContext",
            `Already chosen: ${locked.map(spellName).join(", ")}`);
        }
        const list = el(group, "div", "builderSpellCheckList");
        /** @type {HTMLInputElement[]} */
        const checkboxes = [];
        const refresh = () => {
          const atCap = newlyChosen().length >= gained;
          countEl.textContent = `${newlyChosen().length} / ${gained} chosen`;
          for (const checkbox of checkboxes) {
            if (!checkbox.checked) checkbox.disabled = atCap;
          }
        };
        const candidates = classSpells
          .filter((entry) => spellLevels.includes(Number(entry.data?.level) || 0))
          .filter((entry) => !lockedSet.has(entry.id));
        for (const spellEntry of candidates) {
          const label = document.createElement("label");
          label.className = "builderSpellCheckItem";
          const checkbox = /** @type {HTMLInputElement} */ (document.createElement("input"));
          checkbox.type = "checkbox";
          checkbox.checked = selection[listKey].includes(spellEntry.id);
          checkbox.addEventListener("change", () => {
            const ids = selection[listKey];
            const index = ids.indexOf(spellEntry.id);
            if (checkbox.checked && index < 0) {
              if (newlyChosen().length >= gained) {
                checkbox.checked = false;
                return;
              }
              ids.push(spellEntry.id);
            }
            if (!checkbox.checked && index >= 0 && !lockedSet.has(spellEntry.id)) {
              ids.splice(index, 1);
            }
            refresh();
          }, { signal });
          checkboxes.push(checkbox);
          label.appendChild(checkbox);
          const nameSpan = document.createElement("span");
          const ritual = spellEntry.data?.ritual === true ? " (ritual)" : "";
          const concentration = spellEntry.data?.concentration === true ? " (conc.)" : "";
          const levelTag = Number(spellEntry.data?.level) > 0 ? ` — ${ORDINALS[Number(spellEntry.data?.level)]}` : "";
          nameSpan.textContent = `${spellEntry.name}${levelTag}${ritual}${concentration}`;
          label.appendChild(nameSpan);
          list.appendChild(label);
        }
        refresh();
      };

      renderDeltaPicker({
        title: `New cantrips (${delta.cantripsGained})`,
        gained: delta.cantripsGained,
        listKey: "cantripIds",
        spellLevels: [0],
        locked: lockedCantrips
      });
      if (delta.preparationMode === "known") {
        renderDeltaPicker({
          title: `New known spells (${delta.knownGained})`,
          gained: delta.knownGained,
          listKey: "knownIds",
          spellLevels: Array.from({ length: maxSpellLevel }, (_, i) => i + 1),
          locked: lockedKnown
        });
      }
      if (delta.preparationMode === "spellbook") {
        renderDeltaPicker({
          title: `Spellbook additions (${delta.spellbookGained})`,
          gained: delta.spellbookGained,
          listKey: "knownIds",
          spellLevels: Array.from({ length: maxSpellLevel }, (_, i) => i + 1),
          locked: lockedKnown
        });
      }
    }
  }

  function renderHpStep() {
    clearChildren(hpBody);
    if (!plan || !draft) return;
    const die = plan.hitDie;
    const derived = getDraftDerived();
    const conMod = derived?.abilities.con?.modifier ?? null;
    const storedMax = beforeCharacter && Number.isFinite(Number(beforeCharacter.hpMax))
      ? Number(beforeCharacter.hpMax)
      : null;

    el(hpBody, "p", "levelUpLockedContext",
      `Current max HP: ${storedMax != null ? storedMax : "—"} · New level: ${plan.className} ${plan.classLevel} (d${die ?? "?"})`);

    if (plan.toLevel === 1) {
      el(hpBody, "p", "builderAbilityMethodNote",
        `Level 1 always uses the maximum hit die${die ? ` (${die})` : ""} plus your Constitution modifier.`);
      setLevelHpAt(draft.build, plan.toLevel - 1, null);
      return;
    }
    if (die == null) {
      el(hpBody, "p", "builderWizardValidation",
        "This class has no hit die in the registry; HP for this level uses the model default.");
      return;
    }

    const average = Math.trunc(die / 2) + 1;
    const mathLine = el(hpBody, "p", "levelUpHpMath", "");
    const modeRow = el(hpBody, "div", "levelUpHpModeRow");

    const manualField = el(hpBody, "div", "levelUpManualHpField");
    const manualLabel = el(manualField, "span", "", "Manual result:");
    manualLabel.id = "levelUpManualHpLabel";
    const manualInput = /** @type {HTMLInputElement} */ (document.createElement("input"));
    manualInput.type = "number";
    manualInput.id = "levelUpManualHpInput";
    manualInput.className = "builderLevelHpInput";
    manualInput.min = "1";
    manualInput.max = String(die);
    manualInput.step = "1";
    manualInput.inputMode = "numeric";
    manualInput.setAttribute("aria-labelledby", "levelUpManualHpLabel");
    manualField.appendChild(manualInput);

    /** @returns {number | null} */
    const currentHpValue = () => {
      if (hpMode === "max") return die;
      if (hpMode === "average") return average;
      if (hpMode === "roll") return hpRolled;
      return hpManual;
    };

    const syncMath = () => {
      const value = currentHpValue();
      if (value == null) {
        mathLine.textContent = hpMode === "roll"
          ? "Roll the die to see this level's hit points."
          : "Enter this level's hit die result.";
      } else if (conMod == null) {
        mathLine.textContent = `${value} (Constitution modifier is not set — HP totals cannot be derived).`;
      } else {
        mathLine.textContent = `${value} ${conMod >= 0 ? "+" : "−"} ${Math.abs(conMod)} (Con) = +${Math.max(0, value + conMod)} HP`;
      }
      // Average is the model default (stored as null); everything else stores
      // the concrete die result on the draft's new level row.
      setLevelHpAt(draft.build, plan.toLevel - 1, hpMode === "average" ? null : value);
      showValidation(hpValidation, "");
    };

    /** @type {Array<{ id: "max" | "average" | "roll", label: string }>} */
    const modes = [
      { id: "max", label: `Max (${die})` },
      { id: "average", label: `Average (${average})` },
      { id: "roll", label: "Roll" }
    ];
    /** @type {HTMLButtonElement[]} */
    const modeButtons = [];
    const syncModeButtons = () => {
      modeButtons.forEach((button) => {
        button.setAttribute("aria-pressed", (button.dataset.hpMode === hpMode).toString());
      });
    };
    for (const mode of modes) {
      const button = /** @type {HTMLButtonElement} */ (el(modeRow, "button", "npcSmallBtn levelUpHpModeBtn", mode.label));
      button.type = "button";
      button.dataset.hpMode = mode.id;
      button.id = `levelUpHpMode${mode.id.charAt(0).toUpperCase()}${mode.id.slice(1)}`;
      button.addEventListener("click", () => {
        hpMode = mode.id;
        if (mode.id === "roll") {
          hpRolled = Math.max(1, Math.min(die, Math.trunc(Number(rollDie(die))) || 1));
          button.textContent = `Roll (rolled ${hpRolled})`;
        }
        syncModeButtons();
        syncMath();
      }, { signal });
      modeButtons.push(button);
    }

    manualInput.addEventListener("input", () => {
      const value = Number(manualInput.value);
      hpManual = Number.isFinite(value) && value >= 1 ? Math.min(die, Math.trunc(value)) : null;
      hpMode = "manual";
      syncModeButtons();
      syncMath();
    }, { signal });

    syncModeButtons();
    syncMath();
  }

  function renderSummaryStep() {
    clearChildren(summaryBody);
    if (!plan || !draft || !beforeCharacter) return;
    const registry = getActiveContentRegistry();
    const beforeDerived = deriveCharacter(beforeCharacter, registry);
    const afterCharacter = { ...beforeCharacter, build: clonePlainBuild(draft.build) };
    const afterDerived = deriveCharacter(afterCharacter, registry);
    const preview = getLevelUpSheetSeedPatch(beforeCharacter, afterCharacter, registry);

    const rows = el(summaryBody, "div", "builderWizardSummaryRows");
    /** @param {string} label @param {string} value */
    const addRow = (label, value) => {
      const row = el(rows, "div", "builderSummaryRow");
      el(row, "div", "builderSummaryLabel", label);
      el(row, "div", "builderSummaryValue", value);
    };

    addRow("Level", `${plan.fromLevel} → ${plan.toLevel}`);
    addRow("Class", `${beforeDerived.labels.classLevel || "—"} → ${afterDerived.labels.classLevel || "—"}`);
    if (plan.proficiencyBonusBefore !== plan.proficiencyBonusAfter) {
      addRow("Proficiency Bonus",
        `${signedNumber(plan.proficiencyBonusBefore)} → ${signedNumber(plan.proficiencyBonusAfter)}`);
    }
    const storedMax = Number.isFinite(Number(beforeCharacter.hpMax)) ? Number(beforeCharacter.hpMax) : null;
    const nextMax = preview.patch.hpMax != null ? Number(preview.patch.hpMax) : storedMax;
    addRow("Max HP", storedMax != null || nextMax != null
      ? `${storedMax ?? "—"} → ${nextMax ?? "—"}`
      : "—");
    const hitDiceLabel = (derived) => derived.hitDice.length
      ? derived.hitDice.map((pool) => `${pool.count}d${pool.die ?? "?"}`).join(" + ")
      : "—";
    addRow("Hit Dice", `${hitDiceLabel(beforeDerived)} → ${hitDiceLabel(afterDerived)}`);
    if (plan.newFeatureIds.length) {
      const names = plan.newFeatureIds.map((featureId) =>
        getContentByKind(registry, "feature", featureId)?.name || featureId);
      addRow("New Features", names.join(", "));
    }
    const slotsChanged = plan.slotsAfter.some((count, index) => count !== plan.slotsBefore[index]);
    if (slotsChanged) {
      const describeSlots = (slots) => slots
        .map((count, index) => (count > 0 ? `${ORDINALS[index + 1]}: ${count}` : null))
        .filter(Boolean)
        .join(", ") || "none";
      addRow("Spell Slots", `${describeSlots(plan.slotsBefore)} → ${describeSlots(plan.slotsAfter)}`);
    } else if (plan.spellcastingDelta.length === 0) {
      addRow("Spell Slots", "unchanged");
    }
    const pactChanged = JSON.stringify(plan.pactBefore) !== JSON.stringify(plan.pactAfter);
    if (pactChanged && plan.pactAfter) {
      const describePact = (pact) => (pact ? `${pact.slots} × ${ORDINALS[pact.slotLevel]}` : "none");
      addRow("Pact Magic", `${describePact(plan.pactBefore)} → ${describePact(plan.pactAfter)}`);
    }

    if (preview.preserved.length) {
      el(summaryBody, "h4", "builderWizardSubTitle", "Preserved");
      const list = el(summaryBody, "ul", "levelUpPreservedList");
      for (const line of preview.preserved) el(list, "li", "", line);
    }
    if (preview.warnings.length) {
      const warningsEl = el(summaryBody, "div", "builderWizardValidation builderSummaryWarnings",
        `Warnings: ${preview.warnings.join("; ")}`);
      warningsEl.hidden = false;
    }
  }

  /* ---------------------------- navigation ----------------------------- */

  function syncStep() {
    plan = computePlan();
    for (const [step, element] of Object.entries(stepEls)) {
      element.hidden = step !== currentStep;
    }
    backBtn.hidden = currentStep === STEP_CLASS;
    nextBtn.hidden = currentStep === STEP_SUMMARY;
    applyBtn.hidden = currentStep !== STEP_SUMMARY;
    if (currentStep === STEP_CLASS) renderClassStep();
    if (currentStep === STEP_SUBCLASS) renderSubclassStep();
    if (currentStep === STEP_FEATURES) renderFeaturesStep();
    if (currentStep === STEP_ASI) renderAsiStep();
    if (currentStep === STEP_SPELLS) renderSpellsStep();
    if (currentStep === STEP_HP) renderHpStep();
    if (currentStep === STEP_SUMMARY) renderSummaryStep();
  }

  /** @returns {boolean} whether the current step allows advancing */
  function validateCurrentStep() {
    if (currentStep === STEP_CLASS) {
      if (!selectedClassId || !plan) {
        showValidation(classValidation, "Choose a class to continue.");
        return false;
      }
      showValidation(classValidation, "");
    }
    if (currentStep === STEP_SUBCLASS) {
      const required = basePlan?.subclassRequired;
      const chosen = required && isPlainObject(draft?.build?.subclassByClass)
        ? cleanString(/** @type {Record<string, string>} */ (draft.build.subclassByClass)[required.classId])
        : "";
      if (required && !chosen) {
        showValidation(subclassValidation, "Choose a subclass to continue.");
        return false;
      }
      showValidation(subclassValidation, "");
    }
    if (currentStep === STEP_HP) {
      if (plan && plan.toLevel > 1 && plan.hitDie != null) {
        if (hpMode === "roll" && hpRolled == null) {
          showValidation(hpValidation, "Roll the die or choose another method.");
          return false;
        }
        if (hpMode === "manual" && hpManual == null) {
          showValidation(hpValidation, `Enter a result from 1 to ${plan.hitDie}.`);
          return false;
        }
      }
      showValidation(hpValidation, "");
    }
    return true;
  }

  function close() {
    for (const enhanced of dynamicEnhancedSelects) {
      try { enhanced.api.destroy?.(); } catch { /* noop */ }
    }
    dynamicEnhancedSelects.length = 0;
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");
    const target = previousFocus && typeof /** @type {HTMLElement} */ (previousFocus).focus === "function"
      ? /** @type {HTMLElement} */ (previousFocus)
      : null;
    previousFocus = null;
    openingCharacterId = null;
    beforeCharacter = null;
    beforeBuild = null;
    draft = null;
    basePlan = null;
    plan = null;
    applying = false;
    applyBtn.disabled = false;
    queueMicrotask(() => {
      try {
        target?.focus?.({ preventScroll: true });
      } catch {
        target?.focus?.();
      }
    });
  }

  /**
   * Opens the Level Up flow for one builder character below level 20.
   * @param {{ character?: import("../../state.js").CharacterEntry | null }} [options]
   */
  function open(options = {}) {
    const character = options.character ?? null;
    if (!character || !isBuilderCharacter(character)) return;
    const normalized = normalizeCharacterBuild(clonePlainBuild(character.build));
    if (!normalized) return;
    const levels = normalizeBuildLevels(normalized);
    if (levels.length >= MAX_CHARACTER_LEVEL) {
      setStatus?.("This character is already at the maximum level (20).", { stickyMs: 2500 });
      return;
    }
    openingCharacterId = typeof character.id === "string" ? character.id : null;
    let snapshot;
    try {
      snapshot = JSON.parse(JSON.stringify(character));
    } catch {
      setStatus?.("Level Up could not read this character safely.", { stickyMs: 2500 });
      return;
    }
    snapshot.build = normalized;
    beforeCharacter = snapshot;
    beforeBuild = normalized;
    selectedClassId = levels.length ? levels[levels.length - 1].classId : "";
    multiclassMode = !selectedClassId;
    applying = false;
    applyBtn.disabled = false;
    rebuildDraft();
    currentStep = STEP_CLASS;
    clearValidations();
    titleEl.textContent = `Level Up — Level ${levels.length} → ${levels.length + 1}`;
    previousFocus = document.activeElement;
    syncStep();
    overlay.hidden = false;
    overlay.setAttribute("aria-hidden", "false");
    queueMicrotask(() => {
      try {
        nextBtn.focus({ preventScroll: true });
      } catch {
        nextBtn.focus();
      }
    });
  }

  function apply() {
    if (applying || !plan || !draft || !beforeBuild) return;
    // Whole-draft validation: exactly one appended level, required subclass
    // chosen, and a usable HP result.
    const beforeCount = normalizeBuildLevels(beforeBuild).length;
    const afterCount = normalizeBuildLevels(draft.build).length;
    if (afterCount !== beforeCount + 1 || afterCount > MAX_CHARACTER_LEVEL) {
      setStatus?.("Level Up draft is invalid — nothing was changed.", { stickyMs: 2500 });
      return;
    }
    const required = basePlan?.subclassRequired;
    if (required) {
      const chosen = isPlainObject(draft.build.subclassByClass)
        ? cleanString(/** @type {Record<string, string>} */ (draft.build.subclassByClass)[required.classId])
        : "";
      if (!chosen) {
        currentStep = STEP_SUBCLASS;
        syncStep();
        showValidation(subclassValidation, "Choose a subclass before applying.");
        return;
      }
    }
    applying = true;
    applyBtn.disabled = true;
    try {
      onApply?.({
        characterId: openingCharacterId,
        build: /** @type {CharacterBuildState} */ (clonePlainBuild(draft.build)),
        classId: selectedClassId,
        toLevel: plan.toLevel
      });
    } finally {
      close();
    }
  }

  /** @param {Event} event */
  function handleKeydown(event) {
    const e = /** @type {KeyboardEvent} */ (event);
    if (overlay.hidden) return;
    if (e.key === "Escape") {
      const target = /** @type {{ closest?: (selector: string) => Element | null } | null} */ (
        e.target && typeof e.target === "object" ? e.target : null
      );
      if (target?.closest?.(".selectDropdown, .dropdownMenu")) return;
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== "Tab") return;
    const focusables = getFocusable(panel);
    if (!focusables.length) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === panel)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  nextBtn.addEventListener("click", () => {
    if (!validateCurrentStep()) return;
    currentStep = getNextStep(currentStep);
    syncStep();
  }, { signal });
  backBtn.addEventListener("click", () => {
    currentStep = getPreviousStep(currentStep);
    syncStep();
  }, { signal });
  applyBtn.addEventListener("click", apply, { signal });
  cancelBtn.addEventListener("click", close, { signal });
  closeBtn.addEventListener("click", close, { signal });
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  }, { signal });
  document.addEventListener("keydown", handleKeydown, { signal });

  // If the active character changes while the flow is open, cancel safely and
  // mutate neither character (mirrors the shipped rest guard).
  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener(ACTIVE_CHARACTER_CHANGED_EVENT, () => {
      if (overlay.hidden) return;
      close();
      setStatus?.("Level Up was canceled because the active character changed.", { stickyMs: 2500 });
    }, { signal });
  }

  return {
    open,
    close,
    destroy() {
      for (const enhanced of dynamicEnhancedSelects) {
        try { enhanced.api.destroy?.(); } catch { /* noop */ }
      }
      dynamicEnhancedSelects.length = 0;
      listenerController.abort();
      close();
    }
  };
}
