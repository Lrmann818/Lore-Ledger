// @ts-check

export const DEFAULT_APP_SPLASH_MIN_DURATION_MS = 1800;
export const DEFAULT_APP_SPLASH_FADE_MS = 180;

/**
 * @param {{
 *   locationObj?: { protocol?: unknown } | null,
 *   capacitorObj?: { isNativePlatform?: (() => boolean) | unknown } | null
 * }} [options]
 * @returns {boolean}
 */
export function shouldUseManagedAppSplashHold(options = {}) {
  const locationObj = options.locationObj ?? globalThis.location;
  if (locationObj?.protocol === "capacitor:") return true;

  const globals = /** @type {typeof globalThis & { Capacitor?: { isNativePlatform?: (() => boolean) | unknown } }} */ (globalThis);
  const capacitorObj = options.capacitorObj ?? globals.Capacitor;
  if (!capacitorObj || typeof capacitorObj !== "object") return false;
  if (typeof capacitorObj.isNativePlatform !== "function") return false;

  try {
    return capacitorObj.isNativePlatform() === true;
  } catch {
    return false;
  }
}

/**
 * @param {number} fallback
 * @returns {number}
 */
function getNow(fallback) {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return fallback;
}

/**
 * @param {HTMLElement | null | undefined} splashEl
 * @returns {boolean}
 */
function isSplashHidden(splashEl) {
  if (!splashEl) return true;
  return splashEl.hidden || splashEl.hasAttribute("hidden");
}

/**
 * @param {HTMLElement | null | undefined} splashEl
 * @param {boolean} hidden
 * @returns {void}
 */
function setSplashHidden(splashEl, hidden) {
  if (!splashEl) return;
  splashEl.hidden = hidden;
  splashEl.toggleAttribute("hidden", hidden);
}

/**
 * @param {{ documentElement?: HTMLElement | null, body?: HTMLElement | null }} targets
 * @param {"loading" | "closing" | "ready"} nextState
 * @returns {void}
 */
function syncBootState(targets, nextState) {
  if (targets.documentElement) targets.documentElement.dataset.appBoot = nextState;
  if (targets.body) targets.body.dataset.appBoot = nextState;
}

/**
 * @param {() => number} now
 * @param {(cb: FrameRequestCallback) => number} requestAnimationFrameFn
 * @returns {Promise<void>}
 */
function waitForNextFrame(now, requestAnimationFrameFn) {
  return new Promise((resolve) => {
    requestAnimationFrameFn(() => {
      void now();
      resolve();
    });
  });
}

/**
 * @param {{
 *   splashEl?: HTMLElement | null,
 *   documentElement?: HTMLElement | null,
 *   body?: HTMLElement | null,
 *   minDurationMs?: number,
 *   hideTransitionMs?: number,
 *   startTimeMs?: number,
 *   now?: () => number,
 *   setTimeoutFn?: typeof setTimeout,
 *   clearTimeoutFn?: typeof clearTimeout,
 *   requestAnimationFrameFn?: typeof requestAnimationFrame
 * }} [options]
 */
export function createAppSplashController(options = {}) {
  const {
    splashEl = typeof document === "undefined"
      ? null
      : /** @type {HTMLElement | null} */ (document.getElementById("appSplash")),
    documentElement = typeof document === "undefined" ? null : document.documentElement,
    body = typeof document === "undefined" ? null : document.body,
    minDurationMs = shouldUseManagedAppSplashHold() ? DEFAULT_APP_SPLASH_MIN_DURATION_MS : 0,
    hideTransitionMs = DEFAULT_APP_SPLASH_FADE_MS,
    startTimeMs = typeof window !== "undefined" && typeof window.__APP_BOOT_STARTED_AT__ === "number"
      ? window.__APP_BOOT_STARTED_AT__
      : getNow(Date.now()),
    now = () => getNow(Date.now()),
    setTimeoutFn = globalThis.setTimeout.bind(globalThis),
    clearTimeoutFn = globalThis.clearTimeout.bind(globalThis),
    requestAnimationFrameFn = typeof requestAnimationFrame === "function"
      ? requestAnimationFrame.bind(globalThis)
      : /** @type {typeof requestAnimationFrame} */ ((cb) => setTimeoutFn(() => cb(now()), 16))
  } = options;

  const bootTargets = { documentElement, body };
  /** @type {((value: void | PromiseLike<void>) => void) | null} */
  let resolveHidden = null;
  const hiddenPromise = new Promise((resolve) => {
    resolveHidden = resolve;
  });

  let ready = false;
  let minElapsed = minDurationMs <= 0;
  let closeScheduled = false;
  let finished = isSplashHidden(splashEl);
  /** @type {ReturnType<typeof setTimeout> | null} */
  let minTimer = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let fallbackHideTimer = null;

  if (finished) {
    syncBootState(bootTargets, "ready");
    resolveHidden?.();
  } else {
    splashEl.dataset.state = "visible";
    syncBootState(bootTargets, "loading");

    const remainingMs = Math.max(0, minDurationMs - (now() - startTimeMs));
    if (remainingMs > 0) {
      minTimer = setTimeoutFn(() => {
        minElapsed = true;
        maybeHide();
      }, remainingMs);
    }
  }

  function finishHide() {
    if (finished) return;
    finished = true;
    closeScheduled = false;
    if (minTimer) {
      clearTimeoutFn(minTimer);
      minTimer = null;
    }
    if (fallbackHideTimer) {
      clearTimeoutFn(fallbackHideTimer);
      fallbackHideTimer = null;
    }
    if (splashEl) splashEl.dataset.state = "hidden";
    setSplashHidden(splashEl, true);
    syncBootState(bootTargets, "ready");
    resolveHidden?.();
  }

  function beginHide() {
    if (finished) return;
    syncBootState(bootTargets, "closing");
    if (splashEl) splashEl.dataset.state = "closing";

    if (!splashEl || hideTransitionMs <= 0) {
      finishHide();
      return;
    }

    const onTransitionEnd = () => finishHide();
    splashEl.addEventListener("transitionend", onTransitionEnd, { once: true });
    fallbackHideTimer = setTimeoutFn(finishHide, Math.max(0, hideTransitionMs) + 40);
  }

  function maybeHide() {
    if (finished || closeScheduled || !ready || !minElapsed) return;
    closeScheduled = true;
    void waitForNextFrame(now, requestAnimationFrameFn).then(() => {
      beginHide();
    });
  }

  return {
    /**
     * @returns {Promise<void>}
     */
    async markAppReady() {
      ready = true;
      maybeHide();
      return hiddenPromise;
    },
    /**
     * @returns {Promise<void>}
     */
    waitUntilHidden() {
      return hiddenPromise;
    },
    /**
     * @returns {boolean}
     */
    isVisible() {
      return !finished;
    }
  };
}
