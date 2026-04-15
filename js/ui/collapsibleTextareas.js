import { getActiveCharacter } from "../domain/characterHelpers.js";
import { createStateActions } from "../domain/stateActions.js";

/**
 * @typedef {{
 *   characters?: { activeId?: string | null, entries?: Array<{ ui?: { textareaCollapse?: Record<string, boolean> } }> }
 * }} CollapsibleTextareasState
 */

/**
 * @typedef {{
 *   state?: CollapsibleTextareasState,
 *   SaveManager?: { markDirty?: () => void },
 *   root?: Document | HTMLElement
 * }} CollapsibleTextareasDeps
 */

/**
 * @param {CollapsibleTextareasDeps} [deps]
 */
export function initCollapsibleTextareas({ state, SaveManager, root = document } = {}) {
    if (!state) return;
    const { mutateCharacter } = createStateActions({ state: /** @type {any} */ (state), SaveManager });
    mutateCharacter((character) => {
        const currentCharacter = /** @type {{ ui?: { textareaCollapse?: Record<string, boolean> } }} */ (character);
        if (!currentCharacter.ui) currentCharacter.ui = {};
        if (!currentCharacter.ui.textareaCollapse) currentCharacter.ui.textareaCollapse = {};
        return true;
    }, { queueSave: false });

    const btns = /** @type {HTMLButtonElement[]} */ (Array.from(root.querySelectorAll("button[data-collapse-target]")));
    btns.forEach((btn) => {
        const id = btn.getAttribute("data-collapse-target");
        const target = document.getElementById(id);
        if (!id || !target) return;

        const collapsed = !!getActiveCharacter(/** @type {any} */ (state))?.ui?.textareaCollapse?.[id];
        target.hidden = collapsed;
        btn.textContent = collapsed ? "▸" : "▾";
        btn.setAttribute("aria-expanded", (!collapsed).toString());

        if (btn.dataset.boundCollapse === "1") return;
        btn.dataset.boundCollapse = "1";

        btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            const currentTarget = document.getElementById(id);
            if (!currentTarget) return;

            const nowCollapsed = !currentTarget.hidden;
            currentTarget.hidden = nowCollapsed;

            const updated = mutateCharacter((character) => {
                const currentCharacter = /** @type {{ ui?: { textareaCollapse?: Record<string, boolean> } }} */ (character);
                if (!currentCharacter.ui) currentCharacter.ui = {};
                if (!currentCharacter.ui.textareaCollapse) currentCharacter.ui.textareaCollapse = {};
                currentCharacter.ui.textareaCollapse[id] = nowCollapsed;
                return true;
            }, { queueSave: false });
            if (!updated) return;
            btn.textContent = nowCollapsed ? "▸" : "▾";
            btn.setAttribute("aria-expanded", (!nowCollapsed).toString());

            SaveManager?.markDirty?.();
        });
    });
}
