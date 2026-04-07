// js/ui/selectDropdown.js
// Progressive enhancement: turn a native <select> into a Popovers-managed dropdown
// that matches the Map Tools menu styling.

const enhancedStateBySelect = new WeakMap();

/**
 * Enhance a native <select> into a custom dropdown.
 * Keeps the <select> in the DOM (hidden) so existing code that reads/writes
 * `select.value` continues to work.
 *
 * NOTE: The select must have a parentElement before enhancement. If it does not,
 * this function will no-op (returns null). Call it after you've appended the select.
 *
 * @param {{
 *  select: HTMLSelectElement,
 *  Popovers: any,
 *  buttonClass?: string,
 *  optionClass?: string,
 *  groupLabelClass?: string,
 *  preferRight?: boolean,
 *  exclusive?: boolean, // default true. Set false for nested popovers (dropdown inside a popover).
 * }} args
 */
export function enhanceSelectDropdown(args) {
  const select = args?.select;
  const Popovers = args?.Popovers;
  if (!select || !Popovers) return null;

  const existingState = enhancedStateBySelect.get(select);
  if (existingState) return existingState.api;

  // Must be in the DOM (or at least have a parent) so we can insert our wrapper next to it.
  if (!select.parentElement) return null;

  // Prevent double-build
  if (select.dataset.dropdownEnhanced === "1") return null;
  select.dataset.dropdownEnhanced = "1";
  const listenerController = new AbortController();
  const listenerSignal = listenerController.signal;

  const buttonClass = args.buttonClass || "mapToolDropDown";
  // Default option style should match the Map Tools dropdown menu.
  // (Swatches/color grids can pass their own optionClass.)
  const optionClass = args.optionClass || "swatchOption";
  const groupLabelClass = args.groupLabelClass || "dropdownGroupLabel";
  const preferRight = !!args.preferRight;
  const exclusive = args.exclusive !== false; // default true

  // Hide the native select but keep it for state + accessibility fallback.
  select.classList.add("nativeSelectHidden");

  // Build wrapper
  const wrap = document.createElement("div");
  wrap.className = "dropdown selectDropdown";

  // Some selects are intended to span their container (settings rows, card footers,
  // panel headers). Our base .dropdown is inline-block; add a helper class so
  // enhanced selects don't shrink and accidentally change layout.
  const buttonClassRaw = String(args.buttonClass || "");
  const wantsBlock =
    select.classList.contains("settingsSelect") ||
    select.classList.contains("cardSelect") ||
    select.classList.contains("panelSelect") ||
    select.classList.contains("locFilter") ||
    /\b(settingsSelectBtn|cardSelectBtn|panelSelectBtn|settingsDropDownBtn)\b/.test(buttonClassRaw);
  if (wantsBlock) wrap.classList.add("selectDropdownBlock");

  // Some block-style selects (toolbar filters, settings rows) should not expand to fill
  // very wide containers. Apply an optional clamp class ONLY for those cases.
  // Card selects should be allowed to stretch to the full card width.
  const wantsClamp =
    select.classList.contains("settingsSelect") ||
    /\b(settingsSelectBtn|settingsDropDownBtn)\b/.test(buttonClassRaw);
  if (wantsClamp) wrap.classList.add("selectDropdownClamp");

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = buttonClass;
  btn.setAttribute("aria-haspopup", "true");
  btn.setAttribute("aria-expanded", "false");
  btn.title = select.title || "Choose";

  const labelSpan = document.createElement("span");
  labelSpan.dataset.selectLabel = "1";
  btn.appendChild(labelSpan);

  const menu = document.createElement("div");
  menu.className = "dropdownMenu";
  menu.hidden = true;

  // Insert after select (so it keeps the same place in layout).
  select.insertAdjacentElement("afterend", wrap);
  wrap.appendChild(btn);
  wrap.appendChild(menu);

  const getSelectedText = () => {
    const opt = select.selectedOptions?.[0];
    return (opt?.textContent || "").trim() || "Select";
  };

  let api = null;
  let popoverApi = null;
  let destroyed = false;
  const isCardHosted = () => !!btn.closest?.(".trackerCard");
  const closeMenu = () => {
    try { popoverApi?.close?.(); } catch { /* noop */ }
  };

  const moveMenuToBody = () => {
    if (!isCardHosted()) return;
    if (menu.parentElement === document.body) return;
    menu.classList.add("dropdownMenuPortaled");
    document.body.appendChild(menu);
  };

  const restoreMenuParent = () => {
    if (menu.parentElement !== document.body) return;
    menu.classList.remove("dropdownMenuPortaled");
    if (wrap.isConnected) {
      wrap.appendChild(menu);
      return;
    }
    menu.remove();
  };

  const rebuildMenu = () => {
    menu.innerHTML = "";

    const addOptionButton = (opt) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = optionClass;
      b.textContent = (opt.textContent || "").trim();
      b.dataset.value = opt.value;
      if (opt.disabled) b.disabled = true;
      if (opt.value === select.value) b.classList.add("active");

      b.addEventListener("click", () => {
        if (opt.disabled) return;
        select.value = opt.value;
        if (isCardHosted()) {
          try { popoverApi?.close?.(); } catch { /* noop */ }
        }
        // Fire a real change event so existing listeners keep working.
        select.dispatchEvent(new Event("change", { bubbles: true }));
        if (!isCardHosted()) {
          try { popoverApi?.close?.(); } catch { /* noop */ }
        }
      }, { signal: listenerSignal });

      menu.appendChild(b);
    };

    // Build from children so optgroups render correctly.
    Array.from(select.children).forEach((child) => {
      if (child.tagName === "OPTGROUP") {
        const og = /** @type {HTMLOptGroupElement} */ (child);
        const lbl = document.createElement("div");
        lbl.className = groupLabelClass;
        lbl.textContent = (og.label || "").trim();
        menu.appendChild(lbl);
        Array.from(og.children).forEach((opt) => {
          if (opt.tagName === "OPTION") addOptionButton(/** @type {HTMLOptionElement} */ (opt));
        });
      } else if (child.tagName === "OPTION") {
        addOptionButton(/** @type {HTMLOptionElement} */ (child));
      }
    });
  };

  const syncButton = () => {
    labelSpan.textContent = getSelectedText();
    // Update active highlight
    Array.from(menu.querySelectorAll("button")).forEach((b) => {
      b.classList.toggle("active", b.dataset.value === select.value);
    });
    // Mirror disabled state
    btn.disabled = !!select.disabled;
  };

  // If options are populated after init, call this again.
  rebuildMenu();
  syncButton();

  // Keep the custom UI synced if something changes the select value.
  select.addEventListener("change", () => {
    if (!menu.hidden) closeMenu();
    syncButton();
  }, { signal: listenerSignal });

  // Allow callers to sync/rebuild without triggering the real "change" handler.
  select.addEventListener("selectDropdown:sync", () => syncButton(), { signal: listenerSignal });
  select.addEventListener("selectDropdown:rebuild", () => { rebuildMenu(); syncButton(); }, { signal: listenerSignal });

  // Register with centralized popovers manager
  popoverApi = Popovers.register({
    button: btn,
    menu,
    preferRight,
    closeOnOutside: true,
    closeOnEsc: true,
    stopInsideClick: true,
    wireButton: false, // we wire manually so nested dropdowns can be non-exclusive
    onOpen: () => {
      moveMenuToBody();
      popoverApi?.reposition?.();

      // If this dropdown lives inside a card, temporarily raise the whole card
      // above its siblings so the menu can't render "behind" the next card.
      const card = btn.closest?.(".trackerCard");
      if (card) card.classList.add("popoverRaised");

      // In case options changed since last open
      rebuildMenu();
      syncButton();

      // Native-like: focus the active option when opened (or first option).
      const active = /** @type {HTMLButtonElement | null} */ (
        menu.querySelector("button.active:not([disabled])") || menu.querySelector("button:not([disabled])")
      );
      try { active?.focus?.({ preventScroll: true }); } catch { active?.focus?.(); }
    },
    onClose: () => {
      restoreMenuParent();
      cleanupRaised();
    },
  });

  // Remove the raised class when the popover closes.
  // (Popovers.register only gives us onOpen here, so we hook close via an observer.)
  // We'll also clean it up if the select is disabled while open.
  const cleanupRaised = () => {
    const card = btn.closest?.(".trackerCard");
    if (card) card.classList.remove("popoverRaised");
  };

  // When Popovers closes the menu it toggles `hidden`.
  const mo = new MutationObserver(() => {
    if (menu.hidden) cleanupRaised();
  });
  mo.observe(menu, { attributes: true, attributeFilter: ["hidden"] });

  const disconnectObserver = new MutationObserver(() => {
    if (destroyed) return;
    if (select.isConnected && wrap.isConnected) return;
    destroy();
  });
  const disconnectRoot = document.body || document.documentElement;
  disconnectObserver.observe(disconnectRoot, { childList: true, subtree: true });

  // Keyboard: behave more like a native <select>
  // - Enter/Space/ArrowDown opens and focuses the first option
  // - ArrowUp opens and focuses the last option
  // - Escape closes
  // - Arrow keys move focus within the menu
  const focusOptionAt = (idx) => {
    const opts = Array.from(menu.querySelectorAll("button:not([disabled])"));
    if (!opts.length) return;
    const i = Math.max(0, Math.min(idx, opts.length - 1));
    const target = /** @type {HTMLButtonElement} */ (opts[i]);
    try { target.focus({ preventScroll: true }); } catch { target.focus(); }
  };

  const focusSelectedOrFirst = () => {
    const opts = /** @type {HTMLButtonElement[]} */ (Array.from(menu.querySelectorAll("button:not([disabled])")));
    if (!opts.length) return;
    const selectedIdx = opts.findIndex(b => b.dataset.value === select.value);
    focusOptionAt(selectedIdx >= 0 ? selectedIdx : 0);
  };

  btn.addEventListener("keydown", (e) => {
    if (btn.disabled) return;
    const k = e.key;
    if (k === "Enter" || k === " " || k === "ArrowDown") {
      e.preventDefault();
      if (popoverApi?.reg) {
        Popovers.open(popoverApi.reg, { exclusive });
        focusSelectedOrFirst();
      }
    } else if (k === "ArrowUp") {
      e.preventDefault();
      if (popoverApi?.reg) {
        Popovers.open(popoverApi.reg, { exclusive });
        // focus last enabled
        const opts = /** @type {HTMLButtonElement[]} */ (Array.from(menu.querySelectorAll("button:not([disabled])")));
        if (opts.length) {
          const target = opts[opts.length - 1];
          try { target.focus({ preventScroll: true }); } catch { target.focus(); }
        }
      }
    } else if (k === "Escape") {
      if (popoverApi?.close) {
        e.preventDefault();
        popoverApi.close();
      }
    }
  }, { signal: listenerSignal });

  menu.addEventListener("keydown", (e) => {
    const k = e.key;
    const opts = Array.from(menu.querySelectorAll("button:not([disabled])"));
    if (!opts.length) return;
    const active = /** @type {HTMLElement|null} */ (document.activeElement);
    const idx = opts.findIndex(b => b === active);

    if (k === "ArrowDown") {
      e.preventDefault();
      focusOptionAt((idx >= 0 ? idx : -1) + 1);
    } else if (k === "ArrowUp") {
      e.preventDefault();
      focusOptionAt((idx >= 0 ? idx : opts.length) - 1);
    } else if (k === "Home") {
      e.preventDefault();
      focusOptionAt(0);
    } else if (k === "End") {
      e.preventDefault();
      focusOptionAt(opts.length - 1);
    } else if (k === "Escape") {
      e.preventDefault();
      try { popoverApi?.close?.(); } catch { /* noop */ }
      try { btn.focus({ preventScroll: true }); } catch { btn.focus(); }
    }
  }, { signal: listenerSignal });

  // Manual wiring with "exclusive" control
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (popoverApi?.reg && Popovers?.toggle) Popovers.toggle(popoverApi.reg, { exclusive });
  }, { signal: listenerSignal });

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    try { popoverApi?.destroy?.(); } catch { /* noop */ }
    mo.disconnect();
    disconnectObserver.disconnect();
    listenerController.abort();
    cleanupRaised();
    restoreMenuParent();
    wrap.remove();
    select.classList.remove("nativeSelectHidden");
    delete select.dataset.dropdownEnhanced;
    enhancedStateBySelect.delete(select);
  };

  api = {
    ...(popoverApi || {}),
    wrap,
    button: btn,
    menu,
    rebuild: () => { rebuildMenu(); syncButton(); },
    destroy,
  };
  enhancedStateBySelect.set(select, { api });
  return api;
}
