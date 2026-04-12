// @ts-check
// js/audio/hubOpenSound.js — Campaign Hub intro music helper

export const HUB_OPEN_SOUND_URL = "/assets/sounds/the-lore-ledger.mp3";

/** @type {(HTMLAudioElement & { load?: () => void }) | null} */
let hubOpenAudio = null;

/**
 * @returns {(HTMLAudioElement & { load?: () => void }) | null}
 */
function getHubOpenAudio() {
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

  try {
    audio.pause?.();
    audio.currentTime = 0;
    const result = audio.play();
    if (result && typeof result.catch === "function") {
      await result.catch(() => {});
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
 * @returns {void}
 */
export function resetHubOpenSoundForTests() {
  hubOpenAudio = null;
}
