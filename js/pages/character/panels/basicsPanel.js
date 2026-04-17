// js/pages/character/panels/basicsPanel.js
// Character page Basics panel (identity fields + portrait)

import { safeAsync } from "../../../ui/safeAsync.js";
import { createStateActions } from "../../../domain/stateActions.js";
import { requireMany } from "../../../utils/domGuards.js";
import { replaceStoredBlob } from "../../../storage/blobReplacement.js";
import { getActiveCharacter, isBuilderCharacter } from "../../../domain/characterHelpers.js";
import { deriveCharacter } from "../../../domain/rules/deriveCharacter.js";
import { notifyPanelDataChanged, subscribePanelDataChanged } from "../../../ui/panelInvalidation.js";

function formatPossessive(name) {
  const n = (name || "").trim();
  if (!n) return "";
  // If it ends with s/S, prefer: "Silas' Campaign Tracker"
  return /[sS]$/.test(n) ? `${n}'` : `${n}'s`;
}

function updateTabTitle(state) {
  const base = "Campaign Tracker";
  const name = getActiveCharacter(state)?.name || "";
  const poss = formatPossessive(name);
  document.title = poss ? `${poss} ${base}` : base;
}

function setupAutosizeInputs(autoSizeInput, fields = {}) {
  if (!autoSizeInput) return;

  const {
    nameInput,
    classInput,
    raceInput,
    bgInput,
    alignInput,
    xpInput
  } = fields;

  if (nameInput) {
    nameInput.classList.add("autosize");
    autoSizeInput(nameInput, { min: 55, max: 320 });
  }
  if (classInput) {
    classInput.classList.add("autosize");
    autoSizeInput(classInput, { min: 55, max: 320 });
  }
  if (raceInput) {
    raceInput.classList.add("autosize");
    autoSizeInput(raceInput, { min: 55, max: 320 });
  }
  if (bgInput) {
    bgInput.classList.add("autosize");
    autoSizeInput(bgInput, { min: 55, max: 320 });
  }
  if (alignInput) {
    alignInput.classList.add("autosize");
    autoSizeInput(alignInput, { min: 55, max: 320 });
  }
  if (xpInput) {
    xpInput.classList.add("autosize");
    autoSizeInput(xpInput, { min: 30, max: 320 });
  }
}

