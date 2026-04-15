import { safeAsync } from "../../../ui/safeAsync.js";
import { notifyPanelDataChanged, subscribePanelDataChanged } from "../../../ui/panelInvalidation.js";
import { requireMany } from "../../../utils/domGuards.js";
import { getActiveCharacter } from "../../../domain/characterHelpers.js";
import { createStateActions } from "../../../domain/stateActions.js";

const SPELL_NOTES_SAVE_DEBOUNCE_MS = 250;

const spellNotesRuntime = {
  cache: new Map(),
  dirtyKeys: new Set(),
  saveTimers: new Map(),
  pendingLoads: new Map(),
  subscribers: new Map()
};

function subscribeSpellNote(textKey, callback) {
  if (!textKey || typeof callback !== "function") return () => {};
  let subscribers = spellNotesRuntime.subscribers.get(textKey);
  if (!subscribers) {
    subscribers = new Set();
    spellNotesRuntime.subscribers.set(textKey, subscribers);
  }
  subscribers.add(callback);
  return () => {
    const active = spellNotesRuntime.subscribers.get(textKey);
    if (!active) return;
    active.delete(callback);
    if (active.size === 0) spellNotesRuntime.subscribers.delete(textKey);
  };
}

function notifySpellNoteSubscribers(textKey, text, source = null) {
  const subscribers = spellNotesRuntime.subscribers.get(textKey);
  if (!subscribers) return;
  for (const callback of Array.from(subscribers)) {
    callback(text, source);
  }
}

function getCachedSpellNote(textKey) {
  return spellNotesRuntime.cache.get(textKey);
}

async function loadSpellNote(textKey, getText) {
  if (!textKey) return "";
  if (spellNotesRuntime.cache.has(textKey)) {
    return spellNotesRuntime.cache.get(textKey) ?? "";
  }
  if (spellNotesRuntime.pendingLoads.has(textKey)) {
    return spellNotesRuntime.pendingLoads.get(textKey);
  }

  const loadPromise = Promise.resolve(
    typeof getText === "function" ? getText(textKey) : ""
  ).then((text) => {
    if (spellNotesRuntime.cache.has(textKey)) {
      return spellNotesRuntime.cache.get(textKey) ?? "";
    }
    const normalized = text || "";
    spellNotesRuntime.cache.set(textKey, normalized);
    notifySpellNoteSubscribers(textKey, normalized);
    return normalized;
  }).finally(() => {
    spellNotesRuntime.pendingLoads.delete(textKey);
  });

  spellNotesRuntime.pendingLoads.set(textKey, loadPromise);
  return loadPromise;
}

