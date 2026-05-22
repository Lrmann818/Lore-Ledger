/**
 * Shared file picker helper (single hidden <input type="file">).
 *
 * Reuses one hidden input and provides a Promise-based API.
 * Includes a cancel fallback because many browsers won't fire a "change" event
 * if the user hits Cancel.
 */

const IMAGE_FILES_ACCEPT = ".avif,.bmp,.gif,.heic,.heif,.jpeg,.jpg,.png,.tif,.tiff,.webp";

/**
 * @param {unknown} value
 * @param {string} fallback
 * @returns {string}
 */
function toNonEmptyString(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

/**
 * @param {string} accept
 * @returns {boolean}
 */
function isImageAccept(accept) {
  const normalized = toNonEmptyString(accept).toLowerCase();
  if (!normalized) return false;
  return normalized.includes("image/") || normalized.split(",").some((part) => /^\.[a-z0-9]+$/i.test(part.trim()));
}

/**
 * @param {{ locationObj?: { protocol?: unknown } | null, navigatorObj?: unknown, capacitorObj?: { isNativePlatform?: (() => boolean) | unknown } | null }} [options]
 * @returns {boolean}
 */
export function isNativeIosRuntime(options = {}) {
  const locationObj = options.locationObj ?? globalThis.location;
  const capacitorObj =
    options.capacitorObj ??
    /** @type {typeof globalThis & { Capacitor?: { isNativePlatform?: (() => boolean) | unknown } }} */ (globalThis).Capacitor;
  const navigatorObj = options.navigatorObj ?? globalThis.navigator;

  let isNative = locationObj?.protocol === "capacitor:";
  if (!isNative && capacitorObj && typeof capacitorObj === "object" && typeof capacitorObj.isNativePlatform === "function") {
    try {
      isNative = capacitorObj.isNativePlatform() === true;
    } catch {
      isNative = false;
    }
  }
  if (!isNative) return false;

  const userAgent = String(
    navigatorObj && typeof navigatorObj === "object"
      ? Reflect.get(navigatorObj, "userAgent")
      : ""
  );
  if (/\b(iPad|iPhone|iPod)\b/i.test(userAgent)) return true;

  const platform = String(
    navigatorObj && typeof navigatorObj === "object"
      ? Reflect.get(navigatorObj, "platform")
      : ""
  );
  const maxTouchPoints =
    navigatorObj && typeof navigatorObj === "object" && typeof Reflect.get(navigatorObj, "maxTouchPoints") === "number"
      ? Number(Reflect.get(navigatorObj, "maxTouchPoints"))
      : 0;
  return platform === "MacIntel" && maxTouchPoints > 1;
}

/**
 * @typedef {"camera" | "photos" | "files" | null} NativeImageSourceChoice
 */

/**
 * @param {NativeImageSourceChoice} value
 * @returns {value is "camera" | "photos" | "files"}
 */
function isNativeChoice(value) {
  return value === "camera" || value === "photos" || value === "files";
}

/**
 * @param {{ allowCamera?: boolean }} [options]
 * @returns {Promise<NativeImageSourceChoice>}
 */
export function promptForNativeImageSource(options = {}) {
  const allowCamera = options.allowCamera !== false;

  return new Promise((resolve) => {
    let settled = false;

    const overlay = document.createElement("div");
    overlay.className = "modalOverlay";
    overlay.setAttribute("role", "presentation");

    const panel = document.createElement("div");
    panel.className = "modalPanel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", "nativeImagePickerTitle");

    const title = document.createElement("div");
    title.id = "nativeImagePickerTitle";
    title.className = "modalTitle";
    title.textContent = "Add image";

    const message = document.createElement("div");
    message.textContent = "Choose how to add this image.";
    message.style.marginBottom = "12px";

    const btnColumn = document.createElement("div");
    btnColumn.className = "modalControls";
    btnColumn.style.display = "grid";
    btnColumn.style.gap = "10px";

    /** @type {HTMLButtonElement[]} */
    const choiceButtons = [];

    const buildChoiceButton = (label, value) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "modalBtn";
      btn.textContent = label;
      btn.addEventListener("click", () => finish(value));
      choiceButtons.push(btn);
      return btn;
    };

    if (allowCamera) btnColumn.appendChild(buildChoiceButton("Take Photo", "camera"));
    btnColumn.appendChild(buildChoiceButton("Photo Library", "photos"));
    btnColumn.appendChild(buildChoiceButton("Files", "files"));

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "modalBtn";
    cancelBtn.textContent = "Cancel";

    const btnRow = document.createElement("div");
    btnRow.className = "modalBtnRow";
    btnRow.appendChild(cancelBtn);

    panel.appendChild(title);
    panel.appendChild(message);
    panel.appendChild(btnColumn);
    panel.appendChild(btnRow);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    const cleanup = () => {
      document.removeEventListener("keydown", onKeyDown, true);
      cancelBtn.removeEventListener("click", onCancel);
      overlay.removeEventListener("click", onOverlayClick);
      try { overlay.remove(); } catch { }
    };

    const finish = (value) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const onCancel = () => finish(null);
    const onOverlayClick = (event) => {
      if (event.target === overlay) finish(null);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        finish(null);
      }
    };

    cancelBtn.addEventListener("click", onCancel);
    overlay.addEventListener("click", onOverlayClick);
    document.addEventListener("keydown", onKeyDown, true);
    queueMicrotask(() => {
      choiceButtons[0]?.focus();
    });
  });
}

