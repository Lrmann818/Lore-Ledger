// @ts-check
// js/ui/customContentManager.js
// "Manage Custom Content" dialog: list, create, edit, and remove campaign
// custom records through forms instead of hand-written JSON (builder
// completion matrix #15).
//
// The dialog shell is static markup in index.html (#customContentOverlay) so
// the boot-created uiDialog overlay stacks above it for confirmations.
// Draft normalization and validation live in js/domain/customContentAuthoring.js;
// this module only renders drafts and reports field errors inline.

import { uiConfirm } from "./dialogs.js";
import {
  addCustomContentRecords,
  listCustomContent,
  removeCustomContentRecord,
  updateCustomContentRecord
} from "../domain/customContent.js";
import {
  DAMAGE_TYPES,
  FEAT_EFFECT_TYPES,
  SAVE_ABILITIES,
  SPELL_ATTACK_TYPES,
  SPELL_SCHOOLS,
  createFeatDraft,
  createSpellDraft,
  featDraftFromRecord,
  normalizeFeatDraft,
  normalizeSpellDraft,
  spellDraftFromRecord
} from "../domain/customContentAuthoring.js";
import { findCharactersReferencingContent } from "../domain/characterPortability.js";
import { getActiveContentRegistry, listContentByKind } from "../domain/rules/registry.js";
import { requireMany } from "../utils/domGuards.js";
import { safeAsync } from "./safeAsync.js";

/** @typedef {import("../state.js").State} State */
/** @typedef {import("../domain/customContentAuthoring.js").SpellDraft} SpellDraft */
/** @typedef {import("../domain/customContentAuthoring.js").AuthoringFieldError} AuthoringFieldError */
/**
 * @typedef {{
 *   state: State,
 *   markDirty: () => void,
 *   setStatus?: (message: string) => void,
 *   onContentChanged?: () => void
 * }} CustomContentManagerDeps
 * @typedef {{ open: () => void, close: () => void, destroy: () => void }} CustomContentManagerApi
 */

/** Record kinds with an in-app authoring form. Later batches extend this. */
const AUTHORABLE_KINDS = Object.freeze(["spell", "feat"]);

/** @type {Record<string, string>} */
const KIND_LABELS = { spell: "Spell", feat: "Feat" };

const KIND_ORDER = Object.freeze([
  "race", "subrace", "class", "subclass", "background", "feat", "trait",
  "ancestry", "armor", "weapon", "pack", "spell", "language", "skill", "feature"
]);

/**
 * @param {string} value
 * @returns {string}
 */
