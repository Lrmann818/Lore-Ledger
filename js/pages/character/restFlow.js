// @ts-check
// Focused Short/Long Rest collection UI. Rules and validation stay in
// characterRest.js; this module only gathers a user selection.
//
// Prepared spells (Prepared Correctness C1): every number and every candidate
// comes from `getBuilderPreparedSpellOptions()` -> `getPreparedSpellPlan()`.
// This module contains no capacity, class-list, spellbook, grant-exclusion, or
// multiclass spell-level rule. It only formats the plan and reports which
// classes the player actively changed.

import {
  getBuilderPreparedSpellOptions,
  getLongRestHitDiceRecovery,
  getRestHitDicePools
} from "../../domain/characterRest.js";
import { samePreparedSelection } from "../../domain/rules/preparedSpells.js";
import { getActiveContentRegistry, getContentByKind } from "../../domain/rules/registry.js";

function el(tag, className, text = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function spellName(spellId) {
  return getContentByKind(getActiveContentRegistry(), "spell", spellId)?.name || spellId;
}

/**
 * "Cleric — 3 of 6 prepared", or "Cleric — 3 prepared" when capacity is
 * unknown. Reads the plan; computes no limit of its own.
 * @param {import("../../domain/rules/preparedSpells.js").PreparedSpellPlanEntry} option
 * @param {number} selectedCount
 * @returns {string}
 */
function formatPreparedCount(option, selectedCount) {
  return option.effectiveCapacity == null
    ? `${option.className} — ${selectedCount} prepared`
    : `${option.className} — ${selectedCount} of ${option.effectiveCapacity} prepared`;
}

/**
 * Plain-language explanation for a capacity the player cannot fully reach.
 * Returns "" when the class formula is the honest limit and needs no excuse.
 * @param {import("../../domain/rules/preparedSpells.js").PreparedSpellPlanEntry} option
 * @returns {string}
 */
function formatPreparedLimitNote(option) {
  if (option.limitedBy === "unknown") {
    return "Prepared capacity is unavailable until this character's spellcasting ability score is set.";
  }
  if (option.limitedBy !== "candidates") return "";
  if (!option.ordinaryCandidateIds.length) {
    return option.preparationMode === "spellbook"
      ? "No spells in this character's spellbook can be prepared yet."
      : "No spells from this class's list can be prepared yet.";
  }
  const allowed = option.formulaCapacity;
  const available = option.ordinaryCandidateIds.length;
  return option.preparationMode === "spellbook"
    ? `Limited by the spellbook: ${available} ${available === 1 ? "spell is" : "spells are"} available to prepare, though this class allows ${allowed}.`
    : `Limited by the available spells: ${available} ${available === 1 ? "spell is" : "spells are"} available to prepare, though this class allows ${allowed}.`;
}

/**
 * @param {{ type: "shortRest" | "longRest", character: import("../../state.js").CharacterEntry }} options
 * @returns {Promise<null | { spendByPool?: Record<string, number>, recoverByPool?: Record<string, number>, preparedByClass?: Record<string, string[]> }>}
 */
export function openCharacterRestFlow(options) {
  if (typeof document === "undefined" || !document.body) return Promise.resolve(null);
  const type = options.type;
  const character = options.character;
  const pools = getRestHitDicePools(character);
  const recovery = type === "longRest" ? getLongRestHitDiceRecovery(character) : null;
  const preparedOptions = type === "longRest" ? getBuilderPreparedSpellOptions(character) : [];

  return new Promise((resolve) => {
    const previousFocus = document.activeElement;
    const overlay = el("div", "modalOverlay characterRestOverlay");
    overlay.id = "characterRestOverlay";
    overlay.setAttribute("aria-hidden", "false");
    const panel = el("section", "modalPanel characterRestPanel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", "characterRestTitle");
    panel.tabIndex = -1;
    const title = el("div", "modalTitle", type === "shortRest" ? "Short Rest" : "Long Rest");
    title.id = "characterRestTitle";
    panel.appendChild(title);
    const body = el("div", "characterRestBody");
    panel.appendChild(body);
    const validation = el("p", "characterRestValidation");
    validation.hidden = true;
    validation.setAttribute("role", "alert");
    body.appendChild(validation);

    /** @type {Map<string, HTMLInputElement>} */
    const spendInputs = new Map();
    /** @type {Map<string, HTMLInputElement>} */
    const recoveryInputs = new Map();
    /** @type {Map<string, Set<string>>} */
    const preparedSelection = new Map();
    let changePrepared = false;
    let preparedWrap = null;

    const showValidation = (message) => {
      validation.textContent = message;
      validation.hidden = false;
    };

    const addPoolRows = ({ titleText, sourcePools, inputs, maximumKey }) => {
      if (!sourcePools.length) return;
      const section = el("section", "characterRestSection");
      section.appendChild(el("h3", "characterRestSectionTitle", titleText));
      sourcePools.forEach((pool) => {
        const row = el("label", "characterRestPoolRow");
        row.appendChild(el("span", "characterRestPoolLabel", `${pool.label} (${pool[maximumKey]} available)`));
        const input = /** @type {HTMLInputElement} */ (el("input", "settingsInput"));
        input.type = "number";
        input.min = "0";
        input.max = String(pool[maximumKey]);
        input.step = "1";
        input.value = "0";
        input.dataset.restPoolId = pool.id;
        row.appendChild(input);
        inputs.set(pool.id, input);
        section.appendChild(row);
      });
      body.appendChild(section);
    };

    if (type === "shortRest") {
      body.appendChild(el("p", "muted", "Spend available Hit Dice to regain hit points. Each die adds your Constitution modifier."));
      addPoolRows({
        titleText: "Spend Hit Dice",
        sourcePools: pools.filter((pool) => pool.available > 0),
        inputs: spendInputs,
        maximumKey: "available"
      });
    } else {
      body.appendChild(el("p", "muted", "Restore hit points, eligible resources, spell slots, and death saves."));
      if (recovery?.recoveryCap) {
        if (recovery.requiresAllocation) {
          body.appendChild(el("p", "characterRestHint", `Recover ${recovery.recoveryCap} spent Hit Dice.`));
          addPoolRows({
            titleText: "Recover Hit Dice",
            sourcePools: recovery.pools,
            inputs: recoveryInputs,
            maximumKey: "spent"
          });
        } else {
          body.appendChild(el("p", "characterRestHint", `Recover ${recovery.recoveryCap} spent Hit Dice automatically.`));
        }
      }
      if (preparedOptions.length) {
        // Counts first, and outside the collapsible picker: "keep current" is
        // only an informed choice if the current-versus-effective numbers are
        // already on screen (rest-rules-spec §4).
        const summary = el("section", "characterRestSection characterRestPreparedSummary");
        summary.appendChild(el("h3", "characterRestSectionTitle", "Prepared Spells"));
        /** @type {Map<string, () => void>} */
        const refreshCount = new Map();

        preparedOptions.forEach((option) => {
          const selected = new Set(option.selectedIds);
          preparedSelection.set(option.classId, selected);

          const summaryCount = el("p", "characterRestPreparedCount");
          summaryCount.dataset.classId = option.classId;
          summary.appendChild(summaryCount);
          const limitNote = formatPreparedLimitNote(option);
          if (limitNote) summary.appendChild(el("p", "characterRestHint", limitNote));
          if (option.grantedIds.length) {
            summary.appendChild(el(
              "p",
              "characterRestHint characterRestGrantedList",
              `Always prepared (no capacity used): ${option.grantedIds.map(spellName).join(", ")}`
            ));
          }
          refreshCount.set(option.classId, () => {
            summaryCount.textContent = formatPreparedCount(option, selected.size);
          });
        });
        body.appendChild(summary);

        const question = el("fieldset", "characterRestPreparedQuestion");
        question.appendChild(el("legend", "characterRestSectionTitle", "Would you like to change your prepared spells?"));
        const noLabel = el("label", "characterRestChoice");
        const no = /** @type {HTMLInputElement} */ (el("input"));
        no.type = "radio";
        no.name = "characterRestPreparedChoice";
        no.value = "no";
        no.checked = true;
        noLabel.append(no, document.createTextNode(" No — keep current prepared spells"));
        const yesLabel = el("label", "characterRestChoice");
        const yes = /** @type {HTMLInputElement} */ (el("input"));
        yes.type = "radio";
        yes.name = "characterRestPreparedChoice";
        yes.value = "yes";
        yesLabel.append(yes, document.createTextNode(" Yes — choose prepared spells"));
        question.append(noLabel, yesLabel);
        body.appendChild(question);

        preparedWrap = el("div", "characterRestPreparedLists");
        preparedWrap.hidden = true;
        preparedOptions.forEach((option) => {
          const selected = /** @type {Set<string>} */ (preparedSelection.get(option.classId));
          const section = el("section", "characterRestSection");
          const heading = el("h3", "characterRestSectionTitle");
          section.appendChild(heading);
          const syncSummary = refreshCount.get(option.classId);
          const refresh = () => {
            heading.textContent = formatPreparedCount(option, selected.size);
            syncSummary?.();
          };
          refresh();

          // Granted spells are read-only: never a checkbox, never counted.
          if (option.grantedIds.length) {
            section.appendChild(el(
              "p",
              "characterRestHint characterRestGrantedList",
              `Always prepared (no capacity used): ${option.grantedIds.map(spellName).join(", ")}`
            ));
          }
          const limitNote = formatPreparedLimitNote(option);
          if (limitNote) section.appendChild(el("p", "characterRestHint", limitNote));

          option.ordinaryCandidateIds.forEach((spellId) => {
            const label = el("label", "characterRestSpellRow");
            const checkbox = /** @type {HTMLInputElement} */ (el("input"));
            checkbox.type = "checkbox";
            checkbox.checked = selected.has(spellId);
            // An unknown capacity cannot be validated against, so the list is
            // shown as read-only context rather than an unusable picker.
            checkbox.disabled = option.effectiveCapacity == null;
            checkbox.dataset.classId = option.classId;
            checkbox.dataset.spellId = spellId;
            checkbox.addEventListener("change", () => {
              if (checkbox.checked) selected.add(spellId);
              else selected.delete(spellId);
              refresh();
            });
            label.append(checkbox, document.createTextNode(` ${spellName(spellId)}`));
            section.appendChild(label);
          });
          preparedWrap.appendChild(section);
        });
        yes.addEventListener("change", () => {
          changePrepared = true;
          if (preparedWrap) preparedWrap.hidden = false;
        });
        no.addEventListener("change", () => {
          changePrepared = false;
          if (preparedWrap) preparedWrap.hidden = true;
        });
        body.appendChild(preparedWrap);
      }
    }

    const footer = el("div", "uiDialogFooter characterRestFooter");
    const cancel = /** @type {HTMLButtonElement} */ (el("button", "npcSmallBtn", "Cancel"));
    cancel.type = "button";
    const apply = /** @type {HTMLButtonElement} */ (el("button", "npcSmallBtn", type === "shortRest" ? "Take Short Rest" : "Take Long Rest"));
    apply.type = "button";
    footer.append(cancel, apply);
    panel.appendChild(footer);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    const close = (result) => {
      document.removeEventListener("keydown", onKeyDown);
      overlay.remove();
      try { /** @type {HTMLElement | null} */ (previousFocus)?.focus?.(); } catch { /* best effort */ }
      resolve(result);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        close(null);
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(panel.querySelectorAll(
        "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"
      )).filter((node) => !node.closest("[hidden]") && node.getAttribute("aria-hidden") !== "true");
      if (!focusable.length) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !panel.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close(null);
    });
    cancel.addEventListener("click", () => close(null));
    apply.addEventListener("click", () => {
      const readInputs = (inputs) => Object.fromEntries([...inputs.entries()].map(([poolId, input]) => [poolId, Number(input.value) || 0]));
      if (type === "longRest" && recovery?.requiresAllocation) {
        const total = Object.values(readInputs(recoveryInputs)).reduce((sum, amount) => sum + amount, 0);
        if (total !== recovery.recoveryCap) {
          showValidation(`Choose exactly ${recovery.recoveryCap} Hit Dice to recover.`);
          return;
        }
      }
      /** @type {Record<string, string[]> | undefined} */
      let preparedByClass;
      if (type === "longRest" && changePrepared) {
        // Only classes the player actually changed are submitted. Everything
        // else — including a class whose stored list holds legacy or redundant
        // granted ids — is left for the domain merge to carry through verbatim.
        /** @type {Record<string, string[]>} */
        const changedByClass = {};
        for (const option of preparedOptions) {
          const selected = [...(preparedSelection.get(option.classId) || [])];
          if (option.effectiveCapacity != null && selected.length > option.effectiveCapacity) {
            const limit = option.effectiveCapacity;
            showValidation(`${option.className} can prepare at most ${limit} ${limit === 1 ? "spell" : "spells"}.`);
            return;
          }
          if (!samePreparedSelection(option.selectedIds, selected)) {
            changedByClass[option.classId] = selected;
          }
        }
        if (Object.keys(changedByClass).length) preparedByClass = changedByClass;
      }
      close(type === "shortRest"
        ? { spendByPool: readInputs(spendInputs) }
        : { ...(recovery?.requiresAllocation ? { recoverByPool: readInputs(recoveryInputs) } : {}), ...(preparedByClass ? { preparedByClass } : {}) });
    });
    queueMicrotask(() => apply.focus());
  });
}
