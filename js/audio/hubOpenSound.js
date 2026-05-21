// @ts-check
// js/audio/hubOpenSound.js — Campaign Hub intro music helper/controller

export const HUB_OPEN_SOUND_URL = "/assets/sounds/the-lore-ledger.mp3";
export const SPLASH_INTRO_SOUND_GLOBAL_KEY = "__LORE_LEDGER_SPLASH_INTRO_SOUND__";

/** @type {(HTMLAudioElement & { load?: () => void }) | null} */
let hubOpenAudio = null;

/**
 * @typedef {{
 *   allowedByPreference?: boolean,
 *   attempted?: boolean,
 *   settled?: boolean,
 *   played?: boolean,
 *   audio?: (HTMLAudioElement & { load?: () => void }) | null,
 *   promise?: Promise<boolean> | null,
 *   errorName?: string
 * }} SplashIntroSoundRecord
 */

/**
 * @typedef {{
 *   getState: () => unknown,
 *   isHubVisible: () => boolean,
 *   documentTarget?: EventTarget | null,
 *   windowTarget?: EventTarget | null
 * }} HubOpenSoundControllerDeps
 *
 * @typedef {{
 *   requestLaunchSound: () => Promise<boolean>,
 *   requestHubEntrySound: () => Promise<boolean>,
 *   retryPending: () => Promise<boolean>,
 *   hasPendingRequest: () => boolean,
 *   hasPendingLaunchRequest: () => boolean,
 *   hasPendingHubEntryRequest: () => boolean,
 *   destroy: () => void
 * }} HubOpenSoundController
 */

/**
 * @returns {SplashIntroSoundRecord | null}
 */
function getSplashIntroSoundRecord() {
  if (typeof globalThis === "undefined") return null;
  const globals = /** @type {Record<string, unknown>} */ (globalThis);
  const record = globals[SPLASH_INTRO_SOUND_GLOBAL_KEY];
  if (!record || typeof record !== "object") return null;
  return /** @type {SplashIntroSoundRecord} */ (record);
}

/**
 * @returns {boolean}
 */
function adoptSplashAudioIfAvailable() {
  const record = getSplashIntroSoundRecord();
  if (!record?.audio) return false;
  hubOpenAudio = record.audio;
  return true;
}

/**
 * @returns {boolean}
 */
function hasHubOpenSoundSatisfiedThisBoot() {
  const record = getSplashIntroSoundRecord();
  return record?.played === true;
}

/**
 * @returns {Promise<boolean>}
 */
async function waitForSplashIntroSound() {
  const record = getSplashIntroSoundRecord();
  if (!record?.attempted) return false;
  adoptSplashAudioIfAvailable();
  if (record.played === true) {
    return true;
  }
  if (record.promise && typeof record.promise.then === "function") {
    try {
      const played = await record.promise;
      if (played) {
        record.played = true;
        return true;
      }
    } catch (_) {
      // The splash path must never surface autoplay rejections to app startup.
    }
  }
  return false;
}

/**
 * @returns {(HTMLAudioElement & { load?: () => void }) | null}
 */
function getHubOpenAudio() {
  if (hubOpenAudio) return hubOpenAudio;
  adoptSplashAudioIfAvailable();
  if (hubOpenAudio) return hubOpenAudio;
  if (typeof Audio !== "function") return null;

  hubOpenAudio = /** @type {HTMLAudioElement & { load?: () => void }} */ (new Audio(HUB_OPEN_SOUND_URL));
  hubOpenAudio.preload = "auto";
  try {
    hubOpenAudio.load?.();
  } catch (_) {
    // Loading can be unavailable in tests or constrained browser contexts.
  }
  return hubOpenAudio;
}

/**
 * @returns {Promise<boolean>}
 */