function titleCase(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

/**
 * @param {number} level
 * @returns {string}
 */
function spellLevelLabel(level) {
  if (level === 0) return "Cantrip";
  const suffix = level === 1 ? "st" : level === 2 ? "nd" : level === 3 ? "rd" : "th";
  return `${level}${suffix} level`;
}

/**
 * @template {keyof HTMLElementTagNameMap} T
 * @param {T} tag
 * @param {string} [className]
 * @param {string} [text]
 * @returns {HTMLElementTagNameMap[T]}
 */
function el(tag, className = "", text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/**
 * @param {HTMLElement} container
 * @returns {HTMLElement[]}
 */
function getFocusable(container) {
  const selectors = [
    "a[href]", "button:not([disabled])", "input:not([disabled])",
    "select:not([disabled])", "textarea:not([disabled])",
    "summary", "[tabindex]:not([tabindex='-1'])"
  ];
  return /** @type {HTMLElement[]} */ (Array.from(container.querySelectorAll(selectors.join(","))))
    .filter((node) => {
      if (node.hasAttribute("hidden") || node.closest("[hidden]")) return false;
      return true;
    });
}

/**
 * @param {CustomContentManagerDeps} deps
 * @returns {CustomContentManagerApi}
 */
export function createCustomContentManager(deps) {
  const { state, markDirty, setStatus, onContentChanged } = deps;

  const guard = requireMany(
    {
      overlay: "#customContentOverlay",
      panel: "#customContentPanel",
      title: "#customContentTitle",
      closeBtn: "#customContentClose",
      body: "#customContentBody",
      footer: "#customContentFooter"
    },
    { root: document, context: "Custom content manager" }
  );
  if (!guard.ok) {
    return { open() { }, close() { }, destroy() { } };
  }
  const overlay = /** @type {HTMLElement} */ (guard.els.overlay);
  const panel = /** @type {HTMLElement} */ (guard.els.panel);
  const titleEl = /** @type {HTMLElement} */ (guard.els.title);
  const closeBtn = /** @type {HTMLButtonElement} */ (guard.els.closeBtn);
  const body = /** @type {HTMLElement} */ (guard.els.body);
  const footer = /** @type {HTMLElement} */ (guard.els.footer);

  const abort = new AbortController();
  /** @type {"list" | "form"} */
  let mode = "list";
  /** @type {{ kind: string, id: string } | null} */
  let editing = null;
  let formDirty = false;
  let destroyed = false;
  /** @type {HTMLElement | null} */
  let openerEl = null;
  /** @type {(() => void) | null} */
  let submitForm = null;
  /** @type {Map<string, HTMLElement>} */
  let errorSlots = new Map();
  /** @type {HTMLElement | null} */
  let formErrorBox = null;

  const notify = (/** @type {string} */ message) => {
    if (typeof setStatus === "function") setStatus(message);
  };

  function contentChanged() {
    markDirty();
    onContentChanged?.();
  }

  // --- List view -----------------------------------------------------------

  function renderList() {
    mode = "list";
    editing = null;
    formDirty = false;
    submitForm = null;
    errorSlots = new Map();
    formErrorBox = null;
    titleEl.textContent = "Custom Content";
    body.replaceChildren();
    footer.replaceChildren();

    const records = listCustomContent(state)
      .slice()
      .sort((a, b) => {
        const kindDelta = KIND_ORDER.indexOf(String(a.kind)) - KIND_ORDER.indexOf(String(b.kind));
        if (kindDelta !== 0) return kindDelta;
        return String(a.name || "").localeCompare(String(b.name || ""));
      });

    if (!records.length) {
      const empty = el("div", "customContentEmpty");
      empty.appendChild(el("p", "", "This campaign has no custom content yet."));
      empty.appendChild(el("p", "mutedSmall",
        "Create a spell below, or import records from a JSON file in Data & Settings → Custom Content."));
      body.appendChild(empty);
    } else {
      const list = el("div", "customContentList");
      for (const record of records) {
        const kind = String(record.kind || "");
        const id = String(record.id || "");
        const row = el("div", "customContentRow");
        const main = el("div", "customContentRowMain");
        main.appendChild(el("div", "customContentRowName", String(record.name || id)));
        main.appendChild(el("div", "mutedSmall", `${kind}:${id}`));
        row.appendChild(main);

        const actions = el("div", "customContentRowActions");
        if (AUTHORABLE_KINDS.includes(kind)) {
          const editBtn = el("button", "npcSmallBtn", "Edit");
          editBtn.type = "button";
          editBtn.setAttribute("aria-label", `Edit custom ${kind} ${record.name || id}`);
          editBtn.addEventListener("click", () => openForm(kind, record), { signal: abort.signal });
          actions.appendChild(editBtn);
        }
        const removeBtn = el("button", "npcSmallBtn", "Remove");
        removeBtn.type = "button";
        removeBtn.setAttribute("aria-label", `Remove custom ${kind} ${record.name || id}`);
        removeBtn.addEventListener("click", safeAsync(
          () => removeRecord(kind, id, String(record.name || id)),
          (err) => console.error(err)
        ), { signal: abort.signal });
        actions.appendChild(removeBtn);
        row.appendChild(actions);
        list.appendChild(row);
      }
      body.appendChild(list);
      body.appendChild(el("p", "mutedSmall customContentListHint",
        "Records marked Edit were made for form editing. Imported records of other types can be removed here and re-imported."));
    }

    for (const kind of AUTHORABLE_KINDS) {
      const newBtn = el("button", "npcSmallBtn", `New ${KIND_LABELS[kind]}`);
      newBtn.type = "button";
      newBtn.addEventListener("click", () => openForm(kind, null), { signal: abort.signal });
      footer.appendChild(newBtn);
    }

    const closeFooterBtn = el("button", "npcSmallBtn", "Close");
    closeFooterBtn.type = "button";
    closeFooterBtn.addEventListener("click", () => close(), { signal: abort.signal });
    footer.appendChild(closeFooterBtn);
  }

  /**
   * @param {string} kind
   * @param {string} id
   * @param {string} name
   */
  async function removeRecord(kind, id, name) {
    const referencedBy = findCharactersReferencingContent(state, kind, id);
    let message = `Remove custom ${kind} "${name}" from this campaign?`;
    if (referencedBy.length) {
      message += `\n\nUsed by: ${referencedBy.join(", ")}. Their sheets keep working, but builder details from this record will stop resolving.`;
    }
    const confirmed = await uiConfirm(message, { title: "Remove Custom Content", okText: "Remove" });
    if (!confirmed || destroyed) return;
    if (!removeCustomContentRecord(state, kind, id)) return;
    contentChanged();
    notify(`Removed custom ${kind} "${name}".`);
    renderList();
    panel.focus();
  }

  // --- Form view (spell) ---------------------------------------------------

  /**
   * @param {string} labelText
   * @param {HTMLElement} input
   * @param {{ fieldKey: string, required?: boolean, help?: string }} options
   * @returns {HTMLElement}
   */
  function fieldRow(labelText, input, options) {
    const row = el("div", "customContentField");
    const label = el("label", "customContentFieldLabel");
    label.textContent = options.required ? `${labelText} *` : labelText;
    if (input.id) label.setAttribute("for", input.id);
    row.appendChild(label);
    row.appendChild(input);
    if (options.help) row.appendChild(el("div", "mutedSmall", options.help));
    const errorSlot = el("div", "customContentFieldError");
    errorSlot.id = `customContentError-${options.fieldKey}`;
    errorSlot.hidden = true;
    input.setAttribute("aria-describedby", errorSlot.id);
    row.appendChild(errorSlot);
    errorSlots.set(options.fieldKey, errorSlot);
    return row;
  }

  /**
   * @param {string} fieldKey
   * @param {string} value
   * @returns {HTMLInputElement}
   */
  function textInput(fieldKey, value) {
    const input = el("input", "settingsInput customContentInput");
    input.type = "text";
    input.id = `customContentInput-${fieldKey}`;
    input.value = value;
    return input;
  }

  /**
   * @param {string} fieldKey
   * @param {Array<{ value: string, label: string }>} options
   * @param {string} value
   * @returns {HTMLSelectElement}
   */
  function selectInput(fieldKey, options, value) {
    const select = el("select", "settingsSelect customContentSelect");
    select.id = `customContentInput-${fieldKey}`;
    for (const option of options) {
      const node = el("option", "", option.label);
      node.value = option.value;
      select.appendChild(node);
    }
    select.value = value;
    return select;
  }

  /**
   * @param {string} fieldKey
   * @param {string} labelText
   * @param {boolean} checked
   * @returns {{ wrap: HTMLElement, input: HTMLInputElement }}
   */
  function checkboxInput(fieldKey, labelText, checked) {
    const wrap = el("label", "customContentCheckbox");
    const input = el("input");
    input.type = "checkbox";
    input.id = `customContentInput-${fieldKey}`;
    input.checked = checked;
    wrap.appendChild(input);
    wrap.appendChild(el("span", "", labelText));
    return { wrap, input };
  }

  /**
   * @param {string} fieldKey
   * @param {Array<{ value: string, label: string }>} options
   * @param {string[]} checkedIds
   * @returns {HTMLElement}
   */
  function checklist(fieldKey, options, checkedIds) {
    const wrap = el("div", "customContentChecklist");
    wrap.dataset.checklist = fieldKey;
    for (const option of options) {
      const item = el("label", "customContentCheckbox");
      const input = el("input");
      input.type = "checkbox";
      input.value = option.value;
      input.checked = checkedIds.includes(option.value);
      item.appendChild(input);
      item.appendChild(el("span", "", option.label));
      wrap.appendChild(item);
    }
    return wrap;
  }

  /**
   * @param {HTMLElement} wrap
   * @returns {string[]}
   */
  function readChecklist(wrap) {
    return Array.from(wrap.querySelectorAll("input:checked"))
      .map((input) => /** @type {HTMLInputElement} */ (input).value);
  }

  /**
   * @param {string} kind
   * @param {Record<string, unknown> | null} record null = create new
   */
  function openForm(kind, record) {
    if (!AUTHORABLE_KINDS.includes(kind)) return;
    mode = "form";
    editing = record ? { kind, id: String(record.id) } : null;
    formDirty = false;
    errorSlots = new Map();
    const kindLabel = KIND_LABELS[kind] || kind;
    titleEl.textContent = editing ? `Edit ${kindLabel}: ${record?.name || editing.id}` : `New Custom ${kindLabel}`;
    body.replaceChildren();
    footer.replaceChildren();

    const form = el("div", "customContentForm");

    formErrorBox = el("div", "customContentFormError");
    formErrorBox.setAttribute("role", "alert");
    formErrorBox.hidden = true;
    form.appendChild(formErrorBox);

    if (editing) {
      form.appendChild(el("div", "mutedSmall customContentIdNote",
        `Saved as ${kind}:${editing.id} — the id never changes, so characters keep their references.`));
    }

    const built = kind === "feat" ? buildFeatFields(form, record) : buildSpellFields(form, record);
    submitForm = built.submit;

    form.addEventListener("input", () => { formDirty = true; }, { signal: abort.signal });
    form.addEventListener("change", () => { formDirty = true; }, { signal: abort.signal });

    body.appendChild(form);

    const cancelBtn = el("button", "npcSmallBtn", "Cancel");
    cancelBtn.type = "button";
    cancelBtn.addEventListener("click", safeAsync(
      () => attemptCancelForm(),
      (err) => console.error(err)
    ), { signal: abort.signal });
    footer.appendChild(cancelBtn);

    const saveBtn = el("button", "npcSmallBtn", editing ? "Save Changes" : `Save ${kindLabel}`);
    saveBtn.type = "button";
    saveBtn.addEventListener("click", () => submitForm?.(), { signal: abort.signal });
    footer.appendChild(saveBtn);

    built.focus();
  }

  /**
   * @param {HTMLElement} form
   * @param {Record<string, unknown> | null} record
   * @returns {{ submit: () => void, focus: () => void }}
   */
  function buildSpellFields(form, record) {
    const registry = getActiveContentRegistry();
    const draft = record ? spellDraftFromRecord(record) : createSpellDraft();

    const nameInput = textInput("name", draft.name);
    form.appendChild(fieldRow("Name", nameInput, { fieldKey: "name", required: true }));

    const levelSelect = selectInput("level",
      [{ value: "", label: "Choose a level" },
        ...Array.from({ length: 10 }, (_, level) => ({ value: String(level), label: spellLevelLabel(level) }))],
      draft.level);
    form.appendChild(fieldRow("Spell level", levelSelect, { fieldKey: "level", required: true }));

    const schoolSelect = selectInput("school",
      [{ value: "", label: "Choose a school" },
        ...SPELL_SCHOOLS.map((school) => ({ value: school, label: titleCase(school) }))],
      draft.school);
    form.appendChild(fieldRow("School of magic", schoolSelect, { fieldKey: "school", required: true }));

    const castingTimeInput = textInput("castingTime", draft.castingTime);
    form.appendChild(fieldRow("Casting time", castingTimeInput, {
      fieldKey: "castingTime", required: true, help: "For example: 1 action, 1 bonus action, or 10 minutes."
    }));

    const rangeInput = textInput("range", draft.range);
    form.appendChild(fieldRow("Range", rangeInput, {
      fieldKey: "range", required: true, help: "For example: 60 feet, Self, or Touch."
    }));

    const durationInput = textInput("duration", draft.duration);
    form.appendChild(fieldRow("Duration", durationInput, {
      fieldKey: "duration", required: true, help: "For example: Instantaneous, 1 minute, or 8 hours."
    }));

    const componentsRow = el("div", "customContentCheckboxRow");
    const componentV = checkboxInput("componentV", "V (verbal)", draft.componentV);
    const componentS = checkboxInput("componentS", "S (somatic)", draft.componentS);
    const componentM = checkboxInput("componentM", "M (material)", draft.componentM);
    componentsRow.appendChild(componentV.wrap);
    componentsRow.appendChild(componentS.wrap);
    componentsRow.appendChild(componentM.wrap);
    form.appendChild(fieldRow("Components", componentsRow, { fieldKey: "components" }));

    const materialInput = textInput("material", draft.material);
    const materialRow = fieldRow("Material component", materialInput, {
      fieldKey: "material", help: "What the M component requires."
    });
    materialRow.hidden = !draft.componentM;
    form.appendChild(materialRow);
    componentM.input.addEventListener("change", () => {
      materialRow.hidden = !componentM.input.checked;
    }, { signal: abort.signal });

    const flagsRow = el("div", "customContentCheckboxRow");
    const ritual = checkboxInput("ritual", "Ritual", draft.ritual);
    const concentration = checkboxInput("concentration", "Concentration", draft.concentration);
    flagsRow.appendChild(ritual.wrap);
    flagsRow.appendChild(concentration.wrap);
    form.appendChild(fieldRow("Casting flags", flagsRow, { fieldKey: "flags" }));

    const classOptions = listContentByKind(registry, "class")
      .map((entry) => ({
        value: entry.id,
        label: entry.source === "custom" ? `${entry.name} (custom)` : entry.name
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
    const classChecklist = checklist("classIds", classOptions, draft.classIds);
    form.appendChild(fieldRow("Class spell lists", classChecklist, {
      fieldKey: "classIds",
      help: "Choose which classes can learn this spell. Without a class, the spell won't appear in builder spell pickers."
    }));

    const subclassOptions = listContentByKind(registry, "subclass")
      .map((entry) => {
        const classId = typeof entry.data?.classId === "string" ? entry.data.classId : "";
        const parent = classId ? listContentByKind(registry, "class").find((cls) => cls.id === classId) : null;
        return {
          value: entry.id,
          label: parent ? `${entry.name} (${parent.name})` : entry.name
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
    const subclassDetails = el("details", "customContentDetails");
    subclassDetails.appendChild(el("summary", "", "Subclass spell lists (optional)"));
    const subclassChecklist = checklist("subclassIds", subclassOptions, draft.subclassIds);
    subclassDetails.appendChild(subclassChecklist);
    if (draft.subclassIds.length) subclassDetails.open = true;
    const subclassRow = fieldRow("", subclassDetails, { fieldKey: "subclassIds" });
    form.appendChild(subclassRow);

    const descInput = el("textarea", "settingsInput customContentTextarea");
    descInput.id = "customContentInput-desc";
    descInput.rows = 5;
    descInput.value = draft.desc;
    form.appendChild(fieldRow("Description", descInput, { fieldKey: "desc", required: true }));

    const higherLevelInput = el("textarea", "settingsInput customContentTextarea");
    higherLevelInput.id = "customContentInput-higherLevel";
    higherLevelInput.rows = 2;
    higherLevelInput.value = draft.higherLevel;
    form.appendChild(fieldRow("At higher levels", higherLevelInput, {
      fieldKey: "higherLevel", help: "Optional: what changes when cast with a higher-level slot."
    }));

    const attackTypeSelect = selectInput("attackType",
      [{ value: "", label: "None" },
        ...SPELL_ATTACK_TYPES.map((type) => ({ value: type, label: titleCase(type) }))],
      draft.attackType);
    form.appendChild(fieldRow("Spell attack", attackTypeSelect, { fieldKey: "attackType" }));

    const saveAbilitySelect = selectInput("saveAbility",
      [{ value: "", label: "None" },
        ...SAVE_ABILITIES.map((ability) => ({ value: ability, label: ability.toUpperCase() }))],
      draft.saveAbility);
    form.appendChild(fieldRow("Saving throw", saveAbilitySelect, { fieldKey: "saveAbility" }));

    const damageTypeSelect = selectInput("damageType",
      [{ value: "", label: "None" },
        ...DAMAGE_TYPES.map((type) => ({ value: type, label: titleCase(type) }))],
      draft.damageType);
    form.appendChild(fieldRow("Damage type", damageTypeSelect, { fieldKey: "damageType" }));

    /** @returns {SpellDraft} */
    const readDraft = () => ({
      name: nameInput.value,
      level: levelSelect.value,
      school: schoolSelect.value,
      classIds: readChecklist(classChecklist),
      subclassIds: readChecklist(subclassChecklist),
      castingTime: castingTimeInput.value,
      range: rangeInput.value,
      duration: durationInput.value,
      componentV: componentV.input.checked,
      componentS: componentS.input.checked,
      componentM: componentM.input.checked,
      material: materialInput.value,
      ritual: ritual.input.checked,
      concentration: concentration.input.checked,
      desc: descInput.value,
      higherLevel: higherLevelInput.value,
      attackType: attackTypeSelect.value,
      saveAbility: saveAbilitySelect.value,
      damageType: damageTypeSelect.value
    });

    return {
      submit: () => persistRecord("spell", normalizeSpellDraft(readDraft(), {
        registry: getActiveContentRegistry(),
        existing: listCustomContent(state),
        editingId: editing ? editing.id : null
      })),
      focus: () => nameInput.focus()
    };
  }

  // --- Form view (feat) ----------------------------------------------------

  /**
   * @param {Array<{ value: string, label: string }>} options
   * @param {string} value
   * @param {string} ariaLabel
   * @param {string} marker CSS class used to read the row back
   * @returns {HTMLSelectElement}
   */
  function rowSelect(options, value, ariaLabel, marker) {
    const select = el("select", `settingsSelect customContentSelect ${marker}`);
    select.setAttribute("aria-label", ariaLabel);
    for (const option of options) {
      const node = el("option", "", option.label);
      node.value = option.value;
      select.appendChild(node);
    }
    select.value = value;
    return select;
  }

  /**
   * @param {string} value
   * @param {string} ariaLabel
   * @param {string} marker
   * @returns {HTMLInputElement}
   */
  function rowNumberInput(value, ariaLabel, marker) {
    const input = el("input", `settingsInput customContentInput customContentRowNumber ${marker}`);
    input.type = "number";
    input.setAttribute("aria-label", ariaLabel);
    input.value = value;
    return input;
  }

  /**
   * @param {HTMLElement} rowEl
   * @param {string} label
   * @returns {HTMLButtonElement}
   */
  function rowRemoveButton(rowEl, label) {
    const removeBtn = el("button", "npcSmallBtn", "Remove");
    removeBtn.type = "button";
    removeBtn.setAttribute("aria-label", label);
    removeBtn.addEventListener("click", () => {
      rowEl.remove();
      formDirty = true;
    }, { signal: abort.signal });
    return removeBtn;
  }

  /**
   * @param {HTMLElement} form
   * @param {Record<string, unknown> | null} record
   * @returns {{ submit: () => void, focus: () => void }}
   */
  function buildFeatFields(form, record) {
    const registry = getActiveContentRegistry();
    const draft = record ? featDraftFromRecord(record) : createFeatDraft();

    const nameInput = textInput("name", draft.name);
    form.appendChild(fieldRow("Name", nameInput, { fieldKey: "name", required: true }));

    const descInput = el("textarea", "settingsInput customContentTextarea");
    descInput.id = "customContentInput-desc";
    descInput.rows = 5;
    descInput.value = draft.desc;
    form.appendChild(fieldRow("Description", descInput, { fieldKey: "desc", required: true }));

    const abilityOptions = [
      { value: "", label: "Choose an ability" },
      ...SAVE_ABILITIES.map((ability) => ({ value: ability, label: ability.toUpperCase() }))
    ];

    // Prerequisites — repeatable ability + minimum-score rows.
    const prereqList = el("div", "customContentRepeat");
    prereqList.dataset.repeat = "prerequisites";
    const addPrereqRow = (row = { ability: "", minimum: "" }) => {
      const rowEl = el("div", "customContentRepeatRow");
      rowEl.appendChild(rowSelect(abilityOptions, row.ability, "Prerequisite ability", "prereqAbility"));
      const minInput = rowNumberInput(row.minimum, "Prerequisite minimum score", "prereqMin");
      minInput.min = "1";
      minInput.max = "30";
      minInput.placeholder = "Min score";
      rowEl.appendChild(minInput);
      rowEl.appendChild(rowRemoveButton(rowEl, "Remove prerequisite"));
      prereqList.appendChild(rowEl);
    };
    draft.prerequisites.forEach(addPrereqRow);
    const prereqWrap = el("div", "customContentRepeatWrap");
    prereqWrap.appendChild(prereqList);
    const addPrereqBtn = el("button", "npcSmallBtn", "+ Add prerequisite");
    addPrereqBtn.type = "button";
    addPrereqBtn.addEventListener("click", () => {
      addPrereqRow();
      formDirty = true;
    }, { signal: abort.signal });
    prereqWrap.appendChild(addPrereqBtn);
    form.appendChild(fieldRow("Prerequisites", prereqWrap, {
      fieldKey: "prerequisites",
      help: "Optional: minimum ability scores needed to take this feat (shown as guidance, never blocking)."
    }));

    // Effects — repeatable rows from the closed rules vocabulary.
    const skillOptions = [
      { value: "", label: "Choose a skill" },
      ...listContentByKind(registry, "skill")
        .map((entry) => ({ value: entry.id, label: entry.name }))
        .sort((a, b) => a.label.localeCompare(b.label))
    ];
    const effectTypeOptions = [
      { value: "", label: "Choose an effect" },
      ...FEAT_EFFECT_TYPES.map((spec) => ({ value: spec.type, label: spec.label }))
    ];
    const effectList = el("div", "customContentRepeat");
    effectList.dataset.repeat = "effects";
    const addEffectRow = (row = { type: "", value: "", ability: "", skill: "" }) => {
      const rowEl = el("div", "customContentRepeatRow");
      const typeSelect = rowSelect(effectTypeOptions, row.type, "Effect type", "effectType");
      rowEl.appendChild(typeSelect);
      const valueInput = rowNumberInput(row.value, "Effect amount", "effectValue");
      valueInput.placeholder = "Amount";
      rowEl.appendChild(valueInput);
      const abilitySelect = rowSelect(abilityOptions, row.ability, "Effect ability", "effectAbility");
      rowEl.appendChild(abilitySelect);
      const skillSelect = rowSelect(skillOptions, row.skill, "Effect skill", "effectSkill");
      rowEl.appendChild(skillSelect);
      rowEl.appendChild(rowRemoveButton(rowEl, "Remove effect"));
      const syncVisibility = () => {
        const spec = FEAT_EFFECT_TYPES.find((candidate) => candidate.type === typeSelect.value);
        valueInput.hidden = !spec || !spec.needs.includes("value");
        abilitySelect.hidden = !spec || !spec.needs.includes("ability");
        skillSelect.hidden = !spec || !spec.needs.includes("skill");
      };
      typeSelect.addEventListener("change", syncVisibility, { signal: abort.signal });
      syncVisibility();
      effectList.appendChild(rowEl);
    };
    draft.effects.forEach(addEffectRow);
    const effectWrap = el("div", "customContentRepeatWrap");
    effectWrap.appendChild(effectList);
    const addEffectBtn = el("button", "npcSmallBtn", "+ Add effect");
    addEffectBtn.type = "button";
    addEffectBtn.addEventListener("click", () => {
      addEffectRow();
      formDirty = true;
    }, { signal: abort.signal });
    effectWrap.appendChild(addEffectBtn);
    form.appendChild(fieldRow("Mechanical effects", effectWrap, {
      fieldKey: "effects",
      help: "Optional: bonuses the builder applies automatically (HP, speed, AC, initiative, ability scores, proficiencies). Anything else belongs in the description."
    }));

    const readRows = (list, mapRow) => Array.from(list.querySelectorAll(".customContentRepeatRow")).map(mapRow);
    const readDraft = () => ({
      name: nameInput.value,
      desc: descInput.value,
      prerequisites: readRows(prereqList, (rowEl) => ({
        ability: /** @type {HTMLSelectElement} */ (rowEl.querySelector(".prereqAbility"))?.value ?? "",
        minimum: /** @type {HTMLInputElement} */ (rowEl.querySelector(".prereqMin"))?.value ?? ""
      })),
      effects: readRows(effectList, (rowEl) => ({
        type: /** @type {HTMLSelectElement} */ (rowEl.querySelector(".effectType"))?.value ?? "",
        value: /** @type {HTMLInputElement} */ (rowEl.querySelector(".effectValue"))?.value ?? "",
        ability: /** @type {HTMLSelectElement} */ (rowEl.querySelector(".effectAbility"))?.value ?? "",
        skill: /** @type {HTMLSelectElement} */ (rowEl.querySelector(".effectSkill"))?.value ?? ""
      }))
    });

    return {
      submit: () => persistRecord("feat", normalizeFeatDraft(readDraft(), {
        registry: getActiveContentRegistry(),
        existing: listCustomContent(state),
        editingId: editing ? editing.id : null
      })),
      focus: () => nameInput.focus()
    };
  }

  /**
   * Shows validation errors inline without rebuilding the form, so the
   * user's entries are preserved exactly.
   * @param {AuthoringFieldError[]} errors
   */
  function showFormErrors(errors) {
    for (const slot of errorSlots.values()) {
      slot.textContent = "";
      slot.hidden = true;
    }
    /** @type {string[]} */
    const formLevel = [];
    for (const error of errors) {
      const slot = error.field ? errorSlots.get(error.field) : null;
      if (slot) {
        slot.textContent = slot.textContent ? `${slot.textContent} ${error.message}` : error.message;
        slot.hidden = false;
      } else {
        formLevel.push(error.message);
      }
    }
    if (formErrorBox) {
      formErrorBox.textContent = formLevel.length
        ? formLevel.join(" ")
        : "Fix the highlighted fields to save this record.";
      formErrorBox.hidden = false;
    }
    const firstErrored = errors.find((error) => error.field && errorSlots.get(error.field));
    if (firstErrored) {
      const input = body.querySelector(`#customContentInput-${firstErrored.field}`);
      if (input instanceof HTMLElement) input.focus();
    }
  }

  /**
   * Persists a normalized authoring result (create or edit), or renders its
   * errors inline. Shared by every content-type form.
   * @param {string} kind
   * @param {import("../domain/customContentAuthoring.js").AuthoringResult} result
   */
  function persistRecord(kind, result) {
    if (!result.ok || !result.record) {
      showFormErrors(result.errors);
      return;
    }
    if (editing) {
      const updated = updateCustomContentRecord(state, editing.kind, editing.id, result.record);
      if (!updated.ok) {
        showFormErrors(updated.errors.map((message) => ({ field: "", message })));
        return;
      }
      notify(`Updated custom ${kind} "${result.record.name}".`);
    } else {
      const added = addCustomContentRecords(state, [result.record]);
      if (added.added !== 1) {
        const messages = added.errors.flatMap((failure) => failure.errors);
        showFormErrors((messages.length ? messages : [`Could not save the ${kind}.`]).map((message) => ({ field: "", message })));
        return;
      }
      notify(`Created custom ${kind} "${result.record.name}".`);
    }
    contentChanged();
    renderList();
    panel.focus();
  }

  async function attemptCancelForm() {
    if (formDirty) {
      const discard = await uiConfirm(
        "Discard this spell? Nothing you entered here has been saved.",
        { title: "Discard Changes", okText: "Discard" }
      );
      if (!discard || destroyed) return;
    }
    renderList();
    panel.focus();
  }

  // --- Open/close/keyboard -------------------------------------------------

  function open() {
    if (destroyed) return;
    openerEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    renderList();
    overlay.hidden = false;
    overlay.setAttribute("aria-hidden", "false");
    panel.focus();
  }

  function close() {
    if (overlay.hidden) return;
    overlay.hidden = true;
    overlay.setAttribute("aria-hidden", "true");
    const opener = openerEl;
    openerEl = null;
    if (opener && document.contains(opener)) {
      try { opener.focus({ preventScroll: true }); } catch { opener.focus(); }
    }
  }

  function isUiDialogOpen() {
    const uiDialog = document.getElementById("uiDialogOverlay");
    return !!uiDialog && !uiDialog.hidden;
  }

  closeBtn.addEventListener("click", safeAsync(async () => {
    if (mode === "form" && formDirty) {
      const discard = await uiConfirm(
        "Discard this spell? Nothing you entered here has been saved.",
        { title: "Discard Changes", okText: "Discard" }
      );
      if (!discard || destroyed) return;
    }
    close();
  }, (err) => console.error(err)), { signal: abort.signal });

  // Capture-phase so the Data panel's own document Escape handler (bubble
  // phase) never sees keys meant for this dialog while it is open.
  document.addEventListener("keydown", (event) => {
    if (overlay.hidden || destroyed) return;
    if (isUiDialogOpen()) return; // a confirm is stacked on top — let it handle keys
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (mode === "form") {
        void attemptCancelForm();
      } else {
        close();
      }
      return;
    }
    if (event.key === "Tab") {
      const focusables = getFocusable(panel);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (event.shiftKey) {
        if (active === first || active === panel) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }, { capture: true, signal: abort.signal });

  overlay.addEventListener("click", (event) => {
    // Clicking the backdrop closes the list view only; a form in progress
    // must never be lost to a stray tap outside the panel.
    if (event.target !== overlay) return;
    if (mode === "list") close();
  }, { signal: abort.signal });

  return {
    open,
    close,
    destroy() {
      destroyed = true;
      abort.abort();
      overlay.hidden = true;
      overlay.setAttribute("aria-hidden", "true");
    }
  };
}
