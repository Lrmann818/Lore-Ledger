// @ts-check
// js/ui/popovers.js
// Centralized popover / dropdown manager.
//
// Handles:
//  - click-outside close (optional per popover)
//  - Escape close (optional per popover)
//  - resize reposition for open popovers

/** @type {(() => void) | null} */
let activePopoverManagerDestroy = null;

/**
 * @typedef {Object} PopoverRegistration
 * @property {HTMLElement} button
 * @property {HTMLElement} menu
 * @property {boolean} preferRight
 * @property {boolean} closeOnOutside
 * @property {boolean} closeOnEsc
 * @property {boolean} stopInsideClick
 * @property {(() => void) | null} onOpen
 * @property {(() => void) | null} onClose
 */

/**
 * @typedef {{ preferRight?: boolean }} PositionMenuOptions
 */

/**
 * @typedef {(menu: HTMLElement, anchor: HTMLElement, opts?: PositionMenuOptions) => void} PositionMenuFn
 */

/**
 * @typedef {{
 *  button: HTMLElement,
 *  menu: HTMLElement,
 *  preferRight?: boolean,
 *  closeOnOutside?: boolean,
 *  closeOnEsc?: boolean,
 *  stopInsideClick?: boolean,
 *  onOpen?: () => void,
 *  onClose?: () => void,
 *  wireButton?: boolean
 * }} PopoverRegisterArgs
 */
/**
 * @typedef {{
 *  button?: HTMLElement | null,
 *  menu?: HTMLElement | null,
 *  preferRight?: boolean,
 *  closeOnOutside?: boolean,
 *  closeOnEsc?: boolean,
 *  stopInsideClick?: boolean,
 *  onOpen?: (() => void) | null,
 *  onClose?: (() => void) | null
 * }} PopoverTrackDynamicArgs
 */
/**
 * @typedef {{
 *   reg: PopoverRegistration,
 *   open: () => void,
 *   close: () => void,
 *   toggle: () => void,
 *   reposition: () => void,
 *   destroy: () => void
 * }} PopoverHandle
 */
/**
 * @typedef {{
 *   register: (args: PopoverRegisterArgs) => PopoverHandle | null,
 *   trackDynamic: (args?: PopoverTrackDynamicArgs) => PopoverRegistration | null,
 *   open: (reg: PopoverRegistration, opts?: { exclusive?: boolean }) => void,
 *   close: (reg: PopoverRegistration, opts?: { focusButton?: boolean }) => void,
 *   toggle: (reg: PopoverRegistration, opts?: { exclusive?: boolean }) => void,
 *   reposition: (reg: PopoverRegistration) => void,
 *   closeAll: () => void,
 *   closeAllExcept: (keep: PopoverRegistration) => void,
 *   isOpen: (reg: PopoverRegistration) => boolean,
 *   destroy: () => void
 * }} PopoversApi
 */

/**
 * @param {{ positionFn?: PositionMenuFn }} [cfg]
 * @returns {PopoversApi}
 */
