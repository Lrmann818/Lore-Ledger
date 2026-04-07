import { safeAsync } from "../../../ui/safeAsync.js";
import { requireMany } from "../../../utils/domGuards.js";

function notifyStatus(setStatus, message) {
  if (typeof setStatus === "function") {
    setStatus(message);
    return;
  }
  console.warn(message);
}

export function initSpellsPanel(deps = {}) {
  const {
    state,
    SaveManager,

    // Spells notes storage
    textKey_spellNotes,
    putText,
    getText,
    deleteText,

    // Common UI helpers
    enhanceNumberSteppers,
    uiAlert,
    uiConfirm,
    uiPrompt,
    setStatus,
    applyTextareaSize
  } = deps;

  if (!state) throw new Error("initSpellsPanel requires state");
  if (!SaveManager) throw new Error("initSpellsPanel requires SaveManager");

  const required = {
    panelEl: "#charSpellsPanel",
    containerEl: "#spellLevels",
    addLevelBtnEl: "#addSpellLevelBtn"
  };
  const guard = requireMany(required, { root: document, setStatus, context: "Spells panel" });
  if (!guard.ok) return guard.destroy;
  const { containerEl, addLevelBtnEl } = guard.els;

  const destroyFns = [];
  const addDestroy = (destroyFn) => {
    if (typeof destroyFn === "function") destroyFns.push(destroyFn);
  };

  const listenerController = new AbortController();
  const listenerSignal = listenerController.signal;
  addDestroy(() => listenerController.abort());

  let destroyed = false;

  const spellNotesCache = new Map(); // spellId -> text
  const spellNotesSaveTimers = new Map(); // spellId -> timeoutId

  const addListener = (target, type, handler, options) => {
    if (!target || typeof target.addEventListener !== "function") return;
    const listenerOptions =
      typeof options === "boolean"
        ? { capture: options }
        : (options || {});
    target.addEventListener(type, handler, { ...listenerOptions, signal: listenerSignal });
  };

  function newTextId(prefix = "id") {
    return `${prefix}_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
  }

  function ensureSpellsV2Shape() {
    if (!state.character.spells || typeof state.character.spells !== "object") {
      state.character.spells = { levels: [] };
    }
    if (!Array.isArray(state.character.spells.levels)) state.character.spells.levels = [];
  }

  function newSpellLevel(label, hasSlots = true) {
    return {
      id: newTextId("spellLevel"),
      label: label || "New Level",
      hasSlots: !!hasSlots,
      used: null,
      total: null,
      collapsed: false,
      spells: []
    };
  }

  function newSpell(name = "") {
    return {
      id: newTextId("spell"),
      name: name || "",
      notesCollapsed: true,
      known: true,
      prepared: false,
      expended: false
    };
  }

  function flushPendingSpellNotes() {
    if (typeof putText !== "function" || typeof textKey_spellNotes !== "function") return;

    spellNotesSaveTimers.forEach((timerId) => clearTimeout(timerId));
    spellNotesSaveTimers.clear();

    spellNotesCache.forEach((text, spellId) => {
      Promise.resolve(putText(text || "", textKey_spellNotes(spellId))).catch((err) => {
        console.warn("Failed to flush spell notes:", err);
      });
    });
  }

  function scheduleSpellNotesSave(spellId, text) {
    spellNotesCache.set(spellId, text);

    const previous = spellNotesSaveTimers.get(spellId);
    if (previous) clearTimeout(previous);

    const timerId = setTimeout(() => {
      spellNotesSaveTimers.delete(spellId);
      if (destroyed || typeof putText !== "function" || typeof textKey_spellNotes !== "function") return;
      putText(spellNotesCache.get(spellId) || "", textKey_spellNotes(spellId)).catch((err) => {
        console.warn("Failed to save spell notes:", err);
      });
    }, 250);

    spellNotesSaveTimers.set(spellId, timerId);
  }

  async function ensureSpellNotesLoaded(spellId) {
    if (spellNotesCache.has(spellId)) return;
    if (typeof getText !== "function" || typeof textKey_spellNotes !== "function") {
      spellNotesCache.set(spellId, "");
      return;
    }

    const text = await getText(textKey_spellNotes(spellId));
    if (destroyed) return;
    spellNotesCache.set(spellId, text || "");
  }

  function renderLevel(level, levelIndex) {
    if (!Array.isArray(level.spells)) level.spells = [];

    const card = document.createElement("div");
    card.className = "spellLevel";

    const header = document.createElement("div");
    header.className = "spellLevelHeader";

    const left = document.createElement("div");
    left.className = "spellLevelLeft";

    const collapseBtn = document.createElement("button");
    collapseBtn.type = "button";
    collapseBtn.className = "spellCollapseBtn";
    collapseBtn.title = level.collapsed ? "Expand level" : "Collapse level";
    collapseBtn.textContent = level.collapsed ? "▸" : "▾";
    collapseBtn.setAttribute("aria-expanded", level.collapsed ? "false" : "true");
    collapseBtn.addEventListener("click", (event) => {
      event.preventDefault();
      level.collapsed = !level.collapsed;
      collapseBtn.setAttribute("aria-expanded", level.collapsed ? "false" : "true");
      SaveManager.markDirty();
      render();
    });

    const titleWrap = document.createElement("div");
    titleWrap.className = "spellLevelTitle";
    const titleInput = document.createElement("input");
    titleInput.value = level.label || "";
    titleInput.placeholder = "Level name";
    titleInput.addEventListener("input", () => {
      level.label = titleInput.value;
      SaveManager.markDirty();
    });
    titleWrap.appendChild(titleInput);

    left.appendChild(collapseBtn);
    left.appendChild(titleWrap);

    const right = document.createElement("div");
    right.className = "spellLevelRight";

    if (level.hasSlots) {
      const slots = document.createElement("div");
      slots.className = "spellSlots";
      const used = document.createElement("input");
      used.classList.add("num-sum");
      used.type = "number";
      used.placeholder = "Used";
      used.value = level.used ?? "";
      used.addEventListener("input", () => {
        level.used = used.value === "" ? null : Number(used.value);
        SaveManager.markDirty();
      });
      const sep = document.createElement("span");
      sep.className = "muted";
      sep.textContent = "/";
      const total = document.createElement("input");
      total.classList.add("num-sum");
      total.type = "number";
      total.placeholder = "Total";
      total.value = level.total ?? "";
      total.addEventListener("input", () => {
        level.total = total.value === "" ? null : Number(total.value);
        SaveManager.markDirty();
      });
      slots.appendChild(used);
      slots.appendChild(sep);
      slots.appendChild(total);
      right.appendChild(slots);
    }

    const actions = document.createElement("div");
    actions.className = "spellLevelActions";

    const addSpellBtn = document.createElement("button");
    addSpellBtn.type = "button";
    addSpellBtn.textContent = "+ Spell";
    addSpellBtn.addEventListener("click", () => {
      if (!Array.isArray(level.spells)) level.spells = [];
      level.spells.push(newSpell(""));
      SaveManager.markDirty();
      render();
    });

    const resetExpBtn = document.createElement("button");
    resetExpBtn.type = "button";
    resetExpBtn.textContent = "Reset Cast";
    resetExpBtn.title = "Clear expended/cast flags for this level";
    resetExpBtn.addEventListener("click", () => {
      level.spells.forEach((spell) => spell.expended = false);
      SaveManager.markDirty();
      render();
    });

    const deleteLevelBtn = document.createElement("button");
    deleteLevelBtn.type = "button";
    deleteLevelBtn.className = "danger";
    deleteLevelBtn.textContent = "X";
    deleteLevelBtn.addEventListener(
      "click",
      safeAsync(async () => {
        if (!(await uiConfirm?.(`Delete level "${level.label || "this level"}" and all its spells?`, {
          title: "Delete Spell Level",
          okText: "Delete"
        }))) {
          return;
        }
        if (destroyed) return;

        for (const spell of level.spells) {
          spellNotesCache.delete(spell.id);
          if (typeof deleteText === "function" && typeof textKey_spellNotes === "function") {
            await deleteText(textKey_spellNotes(spell.id));
          }
        }

        state.character.spells.levels.splice(levelIndex, 1);
        SaveManager.markDirty();
        render();
      }, (err) => {
        console.error(err);
        notifyStatus(setStatus, "Delete spell level failed.");
      })
    );

    actions.appendChild(addSpellBtn);
    actions.appendChild(resetExpBtn);
    actions.appendChild(deleteLevelBtn);
    right.appendChild(actions);

    header.appendChild(left);
    header.appendChild(right);
    card.appendChild(header);

    if (!level.collapsed) {
      const body = document.createElement("div");
      body.className = "spellBody";

      if (!level.spells.length) {
        const empty = document.createElement("div");
        empty.className = "mutedSmall";
        empty.textContent = "No spells yet. Click + Spell.";
        body.appendChild(empty);
      } else {
        level.spells.forEach((spell, spellIndex) => body.appendChild(renderSpell(level, spell, levelIndex, spellIndex)));
      }

      card.appendChild(body);
    }

    return card;
  }

  function renderSpell(level, spell, levelIndex, spellIndex) {
    const row = document.createElement("div");
    row.className = "spellRow";

    const top = document.createElement("div");
    top.className = "spellRowTop";

    const collapseBtn = document.createElement("button");
    collapseBtn.type = "button";
    collapseBtn.className = "spellSpellCollapseBtn";
    collapseBtn.title = spell.notesCollapsed ? "Show notes" : "Hide notes";
    collapseBtn.textContent = spell.notesCollapsed ? "▸" : "▾";
    collapseBtn.setAttribute("aria-expanded", spell.notesCollapsed ? "false" : "true");
    collapseBtn.addEventListener(
      "click",
      safeAsync(async () => {
        spell.notesCollapsed = !spell.notesCollapsed;
        if (!spell.notesCollapsed) {
          await ensureSpellNotesLoaded(spell.id);
          if (destroyed) return;
        }
        collapseBtn.setAttribute("aria-expanded", spell.notesCollapsed ? "false" : "true");
        SaveManager.markDirty();
        render();
      }, (err) => {
        console.error(err);
        notifyStatus(setStatus, "Toggle spell notes failed.");
      })
    );

    const name = document.createElement("input");
    name.className = "spellName";
    name.placeholder = "Spell name";
    name.value = spell.name || "";
    name.addEventListener("input", () => {
      spell.name = name.value;
      SaveManager.markDirty();
    });

    const toggles = document.createElement("div");
    toggles.className = "spellToggles";

    const mkToggle = (label, key, extraClass = "") => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `spellToggle ${extraClass}`.trim();
      button.textContent = label;

      const refresh = () => {
        const isOn = !!spell[key];
        button.classList.toggle("on", isOn);
        button.setAttribute("aria-pressed", isOn ? "true" : "false");
      };

      refresh();

      button.addEventListener("click", () => {
        spell[key] = !spell[key];
        refresh();
        SaveManager.markDirty();
      });

      return button;
    };

    toggles.appendChild(mkToggle("Known", "known"));
    toggles.appendChild(mkToggle("Prepared", "prepared"));
    toggles.appendChild(mkToggle("Cast", "expended", "warn"));

    const mini = document.createElement("div");
    mini.className = "spellMiniBtns";

    const up = document.createElement("button");
    up.type = "button";
    up.className = "moveBtn";
    up.title = "Move up";
    up.textContent = "↑";
    up.disabled = spellIndex === 0;
    up.addEventListener("click", () => {
      if (spellIndex === 0) return;
      const spells = level.spells;
      spells.splice(spellIndex - 1, 0, spells.splice(spellIndex, 1)[0]);
      SaveManager.markDirty();
      render();
    });

    const down = document.createElement("button");
    down.type = "button";
    down.className = "moveBtn";
    down.title = "Move down";
    down.textContent = "↓";
    down.disabled = spellIndex === level.spells.length - 1;
    down.addEventListener("click", () => {
      if (spellIndex >= level.spells.length - 1) return;
      const spells = level.spells;
      spells.splice(spellIndex + 1, 0, spells.splice(spellIndex, 1)[0]);
      SaveManager.markDirty();
      render();
    });

    const del = document.createElement("button");
    del.type = "button";
    del.className = "danger";
    del.textContent = "X";
    del.addEventListener(
      "click",
      safeAsync(async () => {
        if (!(await uiConfirm?.(`Delete spell "${spell.name || "this spell"}"?`, {
          title: "Delete Spell",
          okText: "Delete"
        }))) {
          return;
        }
        if (destroyed) return;

        level.spells.splice(spellIndex, 1);
        spellNotesCache.delete(spell.id);
        const timerId = spellNotesSaveTimers.get(spell.id);
        if (timerId) {
          clearTimeout(timerId);
          spellNotesSaveTimers.delete(spell.id);
        }
        if (typeof deleteText === "function" && typeof textKey_spellNotes === "function") {
          await deleteText(textKey_spellNotes(spell.id));
        }
        if (destroyed) return;
        SaveManager.markDirty();
        render();
      }, (err) => {
        console.error(err);
        notifyStatus(setStatus, "Delete spell failed.");
      })
    );

    mini.appendChild(up);
    mini.appendChild(down);
    mini.appendChild(del);

    top.appendChild(collapseBtn);
    top.appendChild(name);
    top.appendChild(toggles);
    top.appendChild(mini);
    row.appendChild(top);

    if (!spell.notesCollapsed) {
      const notesWrap = document.createElement("div");
      notesWrap.className = "spellNotes";
      const ta = document.createElement("textarea");
      ta.id = `spellNotes_${spell.id}`;
      ta.setAttribute("data-persist-size", "");
      ta.placeholder = "Spell notes / description...";
      ta.value = spellNotesCache.get(spell.id) ?? "";
      ta.addEventListener("input", () => {
        scheduleSpellNotesSave(spell.id, ta.value);
      });

      if (!spellNotesCache.has(spell.id)) {
        ta.placeholder = "Loading...";
        ensureSpellNotesLoaded(spell.id).then(() => {
          if (destroyed || !ta.isConnected) return;
          ta.placeholder = "Spell notes / description...";
          ta.value = spellNotesCache.get(spell.id) ?? "";
          requestAnimationFrame(() => applyTextareaSize?.(ta));
        }).catch((err) => {
          console.warn("Failed to load spell notes:", err);
          if (destroyed || !ta.isConnected) return;
          ta.placeholder = "Spell notes / description...";
        });
      }

      notesWrap.appendChild(ta);
      row.appendChild(notesWrap);
    }

    return row;
  }

  function render() {
    if (destroyed) return;

    containerEl.replaceChildren();
    const levels = state.character.spells.levels;

    if (!levels.length) {
      const empty = document.createElement("div");
      empty.className = "mutedSmall";
      empty.textContent = "No spell levels yet. Click + Level.";
      containerEl.appendChild(empty);
      return;
    }

    levels.forEach((level, i) => containerEl.appendChild(renderLevel(level, i)));
    enhanceNumberSteppers?.(containerEl);
  }

  function setupSpellsV2() {
    ensureSpellsV2Shape();
    if (!state.character.spells.levels.length) {
      state.character.spells.levels = [
        newSpellLevel("Cantrips", false),
        newSpellLevel("1st Level", true),
        newSpellLevel("2nd Level", true),
        newSpellLevel("3rd Level", true)
      ];
    }

    addListener(
      addLevelBtnEl,
      "click",
      safeAsync(async () => {
        const suggested = (() => {
          const levels = (state.character?.spells?.levels || []).map((level) => String(level.label || ""));
          let max = 0;
          for (const label of levels) {
            const match = label.match(/\b(\d+)\s*(st|nd|rd|th)?\s*level\b/i);
            if (!match) continue;
            const num = Number(match[1]);
            if (Number.isFinite(num) && num > max) max = num;
          }
          const next = Math.max(1, max + 1);
          const ordinal = (n) => {
            const suffixes = ["th", "st", "nd", "rd"];
            const value = n % 100;
            return n + (suffixes[(value - 20) % 10] || suffixes[value] || suffixes[0]);
          };
          return `${ordinal(next)} Level`;
        })();

        const label = ((await uiPrompt?.("New spell level name:", {
          defaultValue: suggested,
          title: "New Spell Level"
        })) || "").trim();

        if (destroyed || !label) return;

        const isCantrip = label.toLowerCase().includes("cantrip");
        state.character.spells.levels.push(newSpellLevel(label, !isCantrip));
        SaveManager.markDirty();
        render();
      }, (err) => {
        console.error(err);
        notifyStatus(setStatus, "Add spell level failed.");
      })
    );

    render();
  }

  setupSpellsV2();

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      flushPendingSpellNotes();
      for (let i = destroyFns.length - 1; i >= 0; i--) {
        destroyFns[i]?.();
      }
      containerEl.replaceChildren();
    }
  };
}
