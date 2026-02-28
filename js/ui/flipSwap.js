// js/ui/flipSwap.js
// Shared two-element FLIP swap animation that composes with existing inline transforms.

const DEFAULT_DURATION_MS = 260;
const DEFAULT_EASING = "cubic-bezier(.22,1,.36,1)";

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
}

/**
 * Swap two elements with FLIP animation (transform-only).
 *
 * @param {HTMLElement | null | undefined} elA
 * @param {HTMLElement | null | undefined} elB
 * @param {Object} [opts]
 * @param {number} [opts.durationMs]
 * @param {string} [opts.easing]
 * @param {boolean} [opts.skipAnimation]
 * @param {() => void} [opts.swap]
 * @param {() => void} [opts.afterSwap]
 * @returns {boolean} true when swap ran, false when inputs were invalid.
 */
export function flipSwapTwo(elA, elB, opts = {}) {
  if (!elA || !elB || elA === elB) return false;

  const durationMs = Number.isFinite(opts.durationMs) ? opts.durationMs : DEFAULT_DURATION_MS;
  const easing = typeof opts.easing === "string" && opts.easing ? opts.easing : DEFAULT_EASING;
  const reduceMotion = opts.skipAnimation === true || prefersReducedMotion();

  const firstRectA = elA.getBoundingClientRect();
  const firstRectB = elB.getBoundingClientRect();

  opts.swap?.();
  opts.afterSwap?.();

  if (reduceMotion) return true;

  const lastRectA = elA.getBoundingClientRect();
  const lastRectB = elB.getBoundingClientRect();
  const deltaAX = firstRectA.left - lastRectA.left;
  const deltaAY = firstRectA.top - lastRectA.top;
  const deltaBX = firstRectB.left - lastRectB.left;
  const deltaBY = firstRectB.top - lastRectB.top;

  if ((deltaAX === 0 && deltaAY === 0) && (deltaBX === 0 && deltaBY === 0)) return true;

  const baseTransformA = elA.style.transform || "";
  const baseTransformB = elB.style.transform || "";
  const baseTransitionA = elA.style.transition || "";
  const baseTransitionB = elB.style.transition || "";

  elA.style.transform = baseTransformA
    ? `${baseTransformA} translate(${deltaAX}px, ${deltaAY}px)`
    : `translate(${deltaAX}px, ${deltaAY}px)`;
  elB.style.transform = baseTransformB
    ? `${baseTransformB} translate(${deltaBX}px, ${deltaBY}px)`
    : `translate(${deltaBX}px, ${deltaBY}px)`;

  // Force reflow so the transition starts from the inverted transform.
  elA.offsetHeight;

  const transitionValue = `transform ${durationMs}ms ${easing}`;
  elA.style.transition = transitionValue;
  elB.style.transition = transitionValue;
  elA.style.transform = baseTransformA;
  elB.style.transform = baseTransformB;

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    elA.style.transition = baseTransitionA;
    elB.style.transition = baseTransitionB;
    elA.removeEventListener("transitionend", onEndA);
    elB.removeEventListener("transitionend", onEndB);
  };
  const onEndA = (evt) => { if (evt.propertyName === "transform") cleanup(); };
  const onEndB = (evt) => { if (evt.propertyName === "transform") cleanup(); };

  elA.addEventListener("transitionend", onEndA);
  elB.addEventListener("transitionend", onEndB);
  setTimeout(cleanup, Math.max(0, durationMs) + 50);
  return true;
}