export async function playHubOpenSound() {
  const audio = getHubOpenAudio();
  if (!audio) return false;
  if (typeof audio.play !== "function") return false;

  try {
    audio.pause?.();
    audio.currentTime = 0;
    const result = audio.play();
    if (result && typeof result.then === "function") {
      await result;
    }
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * @param {unknown} state
 * @returns {boolean}
 */
export function shouldPlayHubOpenSound(state) {
  return !!(
    state &&
    typeof state === "object" &&
    "app" in state &&
    /** @type {{ app?: { preferences?: { playHubOpenSound?: unknown } } }} */ (state).app?.preferences?.playHubOpenSound === true
  );
}

/**
 * @param {unknown} state
 * @returns {Promise<boolean>}
 */
export function playHubOpenSoundForState(state) {
  if (!shouldPlayHubOpenSound(state)) return Promise.resolve(false);
  return playHubOpenSound();
}

/**
 * Creates a small app-level controller for Hub launch/entry playback.
 *
 * The controller has no global side effects until a blocked request needs
 * recovery. At that point it listens for user/browser reactivation signals
 * and retries only requests that were explicitly made.
 *
 * @param {HubOpenSoundControllerDeps} deps
 * @returns {HubOpenSoundController}
 */
export function createHubOpenSoundController(deps) {
  const {
    getState,
    isHubVisible,
    documentTarget = typeof document === "undefined" ? null : document,
    windowTarget = typeof window === "undefined" ? null : window
  } = deps;

  /** @type {Array<() => void>} */
  let removeReactivationListeners = [];
  let launchRequested = false;
  let pendingLaunchRequest = false;
  let pendingHubEntryRequest = false;
  let controllerSoundSatisfied = false;
  /** @type {Promise<boolean> | null} */
  let retryInFlight = null;

  /**
   * @returns {boolean}
   */
  function isSoundEnabled() {
    return shouldPlayHubOpenSound(getState());
  }

  /**
   * @returns {boolean}
   */
  function canAttemptLaunchPlayback() {
    return isSoundEnabled();
  }

  /**
   * @returns {boolean}
   */
  function canAttemptHubEntryPlayback() {
    return isSoundEnabled() && isHubVisible();
  }

  function removeListeners() {
    removeReactivationListeners.forEach((remove) => remove());
    removeReactivationListeners = [];
  }

  function syncReactivationListeners() {
    if (pendingLaunchRequest || pendingHubEntryRequest) {
      ensureReactivationListeners();
      return;
    }
    removeListeners();
  }

  function clearPendingLaunchRequest() {
    pendingLaunchRequest = false;
    syncReactivationListeners();
  }

  function clearPendingHubEntryRequest() {
    pendingHubEntryRequest = false;
    syncReactivationListeners();
  }

  function clearPendingRequests() {
    pendingLaunchRequest = false;
    pendingHubEntryRequest = false;
    removeListeners();
  }

  function onReactivationSignal() {
    void retryPending();
  }

  /**
   * @param {EventTarget | null | undefined} target
   * @param {string} type
   * @returns {void}
   */
  function listen(target, type) {
    if (!target || typeof target.addEventListener !== "function") return;
    target.addEventListener(type, onReactivationSignal);
    removeReactivationListeners.push(() => {
      target.removeEventListener(type, onReactivationSignal);
    });
  }

  function ensureReactivationListeners() {
    if (removeReactivationListeners.length) return;
    listen(documentTarget, "pointerdown");
    listen(documentTarget, "touchend");
    listen(documentTarget, "keydown");
    listen(windowTarget, "focus");
    listen(windowTarget, "pageshow");
    listen(documentTarget, "visibilitychange");
  }

  function markPendingLaunchRequest() {
    pendingLaunchRequest = true;
    ensureReactivationListeners();
  }

  function markPendingHubEntryRequest() {
    pendingHubEntryRequest = true;
    ensureReactivationListeners();
  }

  /**
   * @returns {Promise<boolean>}
   */
  async function requestLaunchSound() {
    if (launchRequested) return false;
    launchRequested = true;
    if (!canAttemptLaunchPlayback()) return false;
    if (await waitForSplashIntroSound()) {
      controllerSoundSatisfied = true;
      clearPendingLaunchRequest();
      clearPendingHubEntryRequest();
      return true;
    }
    if (controllerSoundSatisfied || hasHubOpenSoundSatisfiedThisBoot()) return false;
    if (retryInFlight) {
      markPendingLaunchRequest();
      return false;
    }

    const played = await playHubOpenSound();
    if (played) {
      controllerSoundSatisfied = true;
      clearPendingLaunchRequest();
      clearPendingHubEntryRequest();
      return true;
    }

    markPendingLaunchRequest();
    return false;
  }

  /**
   * @returns {Promise<boolean>}
   */
  async function requestHubEntrySound() {
    if (!canAttemptHubEntryPlayback()) return false;
    if (await waitForSplashIntroSound()) {
      controllerSoundSatisfied = true;
      clearPendingLaunchRequest();
      clearPendingHubEntryRequest();
      return false;
    }
    if (controllerSoundSatisfied || hasHubOpenSoundSatisfiedThisBoot()) return false;
    if (retryInFlight) {
      markPendingHubEntryRequest();
      return false;
    }

    const played = await playHubOpenSound();
    if (played) {
      controllerSoundSatisfied = true;
      clearPendingLaunchRequest();
      clearPendingHubEntryRequest();
      return true;
    }

    markPendingHubEntryRequest();
    return false;
  }

  /**
   * @returns {Promise<boolean>}
   */
  async function retryPending() {
    if (!pendingLaunchRequest && !pendingHubEntryRequest) return false;
    if (retryInFlight) return retryInFlight;

    /** @type {"launch" | "hubEntry" | null} */
    let requestType = null;
    if (pendingLaunchRequest && canAttemptLaunchPlayback()) {
      requestType = "launch";
    } else if (pendingHubEntryRequest && canAttemptHubEntryPlayback()) {
      requestType = "hubEntry";
    }
    if (!requestType) return false;

    retryInFlight = playHubOpenSound();
    try {
      const played = await retryInFlight;
      if (played) {
        controllerSoundSatisfied = true;
        clearPendingLaunchRequest();
        clearPendingHubEntryRequest();
      }
      return played;
    } finally {
      retryInFlight = null;
    }
  }

  return {
    requestLaunchSound,
    requestHubEntrySound,
    retryPending,
    hasPendingRequest: () => pendingLaunchRequest || pendingHubEntryRequest,
    hasPendingLaunchRequest: () => pendingLaunchRequest,
    hasPendingHubEntryRequest: () => pendingHubEntryRequest,
    destroy: () => {
      clearPendingRequests();
      retryInFlight = null;
      controllerSoundSatisfied = false;
    }
  };
}

/**
 * @returns {void}
 */
export function resetHubOpenSoundForTests() {
  hubOpenAudio = null;
  if (typeof globalThis !== "undefined") {
    const globals = /** @type {Record<string, unknown>} */ (globalThis);
    delete globals[SPLASH_INTRO_SOUND_GLOBAL_KEY];
  }
}
