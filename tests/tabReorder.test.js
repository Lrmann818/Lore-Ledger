// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTabReorder } from "../js/ui/tabReorder.js";

function setupDom() {
  document.body.innerHTML = `
    <div id="wrap" class="sessionTabsWrap">
      <div id="tabs" class="sessionTabs">
        <button type="button" class="sessionTab" data-tab-id="tab_a">A</button>
        <button type="button" class="sessionTab" data-tab-id="tab_b">B</button>
        <button type="button" class="sessionTab" data-tab-id="tab_c">C</button>
      </div>
    </div>
  `;

  const wrap = document.getElementById("wrap");
  Object.defineProperty(wrap, "scrollLeft", {
    configurable: true,
    enumerable: true,
    writable: true,
    value: 0,
  });

  const buttons = Array.from(document.querySelectorAll("#tabs .sessionTab"));
  buttons.forEach((button) => {
    button.setPointerCapture = vi.fn();
    button.releasePointerCapture = vi.fn();
    Object.defineProperty(button, "getBoundingClientRect", {
      configurable: true,
      value: () => {
        const siblings = Array.from(button.parentElement?.querySelectorAll(".sessionTab") || []);
        const index = siblings.indexOf(button);
        const translateMatch = button.style.transform.match(/translateX\((-?\d+(?:\.\d+)?)px\)/);
        const translateX = translateMatch ? Number(translateMatch[1]) : 0;
        const left = (index * 110) + translateX;
        return {
          x: left,
          y: 0,
          left,
          top: 0,
          right: left + 100,
          bottom: 32,
          width: 100,
          height: 32,
          toJSON() {
            return this;
          },
        };
      },
    });
  });

  return {
    tabsEl: document.getElementById("tabs"),
    wrapEl: wrap,
    buttons,
  };
}

function dispatchPointer(target, type, props = {}) {
  const defaults = {
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
    clientX: 0,
    clientY: 0,
    timeStamp: 0,
  };
  const event = new Event(type, { bubbles: true, cancelable: true });
  for (const [key, value] of Object.entries({ ...defaults, ...props })) {
    Object.defineProperty(event, key, { configurable: true, value });
  }
  target.dispatchEvent(event);
  return event;
}

describe("createTabReorder", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("keeps mouse drag reorder responsive without a hold delay", () => {
    const { tabsEl, wrapEl, buttons } = setupDom();
    const onCommit = vi.fn();
    const cleanup = createTabReorder({
      tabsEl,
      wrapEl,
      tabSelector: ".sessionTab",
      getTabId: (el) => el.dataset.tabId || "",
      onCommit,
    });

    dispatchPointer(buttons[0], "pointerdown", { clientX: 50, clientY: 16, timeStamp: 0 });
    dispatchPointer(document, "pointermove", { clientX: 190, clientY: 16, timeStamp: 20 });
    dispatchPointer(document, "pointerup", { clientX: 190, clientY: 16, timeStamp: 30 });

    expect(onCommit).toHaveBeenCalledWith(["tab_b", "tab_a", "tab_c"]);
    cleanup.destroy();
  });

  it("lets a quick touch swipe fall through without committing reorder or suppressing clicks", () => {
    const { tabsEl, wrapEl, buttons } = setupDom();
    const onCommit = vi.fn();
    const clickSpy = vi.fn();
    buttons[1].addEventListener("click", clickSpy);
    const cleanup = createTabReorder({
      tabsEl,
      wrapEl,
      tabSelector: ".sessionTab",
      getTabId: (el) => el.dataset.tabId || "",
      onCommit,
    });

    dispatchPointer(buttons[0], "pointerdown", {
      pointerType: "touch",
      clientX: 50,
      clientY: 16,
      timeStamp: 0,
    });
    dispatchPointer(document, "pointermove", {
      pointerType: "touch",
      clientX: 18,
      clientY: 18,
      timeStamp: 60,
    });
    dispatchPointer(document, "pointerup", {
      pointerType: "touch",
      clientX: 18,
      clientY: 18,
      timeStamp: 80,
    });

    expect(onCommit).not.toHaveBeenCalled();
    expect(buttons[0].classList.contains("isDragging")).toBe(false);
    expect(wrapEl.scrollLeft).toBeGreaterThan(0);

    const releaseClick = new Event("click", { bubbles: true, cancelable: true });
    expect(buttons[0].dispatchEvent(releaseClick)).toBe(false);
    expect(clickSpy).not.toHaveBeenCalled();

    const click = new Event("click", { bubbles: true, cancelable: true });
    expect(buttons[1].dispatchEvent(click)).toBe(true);
    expect(clickSpy).toHaveBeenCalledTimes(1);

    cleanup.destroy();
  });

  it("allows deliberate touch reorder after a hold and still suppresses the release click", () => {
    const { tabsEl, wrapEl, buttons } = setupDom();
    const onCommit = vi.fn();
    const clickSpy = vi.fn();
    buttons[0].addEventListener("click", clickSpy);
    const cleanup = createTabReorder({
      tabsEl,
      wrapEl,
      tabSelector: ".sessionTab",
      getTabId: (el) => el.dataset.tabId || "",
      onCommit,
    });

    dispatchPointer(buttons[0], "pointerdown", {
      pointerType: "touch",
      clientX: 50,
      clientY: 16,
      timeStamp: 0,
    });
    dispatchPointer(document, "pointermove", {
      pointerType: "touch",
      clientX: 190,
      clientY: 16,
      timeStamp: 220,
    });
    dispatchPointer(document, "pointerup", {
      pointerType: "touch",
      clientX: 190,
      clientY: 16,
      timeStamp: 240,
    });

    expect(onCommit).toHaveBeenCalledWith(["tab_b", "tab_a", "tab_c"]);

    const releaseClick = new Event("click", { bubbles: true, cancelable: true });
    expect(buttons[0].dispatchEvent(releaseClick)).toBe(false);
    expect(clickSpy).not.toHaveBeenCalled();

    cleanup.destroy();
  });
});
