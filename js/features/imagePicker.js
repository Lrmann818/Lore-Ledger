/**
 * Shared file picker helper (single hidden <input type="file">).
 *
 * Reuses one hidden input and provides a Promise-based API.
 * Includes a cancel fallback because many browsers won't fire a "change" event
 * if the user hits Cancel.
 */

export function createFilePicker(defaults = {}) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = defaults.accept || "image/*";
  input.multiple = !!defaults.multiple;
  input.style.display = "none";
  document.body.appendChild(input);

  // Serialize pick requests so callers can't race the same input.
  let tail = Promise.resolve();

  function _pickOnce(opts = {}) {
    const accept = typeof opts.accept === "string" ? opts.accept : (defaults.accept || "image/*");
    const multiple = typeof opts.multiple === "boolean" ? opts.multiple : !!defaults.multiple;

    input.accept = accept;
    input.multiple = multiple;
    input.value = "";

    return new Promise(resolve => {
      let settled = false;
      let focusTimer = 0;
      let lateCancelTimer = 0;

      const clearTimers = () => {
        window.clearTimeout(focusTimer);
        window.clearTimeout(lateCancelTimer);
      };

      const readFiles = () => Array.from(input.files || []);

      const cleanup = () => {
        clearTimers();
        input.removeEventListener("change", onChange);
        input.removeEventListener("cancel", onCancel);
        window.removeEventListener("focus", onFocus, true);
      };

      const finish = (files) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(files);
      };

      const onChange = () => {
        finish(readFiles());
      };

      // Some browsers emit an explicit cancel event for file inputs.
      const onCancel = () => {
        finish([]);
      };

      // Cancel fallback: after the picker closes, the window regains focus.
      // Give the file input a little extra time before treating it as cancel,
      // because some browsers restore focus before the selected file fully lands.
      const onFocus = () => {
        clearTimers();
        focusTimer = window.setTimeout(() => {
          if (settled) return;
          if (!document.hasFocus()) return;

          const list = readFiles();
          if (list.length > 0) {
            finish(list);
            return;
          }

          lateCancelTimer = window.setTimeout(() => {
            if (settled) return;
            if (!document.hasFocus()) return;
            finish(readFiles());
          }, 300);
        }, 250);
      };

      input.addEventListener("change", onChange, { once: true });
      input.addEventListener("cancel", onCancel, { once: true });
      window.addEventListener("focus", onFocus, true);

      input.click();
    });
  }

  async function pick(opts = {}) {
    tail = tail.then(() => _pickOnce(opts)).catch(() => []);
    return tail;
  }

  async function pickOne(opts = {}) {
    const files = await pick(opts);
    return files[0] || null;
  }

  return { pick, pickOne };
}