/**
 * @param {unknown} err
 * @returns {string}
 */
function getErrorMessage(err) {
  if (err && typeof err === "object" && "message" in err) {
    return String(err.message || "");
  }
  return String(err || "");
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
function isUserCancelError(err) {
  return /user cancelled photos app|aborterror|cancelled/i.test(getErrorMessage(err));
}

/**
 * @param {string} format
 * @returns {string}
 */
function normalizeImageMimeType(format) {
  const normalized = toNonEmptyString(format, "jpeg").replace(/^\./, "").toLowerCase();
  if (normalized === "jpg") return "image/jpeg";
  if (normalized === "svg") return "image/svg+xml";
  return `image/${normalized}`;
}

/**
 * @param {string} format
 * @returns {string}
 */
function normalizeImageExtension(format) {
  const normalized = toNonEmptyString(format, "jpg").replace(/^\./, "").toLowerCase();
  return normalized === "jpeg" ? "jpg" : normalized;
}

/**
 * @param {{ photo?: { webPath?: string, path?: string, format?: string }, fetchImpl?: typeof fetch, filenameStem?: string }} [options]
 * @returns {Promise<File>}
 */
async function convertNativePhotoToFile(options = {}) {
  const photo = options.photo || {};
  const fetchImpl = options.fetchImpl ?? fetch;
  const sourceUrl = toNonEmptyString(photo.webPath, toNonEmptyString(photo.path));
  if (!sourceUrl) throw new Error("Camera did not return an image path.");

  const response = await fetchImpl(sourceUrl);
  if (!response || !response.ok) {
    throw new Error(`Could not load captured image (${response?.status || "unknown"}).`);
  }

  const blob = await response.blob();
  const extension = normalizeImageExtension(photo.format || blob.type.replace(/^image\//i, ""));
  const mimeType = blob.type || normalizeImageMimeType(photo.format || extension);
  return new File([blob], `${toNonEmptyString(options.filenameStem, "lore-ledger-image")}.${extension}`, {
    type: mimeType,
    lastModified: Date.now(),
  });
}

/**
 * @param {unknown} value
 * @returns {"granted" | "denied" | "prompt" | "limited"}
 */
function normalizePermissionState(value) {
  const normalized = toNonEmptyString(value, "prompt");
  if (normalized === "granted" || normalized === "denied" || normalized === "limited") return normalized;
  return "prompt";
}

/**
 * @param {{ cameraApi?: { Camera?: unknown, CameraResultType?: { Uri?: unknown }, CameraSource?: { Camera?: unknown, Photos?: unknown } }, permissionType?: "camera" | "photos" }} [options]
 * @returns {Promise<"granted" | "denied" | "prompt" | "limited" | "unavailable">}
 */
async function ensureNativePermission(options = {}) {
  const { cameraApi, permissionType = "camera" } = options;
  const Camera = cameraApi?.Camera;
  if (!Camera || typeof Camera !== "object") return "unavailable";

  const readPermissionState = (status) => {
    if (!status || typeof status !== "object") return "prompt";
    const value = permissionType === "photos"
      ? Reflect.get(status, "photos")
      : Reflect.get(status, "camera");
    return normalizePermissionState(value);
  };

  try {
    const current = typeof Reflect.get(Camera, "checkPermissions") === "function"
      ? await Reflect.get(Camera, "checkPermissions").call(Camera)
      : null;
    const currentState = readPermissionState(current);
    if (currentState === "granted" || currentState === "limited") return currentState;
    if (currentState === "denied") return "denied";

    const requestPermissions = Reflect.get(Camera, "requestPermissions");
    if (typeof requestPermissions !== "function") return currentState === "prompt" ? "unavailable" : currentState;

    const next = await requestPermissions.call(Camera, {
      permissions: [permissionType]
    });
    const nextState = readPermissionState(next);
    return (nextState === "granted" || nextState === "limited" || nextState === "denied") ? nextState : "prompt";
  } catch (err) {
    console.error(`Failed to check/request ${permissionType} permission:`, err);
    return "unavailable";
  }
}

/**
 * @param {{ uiAlert?: (message: string, options?: { title?: string }) => Promise<unknown> | unknown, setStatus?: (message?: string | null) => void, title: string, message: string }} options
 * @returns {Promise<void>}
 */
async function showPickerAlert({ uiAlert, setStatus, title, message }) {
  try {
    setStatus?.(message);
  } catch { }
  if (typeof uiAlert !== "function") return;
  try {
    await uiAlert(message, { title });
  } catch { }
}

/**
 * @param {{
 *   cameraApi?: { Camera?: unknown, CameraResultType?: { Uri?: unknown }, CameraSource?: { Camera?: unknown, Photos?: unknown } },
 *   source?: "camera" | "photos",
 *   uiAlert?: (message: string, options?: { title?: string }) => Promise<unknown> | unknown,
 *   setStatus?: (message?: string | null) => void,
 *   fetchImpl?: typeof fetch
 * }} [options]
 * @returns {Promise<File | null>}
 */
async function pickNativeImage(options = {}) {
  const source = options.source === "photos" ? "photos" : "camera";
  const { cameraApi, uiAlert, setStatus, fetchImpl } = options;
  const Camera = cameraApi?.Camera;
  const CameraResultType = cameraApi?.CameraResultType;
  const CameraSource = cameraApi?.CameraSource;
  const getPhoto = Camera && typeof Camera === "object" ? Reflect.get(Camera, "getPhoto") : null;

  if (!Camera || !CameraResultType?.Uri || !CameraSource?.Camera || !CameraSource?.Photos || typeof getPhoto !== "function") {
    await showPickerAlert({
      uiAlert,
      setStatus,
      title: "Image Picker Unavailable",
      message: "This build is missing the native image picker bridge."
    });
    return null;
  }

  const permissionState = await ensureNativePermission({
    cameraApi,
    permissionType: source === "camera" ? "camera" : "photos"
  });

  if (permissionState === "denied") {
    await showPickerAlert({
      uiAlert,
      setStatus,
      title: source === "camera" ? "Camera Access Needed" : "Photos Access Needed",
      message:
        source === "camera"
          ? "Camera access is turned off. Enable Camera for Lore Ledger in Settings to take character or campaign photos."
          : "Photo Library access is turned off. Enable Photos for Lore Ledger in Settings to choose an existing image."
    });
    return null;
  }

  if (permissionState === "unavailable") {
    await showPickerAlert({
      uiAlert,
      setStatus,
      title: "Image Picker Unavailable",
      message: "This device could not open the native image picker."
    });
    return null;
  }

  try {
    const photo = await getPhoto.call(Camera, {
      resultType: CameraResultType.Uri,
      source: source === "camera" ? CameraSource.Camera : CameraSource.Photos,
      correctOrientation: true,
      saveToGallery: false,
      promptLabelHeader: "Add Image",
      promptLabelPhoto: "Photo Library",
      promptLabelPicture: "Take Photo",
      promptLabelCancel: "Cancel"
    });
    return await convertNativePhotoToFile({
      photo,
      fetchImpl,
      filenameStem: source === "camera" ? "lore-ledger-camera" : "lore-ledger-photo"
    });
  } catch (err) {
    if (isUserCancelError(err)) return null;

    const message = getErrorMessage(err);
    if (/camera not available/i.test(message)) {
      await showPickerAlert({
        uiAlert,
        setStatus,
        title: "Camera Unavailable",
        message: "This device could not open the camera."
      });
      return null;
    }

    if (/denied access to camera/i.test(message)) {
      await showPickerAlert({
        uiAlert,
        setStatus,
        title: "Camera Access Needed",
        message: "Camera access is turned off. Enable Camera for Lore Ledger in Settings to take character or campaign photos."
      });
      return null;
    }

    if (/denied access to photos/i.test(message)) {
      await showPickerAlert({
        uiAlert,
        setStatus,
        title: "Photos Access Needed",
        message: "Photo Library access is turned off. Enable Photos for Lore Ledger in Settings to choose an existing image."
      });
      return null;
    }

    console.error(`Native ${source} image pick failed:`, err);
    await showPickerAlert({
      uiAlert,
      setStatus,
      title: "Image Picker Failed",
      message: source === "camera"
        ? "Lore Ledger could not open the camera. Try Photo Library or Files instead."
        : "Lore Ledger could not open the photo library. Try Files instead."
    });
    return null;
  }
}

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

/**
 * @typedef {{
 *   Camera?: unknown,
 *   CameraResultType?: { Uri?: unknown },
 *   CameraSource?: { Camera?: unknown, Photos?: unknown }
 * }} NativeCameraApi
 */

/**
 * @param {{
 *   accept?: string,
 *   multiple?: boolean,
 *   uiAlert?: (message: string, options?: { title?: string }) => Promise<unknown> | unknown,
 *   setStatus?: (message?: string | null) => void,
 *   cameraApi?: NativeCameraApi,
 *   loadCameraApi?: () => Promise<NativeCameraApi | null | undefined>,
 *   chooseNativeSource?: (options?: { allowCamera?: boolean }) => Promise<NativeImageSourceChoice>,
 *   fetchImpl?: typeof fetch,
 *   locationObj?: { protocol?: unknown } | null,
 *   navigatorObj?: unknown,
 *   capacitorObj?: { isNativePlatform?: (() => boolean) | unknown } | null
 * }} [defaults]
 */
export function createImagePicker(defaults = {}) {
  const filePicker = createFilePicker(defaults);
  const chooseNativeSource = defaults.chooseNativeSource || promptForNativeImageSource;
  const filesAccept = IMAGE_FILES_ACCEPT;
  let loadedCameraApi = defaults.cameraApi || null;
  let nativeLaunchInFlight = false;

  async function getCameraApi() {
    if (loadedCameraApi) return loadedCameraApi;
    if (typeof defaults.loadCameraApi !== "function") return null;
    try {
      loadedCameraApi = (await defaults.loadCameraApi()) || null;
    } catch (err) {
      console.error("Failed to load native camera bridge:", err);
      loadedCameraApi = null;
    }
    return loadedCameraApi;
  }

  async function pick(opts = {}) {
    const accept = typeof opts.accept === "string" ? opts.accept : (defaults.accept || "image/*");
    const isNativeImageFlow =
      isImageAccept(accept) &&
      isNativeIosRuntime({
        locationObj: defaults.locationObj,
        navigatorObj: defaults.navigatorObj,
        capacitorObj: defaults.capacitorObj
      });

    if (!isNativeImageFlow) return filePicker.pick(opts);
    if (nativeLaunchInFlight) return [];

    nativeLaunchInFlight = true;
    try {
      const allowCamera = !!(defaults.cameraApi || defaults.loadCameraApi);
      const choice = await chooseNativeSource({ allowCamera });
      if (!isNativeChoice(choice)) return [];

      if (choice === "camera" || choice === "photos") {
        const cameraApi = await getCameraApi();
        const nativeFile = await pickNativeImage({
          cameraApi,
          source: choice,
          uiAlert: defaults.uiAlert,
          setStatus: defaults.setStatus,
          fetchImpl: defaults.fetchImpl
        });
        return nativeFile ? [nativeFile] : [];
      }

      return filePicker.pick({
        ...opts,
        accept: filesAccept
      });
    } finally {
      nativeLaunchInFlight = false;
    }
  }

  async function pickOne(opts = {}) {
    const files = await pick(opts);
    return files[0] || null;
  }

  return { pick, pickOne };
}