function persistSpellNoteNow(textKey, putText) {
  if (typeof putText !== "function" || !textKey) return;
  const textToSave = spellNotesRuntime.cache.get(textKey) ?? "";
  Promise.resolve(putText(textToSave, textKey)).then(() => {
    if (
      spellNotesRuntime.cache.get(textKey) === textToSave
      && !spellNotesRuntime.saveTimers.has(textKey)
    ) {
      spellNotesRuntime.dirtyKeys.delete(textKey);
    }
  }).catch((err) => {
    console.warn("Failed to save spell notes:", err);
  });
}

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
    root = document,
    selectors = {},
    noteTextareaIdPrefix = "spellNotes_",

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
  if (!getActiveCharacter(state)) return null;
  const { mutateCharacter } = createStateActions({ state, SaveManager });

  const required = {
    panelEl: "#charSpellsPanel",
    containerEl: "#spellLevels",
    addLevelBtnEl: "#addSpellLevelBtn",
    ...selectors
  };
  const guard = requireMany(required, { root, setStatus, context: "Spells panel" });
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
  const panelInstance = {};
  const spellNotesCampaignId = (() => {
    const normalized = typeof state?.appShell?.activeCampaignId === "string"
      ? state.appShell.activeCampaignId.trim()
      : "";
    return normalized || null;
  })();

  /** @type {Array<() => void>} */
  let spellNotesRenderUnsubscribers = [];

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

  function getCurrentCharacter() {
    return getActiveCharacter(state);
  }

  function ensureSpellsV2Shape() {
    return mutateCharacter((character) => {
      if (!character.spells || typeof character.spells !== "object") {
        character.spells = { levels: [] };
      }
      if (!Array.isArray(character.spells.levels)) character.spells.levels = [];
      character.spells.levels.forEach((level) => {
        if (!level || typeof level !== "object") return;
        if (typeof level.id !== "string" || !level.id) level.id = newTextId("spellLevel");
        if (!Array.isArray(level.spells)) level.spells = [];
        level.spells.forEach((spell) => {
          if (!spell || typeof spell !== "object") return;
          if (typeof spell.id !== "string" || !spell.id) spell.id = newTextId("spell");
        });
      });
      return true;
    }, { queueSave: false });
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

  function getSpellNotesKey(spellId) {
    if (typeof textKey_spellNotes !== "function") return null;
    const normalizedSpellId = String(spellId || "").trim();
    if (!spellNotesCampaignId || !normalizedSpellId) return null;
    return textKey_spellNotes(spellNotesCampaignId, normalizedSpellId);
  }

  function flushPendingSpellNotes() {
    if (typeof putText !== "function") return;

    for (const [textKey, timerId] of spellNotesRuntime.saveTimers) {
      clearTimeout(timerId);
      spellNotesRuntime.saveTimers.delete(textKey);
    }

    for (const textKey of Array.from(spellNotesRuntime.dirtyKeys)) {
      persistSpellNoteNow(textKey, putText);
    }
  }

  function scheduleSpellNotesSave(spellId, text, source = null) {
    const textKey = getSpellNotesKey(spellId);
    if (!textKey) return;
    spellNotesRuntime.cache.set(textKey, text);
    spellNotesRuntime.dirtyKeys.add(textKey);
    notifySpellNoteSubscribers(textKey, text, source);

    const previous = spellNotesRuntime.saveTimers.get(textKey);
    if (previous) clearTimeout(previous);

    const timerId = setTimeout(() => {
      spellNotesRuntime.saveTimers.delete(textKey);
      if (destroyed) return;
      persistSpellNoteNow(textKey, putText);
    }, SPELL_NOTES_SAVE_DEBOUNCE_MS);

    spellNotesRuntime.saveTimers.set(textKey, timerId);
  }

  async function ensureSpellNotesLoaded(spellId) {
    const textKey = getSpellNotesKey(spellId);
    if (!textKey) return "";
    return loadSpellNote(textKey, getText);
  }

  function forgetSpellNotes(spellId) {
    const textKey = getSpellNotesKey(spellId);
    if (!textKey) return;
    spellNotesRuntime.cache.delete(textKey);
    spellNotesRuntime.dirtyKeys.delete(textKey);
    const timerId = spellNotesRuntime.saveTimers.get(textKey);
    if (timerId) {
      clearTimeout(timerId);
      spellNotesRuntime.saveTimers.delete(textKey);
    }
  }

  function markSpellsChanged({ renderSource = false } = {}) {
    SaveManager.markDirty();
    if (renderSource) render();
    notifyPanelDataChanged("spells", { source: panelInstance });
  }

  function findLevel(character, levelId, levelIndex = -1) {
    const levels = character?.spells?.levels;
    if (!Array.isArray(levels)) return null;
    if (levelId) {
      const byId = levels.find((level) => level?.id === levelId);
      if (byId) return byId;
      return null;
    }
    return levelIndex >= 0 ? levels[levelIndex] || null : null;
  }

  function mutateSpellLevel(levelId, levelIndex, mutator) {
    return mutateCharacter((character) => {
      const level = findLevel(character, levelId, levelIndex);
      if (!level) return false;
      return mutator(level, character) !== false;
    }, { queueSave: false });
  }

  function mutateSpellEntry(levelId, levelIndex, spellId, spellIndex, mutator) {
    return mutateCharacter((character) => {
      const level = findLevel(character, levelId, levelIndex);
      if (!level || !Array.isArray(level.spells)) return false;
      const spell = spellId
        ? level.spells.find((item) => item?.id === spellId)
        : level.spells[spellIndex];
      if (!spell) return false;
      return mutator(spell, level, character) !== false;
    }, { queueSave: false });
  }

  function renderLevel(level, levelIndex) {
    const levelId = typeof level.id === "string" ? level.id : "";
    const spells = Array.isArray(level.spells) ? level.spells : [];

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
      const updated = mutateSpellLevel(levelId, levelIndex, (currentLevel) => {
        currentLevel.collapsed = !currentLevel.collapsed;
      });
      if (!updated) return;
      markSpellsChanged({ renderSource: true });
    });

    const titleWrap = document.createElement("div");
    titleWrap.className = "spellLevelTitle";
    const titleInput = document.createElement("input");
    titleInput.value = level.label || "";
    titleInput.placeholder = "Level name";
    titleInput.addEventListener("input", () => {
      const updated = mutateSpellLevel(levelId, levelIndex, (currentLevel) => {
        currentLevel.label = titleInput.value;
      });
      if (!updated) return;
      markSpellsChanged();
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
        const updated = mutateSpellLevel(levelId, levelIndex, (currentLevel) => {
          currentLevel.used = used.value === "" ? null : Number(used.value);
        });
        if (!updated) return;
        markSpellsChanged();
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
        const updated = mutateSpellLevel(levelId, levelIndex, (currentLevel) => {
          currentLevel.total = total.value === "" ? null : Number(total.value);
        });
        if (!updated) return;
        markSpellsChanged();
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
      const updated = mutateSpellLevel(levelId, levelIndex, (currentLevel) => {
        if (!Array.isArray(currentLevel.spells)) currentLevel.spells = [];
        currentLevel.spells.push(newSpell(""));
      });
      if (!updated) return;
      markSpellsChanged({ renderSource: true });
    });

    const resetExpBtn = document.createElement("button");
    resetExpBtn.type = "button";
    resetExpBtn.textContent = "Reset Cast";
    resetExpBtn.title = "Clear expended/cast flags for this level";
    resetExpBtn.addEventListener("click", () => {
      const updated = mutateSpellLevel(levelId, levelIndex, (currentLevel) => {
        const currentSpells = Array.isArray(currentLevel.spells) ? currentLevel.spells : [];
        currentSpells.forEach((spell) => spell.expended = false);
      });
      if (!updated) return;
      markSpellsChanged({ renderSource: true });
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

        const currentLevel = findLevel(getCurrentCharacter(), levelId, levelIndex);
        const currentSpells = Array.isArray(currentLevel?.spells) ? currentLevel.spells : [];
        for (const spell of currentSpells) {
          forgetSpellNotes(spell.id);
          if (typeof deleteText === "function" && typeof textKey_spellNotes === "function") {
            const textKey = getSpellNotesKey(spell.id);
            if (textKey) await deleteText(textKey);
          }
        }

        const removed = mutateCharacter((character) => {
          const levels = character.spells?.levels;
          if (!Array.isArray(levels)) return false;
          const removeIndex = levelId
            ? levels.findIndex((item) => item?.id === levelId)
            : levelIndex;
          if (removeIndex < 0 || removeIndex >= levels.length) return false;
          levels.splice(removeIndex, 1);
          return true;
        }, { queueSave: false });
        if (!removed) return;
        markSpellsChanged({ renderSource: true });
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

      if (!spells.length) {
        const empty = document.createElement("div");
        empty.className = "mutedSmall";
        empty.textContent = "No spells yet. Click + Spell.";
        body.appendChild(empty);
      } else {
        spells.forEach((spell, spellIndex) => body.appendChild(renderSpell(level, spell, levelIndex, spellIndex)));
      }

      card.appendChild(body);
    }

    return card;
  }

  function renderSpell(level, spell, levelIndex, spellIndex) {
    const levelId = typeof level.id === "string" ? level.id : "";
    const spellId = typeof spell.id === "string" ? spell.id : "";
    const levelSpells = Array.isArray(level.spells) ? level.spells : [];
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
        const updated = mutateSpellEntry(levelId, levelIndex, spellId, spellIndex, (currentSpell) => {
          currentSpell.notesCollapsed = !currentSpell.notesCollapsed;
        });
        if (!updated) return;
        const currentSpell = findLevel(getCurrentCharacter(), levelId, levelIndex)?.spells?.find((item) => item?.id === spellId);
        if (currentSpell && !currentSpell.notesCollapsed) {
          await ensureSpellNotesLoaded(spell.id);
          if (destroyed) return;
        }
        markSpellsChanged({ renderSource: true });
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
      const updated = mutateSpellEntry(levelId, levelIndex, spellId, spellIndex, (currentSpell) => {
        currentSpell.name = name.value;
      });
      if (!updated) return;
      markSpellsChanged();
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
        let nextValue = !!spell[key];
        const updated = mutateSpellEntry(levelId, levelIndex, spellId, spellIndex, (currentSpell) => {
          currentSpell[key] = !currentSpell[key];
          nextValue = !!currentSpell[key];
        });
        if (!updated) return;
        spell = { ...spell, [key]: nextValue };
        refresh();
        markSpellsChanged();
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
      const updated = mutateSpellLevel(levelId, levelIndex, (currentLevel) => {
        const currentSpells = Array.isArray(currentLevel.spells) ? currentLevel.spells : [];
        const from = spellId
          ? currentSpells.findIndex((item) => item?.id === spellId)
          : spellIndex;
        if (from <= 0 || from >= currentSpells.length) return false;
        currentSpells.splice(from - 1, 0, currentSpells.splice(from, 1)[0]);
      });
      if (!updated) return;
      markSpellsChanged({ renderSource: true });
    });

    const down = document.createElement("button");
    down.type = "button";
    down.className = "moveBtn";
    down.title = "Move down";
    down.textContent = "↓";
    down.disabled = spellIndex === levelSpells.length - 1;
    down.addEventListener("click", () => {
      if (spellIndex >= levelSpells.length - 1) return;
      const updated = mutateSpellLevel(levelId, levelIndex, (currentLevel) => {
        const currentSpells = Array.isArray(currentLevel.spells) ? currentLevel.spells : [];
        const from = spellId
          ? currentSpells.findIndex((item) => item?.id === spellId)
          : spellIndex;
        if (from < 0 || from >= currentSpells.length - 1) return false;
        currentSpells.splice(from + 1, 0, currentSpells.splice(from, 1)[0]);
      });
      if (!updated) return;
      markSpellsChanged({ renderSource: true });
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

        const removed = mutateSpellLevel(levelId, levelIndex, (currentLevel) => {
          const currentSpells = Array.isArray(currentLevel.spells) ? currentLevel.spells : [];
          const removeIndex = spellId
            ? currentSpells.findIndex((item) => item?.id === spellId)
            : spellIndex;
          if (removeIndex < 0 || removeIndex >= currentSpells.length) return false;
          currentSpells.splice(removeIndex, 1);
        });
        if (!removed) return;
        forgetSpellNotes(spell.id);
        if (typeof deleteText === "function" && typeof textKey_spellNotes === "function") {
          const textKey = getSpellNotesKey(spell.id);
          if (textKey) await deleteText(textKey);
        }
        if (destroyed) return;
        markSpellsChanged({ renderSource: true });
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
      const textKey = getSpellNotesKey(spell.id);
      ta.id = `${noteTextareaIdPrefix}${spell.id}`;
      ta.setAttribute("data-persist-size", "");
      ta.placeholder = "Spell notes / description...";
      ta.value = textKey ? (getCachedSpellNote(textKey) ?? "") : "";
      ta.addEventListener("input", () => {
        scheduleSpellNotesSave(spell.id, ta.value, ta);
      });

      if (textKey) {
        let unsubscribe = () => {};
        unsubscribe = subscribeSpellNote(textKey, (text, source) => {
          if (source === ta) return;
          if (!ta.isConnected) {
            unsubscribe();
            return;
          }
          if (ta.value !== text) {
            ta.value = text;
            requestAnimationFrame(() => applyTextareaSize?.(ta));
          }
        });
        spellNotesRenderUnsubscribers.push(unsubscribe);
      }

      if (textKey && !spellNotesRuntime.cache.has(textKey)) {
        ta.placeholder = "Loading...";
        ensureSpellNotesLoaded(spell.id).then((text) => {
          if (destroyed || !ta.isConnected) return;
          ta.placeholder = "Spell notes / description...";
          if (ta.value !== text) ta.value = text ?? "";
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

    spellNotesRenderUnsubscribers.forEach((unsubscribe) => unsubscribe());
    spellNotesRenderUnsubscribers = [];
    containerEl.replaceChildren();
    ensureSpellsV2Shape();
    const currentCharacter = getCurrentCharacter();
    const levels = Array.isArray(currentCharacter?.spells?.levels) ? currentCharacter.spells.levels : [];

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
    mutateCharacter((character) => {
      const levels = character.spells?.levels;
      if (!Array.isArray(levels) || levels.length) return false;
      character.spells.levels = [
        newSpellLevel("Cantrips", false),
        newSpellLevel("1st Level", true),
        newSpellLevel("2nd Level", true),
        newSpellLevel("3rd Level", true)
      ];
      return true;
    }, { queueSave: false });

    addListener(
      addLevelBtnEl,
      "click",
      safeAsync(async () => {
        const suggested = (() => {
          const levels = (getCurrentCharacter()?.spells?.levels || []).map((level) => String(level.label || ""));
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
        const updated = mutateCharacter((character) => {
          if (!character.spells || typeof character.spells !== "object") character.spells = { levels: [] };
          if (!Array.isArray(character.spells.levels)) character.spells.levels = [];
          character.spells.levels.push(newSpellLevel(label, !isCantrip));
          return true;
        }, { queueSave: false });
        if (!updated) return;
        markSpellsChanged({ renderSource: true });
      }, (err) => {
        console.error(err);
        notifyStatus(setStatus, "Add spell level failed.");
      })
    );

    render();
  }

  setupSpellsV2();

  addDestroy(subscribePanelDataChanged("spells", (detail) => {
    if (destroyed || detail.source === panelInstance) return;
    render();
  }));

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      flushPendingSpellNotes();
      spellNotesRenderUnsubscribers.forEach((unsubscribe) => unsubscribe());
      spellNotesRenderUnsubscribers = [];
      for (let i = destroyFns.length - 1; i >= 0; i--) {
        destroyFns[i]?.();
      }
      containerEl.replaceChildren();
    }
  };
}