function setupTitleSync(state, nameInput) {
  // Set initial title based on saved character name (if any)
  updateTabTitle(state);

  if (!nameInput) return;
  if (nameInput.dataset.boundBasicsTitle === "1") return;

  nameInput.dataset.boundBasicsTitle = "1";
  nameInput.addEventListener("input", () => updateTabTitle(state));
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function textFieldValue(value) {
  return value == null ? "" : String(value);
}

function builderClassLevelDisplay(label) {
  const cleaned = cleanString(label);
  return /^\d+$/.test(cleaned) ? "" : cleaned;
}

function getBuilderIdentityDisplay(character) {
  try {
    const derived = deriveCharacter(character);
    return {
      classLevel: builderClassLevelDisplay(derived.labels.classLevel),
      race: cleanString(derived.labels.race),
      background: cleanString(derived.labels.background)
    };
  } catch (err) {
    console.warn("Failed to derive builder identity labels:", err);
    return { classLevel: "", race: "", background: "" };
  }
}

function getBasicsIdentityDisplay(character, key) {
  if (!isBuilderCharacter(character)) return textFieldValue(character?.[key]);
  const display = getBuilderIdentityDisplay(character);
  return display[key] || "";
}

function setBuilderOwnedInputState(input, owned) {
  if (!input) return;
  input.readOnly = owned;
  if (owned) {
    input.setAttribute("readonly", "");
    input.setAttribute("aria-readonly", "true");
    input.dataset.builderOwned = "true";
    input.title = "Controlled by Builder Identity";
    return;
  }
  input.removeAttribute("readonly");
  input.removeAttribute("aria-readonly");
  delete input.dataset.builderOwned;
  if (input.title === "Controlled by Builder Identity") input.title = "";
}

function setupCharacterPortrait(deps, refs = {}) {
  const {
    state,
    SaveManager,
    ImagePicker,
    pickCropStorePortrait,
    deleteBlob,
    putBlob,
    cropImageModal,
    getPortraitAspect,
    blobIdToObjectUrl,
    setStatus,
    uiAlert,
  } = deps;
  const { updateCharacterField } = createStateActions({ state, SaveManager });

  const cardEl = document.getElementById("charPortraitCard");
  const boxEl = refs.portraitTopEl || document.getElementById("charPortraitTop");
  if (!boxEl) return;
  const portraitBindEl = cardEl || boxEl;

  let _portraitPicking = false;

  async function renderPortrait() {
    // wipe the box and rebuild contents like NPC
    boxEl.innerHTML = "";

    const currentCharacter = getActiveCharacter(state);
    if (currentCharacter?.imgBlobId && typeof blobIdToObjectUrl === "function") {
      const img = document.createElement("img");
      img.alt = currentCharacter.name || "Character Portrait";
      boxEl.appendChild(img);

      let url = null;
      try { url = await blobIdToObjectUrl(currentCharacter.imgBlobId); }
      catch (err) {
        console.warn("Failed to load character portrait blob:", err);
      }
      if (url) img.src = url;
      return;
    }

    const placeholder = document.createElement("div");
    placeholder.className = "portraitPlaceholder";
    placeholder.textContent = "Add Image";
    boxEl.appendChild(placeholder);
  }

  // click anywhere in the portrait box
  if (portraitBindEl.dataset.boundBasicsPortrait !== "1") {
    portraitBindEl.dataset.boundBasicsPortrait = "1";
    portraitBindEl.addEventListener(
      "click",
      safeAsync(async () => {
        if (_portraitPicking) return;
        _portraitPicking = true;

        try {
          const portraitBlob = await pickCropStorePortrait({
            picker: ImagePicker,
            cropImageModal,
            getPortraitAspect,
            aspectSelector: "#charPortraitTop",
            setStatus,
          });

          if (typeof portraitBlob === "undefined") return;

          await replaceStoredBlob({
            oldBlobId: getActiveCharacter(state)?.imgBlobId ?? null,
            nextBlob: portraitBlob,
            putBlob,
            deleteBlob,
            SaveManager,
            applyBlobId: (blobId) => updateCharacterField("imgBlobId", blobId || null, { queueSave: false })
          });
          await renderPortrait();
        } catch (err) {
          console.error("Character portrait replacement failed:", err);
          if (typeof setStatus === "function") {
            setStatus("Could not save image. Consider exporting a backup.");
          }
          try {
            await uiAlert?.("Could not save that image (storage may be full).", { title: "Save Failed" });
          } catch (_) {}
        } finally {
          _portraitPicking = false;
        }
      }, (err) => {
        console.error(err);
        if (typeof setStatus === "function") setStatus("Update portrait failed.");
        else console.warn("Update portrait failed.");
      })
    );
  }

  renderPortrait();
}

export function initBasicsPanel(deps = {}) {
  const {
    state,
    SaveManager,
    bindText,
    bindNumber,
    autoSizeInput,
    setStatus,
  } = deps;

  if (!state || !SaveManager || !bindText || !bindNumber) return;
  const required = {
    panel: "#charBasicsPanel",
    nameInput: "#charName",
    classInput: "#charClassLevel",
    raceInput: "#charRace",
    bgInput: "#charBackground",
    alignInput: "#charAlignment",
    xpInput: "#charExperience",
    featuresInput: "#charFeatures",
    portraitTopEl: "#charPortraitTop"
  };
  const guard = requireMany(required, { root: document, setStatus, context: "Character basics panel" });
  if (!guard.ok) return guard.destroy;
  const {
    nameInput,
    classInput,
    raceInput,
    bgInput,
    alignInput,
    xpInput,
    portraitTopEl
  } = guard.els;

  if (!getActiveCharacter(state)) return;
  const { updateCharacterField } = createStateActions({ state, SaveManager });

  const basicsPanelSource = {};
  const notifyCharFields = () => notifyPanelDataChanged("character-fields", { source: basicsPanelSource });
  const destroyFns = [];

  function renderBuilderAwareIdentityFields({ force = false } = {}) {
    const character = getActiveCharacter(state);
    const builderOwned = isBuilderCharacter(character);
    const fields = [
      { input: classInput, key: "classLevel" },
      { input: raceInput, key: "race" },
      { input: bgInput, key: "background" }
    ];

    for (const { input, key } of fields) {
      setBuilderOwnedInputState(input, builderOwned);
      if (!input) continue;
      if (force || builderOwned || document.activeElement !== input) {
        input.value = getBasicsIdentityDisplay(character, key);
      }
    }
  }

  function bindBuilderAwareIdentityInput(input, key, write, options = {}) {
    if (!input) return;
    input.value = getBasicsIdentityDisplay(getActiveCharacter(state), key);

    const onInput = () => {
      const character = getActiveCharacter(state);
      if (isBuilderCharacter(character)) {
        renderBuilderAwareIdentityFields({ force: true });
        return;
      }

      write(input.value);
      if (options.notify) notifyCharFields();
      SaveManager.markDirty?.();
    };

    input.addEventListener("input", onInput);
    destroyFns.push(() => input.removeEventListener("input", onInput));
  }

  // bindText/bindNumber already queue saves via SaveManager; actions only mutate here.
  bindText("charName", () => getActiveCharacter(state)?.name, (v) => { updateCharacterField("name", v, { queueSave: false }); notifyCharFields(); });
  bindBuilderAwareIdentityInput(classInput, "classLevel", (v) => updateCharacterField("classLevel", v, { queueSave: false }), { notify: true });
  bindBuilderAwareIdentityInput(raceInput, "race", (v) => updateCharacterField("race", v, { queueSave: false }));
  bindBuilderAwareIdentityInput(bgInput, "background", (v) => updateCharacterField("background", v, { queueSave: false }));
  bindText("charAlignment", () => getActiveCharacter(state)?.alignment, (v) => updateCharacterField("alignment", v, { queueSave: false }));
  bindNumber("charExperience", () => getActiveCharacter(state)?.experience, (v) => updateCharacterField("experience", v, { queueSave: false }));
  bindText("charFeatures", () => getActiveCharacter(state)?.features, (v) => updateCharacterField("features", v, { queueSave: false }));

  renderBuilderAwareIdentityFields({ force: true });

  setupTitleSync(state, nameInput);
  setupAutosizeInputs(autoSizeInput, {
    nameInput,
    classInput,
    raceInput,
    bgInput,
    alignInput,
    xpInput
  });
  setupCharacterPortrait(deps, { portraitTopEl });

  // Keep character page inputs in sync when a linked tracker card edits the same character field.
  const unsubCharFields = subscribePanelDataChanged("character-fields", (detail) => {
    if (detail.source === basicsPanelSource) return;
    const char = getActiveCharacter(state);
    if (!char) return;
    if (nameInput && document.activeElement !== nameInput) nameInput.value = char.name || "";
    renderBuilderAwareIdentityFields();
    updateTabTitle(state);
  });
  destroyFns.push(unsubCharFields);

  return {
    destroy() {
      for (let i = destroyFns.length - 1; i >= 0; i--) {
        destroyFns[i]?.();
      }
    }
  };
}
