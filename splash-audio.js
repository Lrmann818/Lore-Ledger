// Earliest-web intro audio attempt. This runs before the main app module so
// Capacitor/WKWebView can start the jingle while the launch artwork is still up
// when the platform allows it.
(function () {
  var GLOBAL_KEY = "__LORE_LEDGER_SPLASH_INTRO_SOUND__";
  var STORAGE_KEY = "localCampaignTracker_v1";
  var SOUND_URL = "/assets/sounds/the-lore-ledger.mp3";

  if (typeof window === "undefined" || window[GLOBAL_KEY]) return;

  var record = {
    allowedByPreference: false,
    attempted: false,
    settled: false,
    played: false,
    audio: null,
    promise: Promise.resolve(false),
    errorName: ""
  };
  window[GLOBAL_KEY] = record;

  try {
    var raw = localStorage.getItem(STORAGE_KEY);
    var data = raw ? JSON.parse(raw) : null;
    record.allowedByPreference = data?.app?.preferences?.playHubOpenSound === true;
  } catch (_) {
    record.allowedByPreference = false;
  }

  if (!record.allowedByPreference) return;
  if (typeof Audio !== "function") return;

  try {
    var audio = new Audio(SOUND_URL);
    audio.preload = "auto";
    record.audio = audio;
    record.attempted = true;
    try {
      audio.load?.();
    } catch (_) {
      // Loading may be unavailable in constrained WKWebView/browser contexts.
    }

    var playResult = audio.play();
    record.promise = Promise.resolve(playResult)
      .then(function () {
        record.played = true;
        return true;
      })
      .catch(function (err) {
        record.errorName = err && err.name ? String(err.name) : "PlaybackRejected";
        return false;
      })
      .finally(function () {
        record.settled = true;
      });
  } catch (err) {
    record.attempted = true;
    record.settled = true;
    record.errorName = err && err.name ? String(err.name) : "PlaybackError";
    record.promise = Promise.resolve(false);
  }
})();