export function createPopoverManager(cfg) {
  if (typeof activePopoverManagerDestroy === "function") {
    activePopoverManagerDestroy();
  }

  const positionFn = cfg?.positionFn;
  const ac = new AbortController();
  const { signal } = ac;
  /** @type {Set<PopoverRegistration>} */
  const registrations = new Set();
  /** @type {WeakMap<HTMLElement, PopoverRegistration>} */
  const menuToReg = new WeakMap();
  let installed = false;
  let destroyed = false;
  let raf = 0;
  // When a popover is opened, we record the anchor's viewport position.
  // If the user scrolls enough that the anchor moves (relative to viewport),
  // we close the popover to mimic native <select> behavior.
  /** @type {Map<PopoverRegistration, { top: number, left: number }>} */
  const openAnchorPos = new Map();
  const SCROLL_CLOSE_PX = 10;

  const isOpen = (reg) => reg && reg.menu && !reg.menu.hidden;

  const reposition = (reg) => {
    if (!reg || !isOpen(reg)) return;
    if (typeof positionFn !== "function") return;
    positionFn(reg.menu, reg.button, { preferRight: !!reg.preferRight });
  };

  const close = (reg, { focusButton = false } = {}) => {
    if (!reg || !reg.menu || !reg.button) return;
    if (reg.menu.hidden) return;
    reg.menu.hidden = true;
    reg.button.setAttribute("aria-expanded", "false");
    openAnchorPos.delete(reg);
    try { reg.onClose?.(); } catch (e) { console.warn("popover onClose failed", e); }
    if (focusButton) {
      try { reg.button.focus?.({ preventScroll: true }); } catch { reg.button.focus?.(); }
    }
  };

  const closeAll = () => {
    registrations.forEach((reg) => {
      if (isOpen(reg)) close(reg);
    });
  };

  const closeAllExcept = (keep) => {
    registrations.forEach((reg) => {
      if (reg !== keep && isOpen(reg)) close(reg);
    });
  };

  const unregister = (reg) => {
    if (!reg) return;
    close(reg);
    registrations.delete(reg);
    openAnchorPos.delete(reg);
    if (reg.menu) menuToReg.delete(reg.menu);
  };

  const open = (reg, { exclusive = true } = {}) => {
    if (!reg || !reg.menu || !reg.button) return;
    if (exclusive) closeAllExcept(reg);
    reg.menu.hidden = false;
    reg.button.setAttribute("aria-expanded", "true");
    // Record the anchor's position at open; used to decide when to auto-close
    // on scroll (native select behavior).
    try {
      const r = reg.button.getBoundingClientRect();
      openAnchorPos.set(reg, { top: r.top, left: r.left });
    } catch {
      // ignore
    }
    reposition(reg);
    try { reg.onOpen?.(); } catch (e) { console.warn("popover onOpen failed", e); }
  };

  const toggle = (reg, { exclusive = true } = {}) => {
    if (!reg) return;
    if (isOpen(reg)) close(reg, { focusButton: false });
    else open(reg, { exclusive });
  };

  const requestRepositionAll = () => {
    if (raf || destroyed) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      if (destroyed) return;
      registrations.forEach((reg) => {
        if (!isOpen(reg)) return;

        // Close on scroll once the anchor has moved a bit.
        const start = openAnchorPos.get(reg);
        if (start) {
          try {
            const now = reg.button.getBoundingClientRect();
            const dx = Math.abs(now.left - start.left);
            const dy = Math.abs(now.top - start.top);
            if (dx > SCROLL_CLOSE_PX || dy > SCROLL_CLOSE_PX) {
              close(reg);
              return;
            }
          } catch {
            // If we can't read the rect for any reason, fall back to keeping it positioned.
          }
        }

        reposition(reg);
      });
    });
  };

  const ensureInstalled = () => {
    if (installed || destroyed) return;
    installed = true;

    // --- Keep open popovers anchored while *any* scrollable container scrolls ---
    // Many areas (NPC/Party/Locations lists, panels) are `overflow: auto`.
    // Our menus are positioned with `position: fixed` (see positioning.js).
    // Without listening for scroll events, the menu can appear to "stay" in
    // the old spot while its button moves.
    // Capture phase catches scrolls from nested containers.
    window.addEventListener(
      "scroll",
      () => requestRepositionAll(),
      { capture: true, signal }
    );

    // click-outside close
    document.addEventListener(
      "click",
      (e) => {
        registrations.forEach((reg) => {
          if (!reg.closeOnOutside) return;
          if (!isOpen(reg)) return;
          const t = e.target;
          if (!(t instanceof Node)) return;
          if (reg.button.contains(t)) return;
          if (reg.menu.contains(t)) return;
          close(reg);
        });
      },
      { signal }
    );

    // Escape close (topmost = last registered open)
    document.addEventListener(
      "keydown",
      (e) => {
        if (e.key !== "Escape") return;
        // Close the most recently opened eligible popover
        // (best-effort: iterate registrations in insertion order)
        const openRegs = Array.from(registrations).filter(r => r.closeOnEsc && isOpen(r));
        const last = openRegs[openRegs.length - 1];
        if (last) {
          e.preventDefault();
          close(last, { focusButton: true });
        }
      },
      { signal }
    );

    // resize reposition
    window.addEventListener(
      "resize",
      () => {
        registrations.forEach((reg) => reposition(reg));
      },
      { signal }
    );
  };

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    closeAll();
    registrations.clear();
    openAnchorPos.clear();
    ac.abort();
    installed = false;
    if (activePopoverManagerDestroy === destroy) {
      activePopoverManagerDestroy = null;
    }
  };
  activePopoverManagerDestroy = destroy;

  /**
   * Register a popover.
   * @param {PopoverRegisterArgs} args
   * @returns {PopoverHandle | null}
   */
  const register = (args) => {
    if (destroyed) return null;
    if (!args?.button || !args?.menu) return null;

    const reg = /** @type {PopoverRegistration} */ ({
      button: args.button,
      menu: args.menu,
      preferRight: !!args.preferRight,
      closeOnOutside: args.closeOnOutside !== false,
      closeOnEsc: args.closeOnEsc !== false,
      stopInsideClick: args.stopInsideClick !== false,
      onOpen: args.onOpen || null,
      onClose: args.onClose || null,
    });

    registrations.add(reg);
    menuToReg.set(reg.menu, reg);
    ensureInstalled();

    // menu click: keep open
    if (reg.stopInsideClick) {
      reg.menu.addEventListener("click", (e) => e.stopPropagation(), { signal });
    }

    // optional: wire the button click to toggle
    if (args.wireButton !== false) {
      reg.button.addEventListener(
        "click",
        (e) => {
          e.preventDefault();
          e.stopPropagation();
          toggle(reg, { exclusive: true });
        },
        { signal }
      );
    }

    return {
      reg,
      open: () => open(reg, { exclusive: true }),
      close: () => close(reg, { focusButton: false }),
      toggle: () => toggle(reg, { exclusive: true }),
      reposition: () => reposition(reg),
      destroy: () => unregister(reg),
    };
  };

  /**
   * For dynamically-created menus where you don't want to auto-wire the button.
   * This returns a stable registration (stored in a WeakMap) per menu element.
   * @param {PopoverTrackDynamicArgs} [args]
   * @returns {PopoverRegistration | null}
   */
  const trackDynamic = (args = {}) => {
    if (destroyed) return null;
    const {
      button,
      menu,
      preferRight = false,
      closeOnOutside = true,
      closeOnEsc = true,
      stopInsideClick = true,
      onOpen,
      onClose
    } = args;
    if (!button || !menu) return null;
    let reg = menuToReg.get(menu);
    if (!reg) {
      reg = /** @type {PopoverRegistration} */ ({
        button,
        menu,
        preferRight: !!preferRight,
        closeOnOutside: !!closeOnOutside,
        closeOnEsc: !!closeOnEsc,
        stopInsideClick: !!stopInsideClick,
        onOpen: onOpen || null,
        onClose: onClose || null,
      });
      registrations.add(reg);
      menuToReg.set(menu, reg);
      ensureInstalled();
      if (stopInsideClick) menu.addEventListener("click", (e) => e.stopPropagation(), { signal });
    }
    // keep latest button reference (in case the same menu is reused)
    reg.button = button;
    reg.preferRight = !!preferRight;
    reg.closeOnOutside = !!closeOnOutside;
    reg.closeOnEsc = !!closeOnEsc;
    reg.stopInsideClick = !!stopInsideClick;
    reg.onOpen = onOpen || reg.onOpen;
    reg.onClose = onClose || reg.onClose;
    return reg;
  };

  return {
    register,
    trackDynamic,
    open,
    close,
    toggle,
    reposition,
    closeAll,
    closeAllExcept,
    isOpen,
    destroy
  };
}
