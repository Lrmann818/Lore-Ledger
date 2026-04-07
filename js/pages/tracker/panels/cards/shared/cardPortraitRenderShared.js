/** @typedef {typeof import("../../../../../storage/blobs.js").blobIdToObjectUrl} BlobIdToObjectUrlFn */
/**
 * @typedef {{
 *   blobId?: string | null,
 *   altText?: string,
 *   title?: string,
 *   placeholderText?: string,
 *   blobIdToObjectUrl?: BlobIdToObjectUrlFn,
 *   onPick?: () => unknown,
 *   isHidden?: boolean,
 *   onToggleHidden?: (hidden: boolean) => unknown,
 *   headerControlsEl?: HTMLElement | null,
 *   onImageLoad?: () => unknown,
 *   iconPath?: string
 * }} RenderCardPortraitOptions
 */

/**
 * @param {RenderCardPortraitOptions} [options]
 * @returns {HTMLDivElement | null}
 */
export function renderCardPortrait({
  blobId,
  altText,
  title = "Click to set/replace image",
  placeholderText = "Click to add image",
  blobIdToObjectUrl,
  onPick,
  isHidden = false,
  onToggleHidden,
  headerControlsEl,
  onImageLoad,
  iconPath = "icons/imageIcon.svg",
} = {}) {
  const hasImage = !!blobId;
  const hidden = !!isHidden && !hasImage;
  const canToggle = typeof onToggleHidden === "function";

  /**
   * @param {{ hide?: boolean } | undefined} options
   * @returns {HTMLButtonElement}
   */
  const createToggleButton = (options) => {
    const hide = options?.hide === true;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `moveBtn cardPortraitToggleBtn${hide ? " cardPortraitToggleBtnOverlay" : " cardPortraitToggleBtnHeader"}`;
    if (hide) btn.classList.add("cardPortraitToggleBtn--portrait");
    const label = hide ? "Hide image" : "Show image";
    btn.setAttribute("aria-label", label);
    btn.title = label;

    const icon = document.createElement("span");
    icon.className = "iconMask icon-image cardPortraitToggleIcon";
    icon.setAttribute("aria-hidden", "true");
    btn.appendChild(icon);

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      onToggleHidden?.(hide);
    });
    return btn;
  };

  if (hidden && !hasImage) {
    if (canToggle && headerControlsEl) {
      headerControlsEl.appendChild(createToggleButton({ hide: false }));
    }
    return null;
  }

  const portrait = document.createElement("div");
  portrait.className = "npcPortraitTop";
  portrait.title = title;

  if (hasImage) {
    const img = document.createElement("img");
    img.alt = altText || "";
    if (typeof onImageLoad === "function" && !img.dataset.portraitLoadBound) {
      img.dataset.portraitLoadBound = "1";
      img.addEventListener("load", () => onImageLoad(), { once: true });
    }
    portrait.appendChild(img);

    if (typeof blobIdToObjectUrl === "function") {
      blobIdToObjectUrl(blobId).then(url => {
        if (url) img.src = url;
      });
    }
  } else {
    const placeholder = document.createElement("div");
    placeholder.className = "mutedSmall";
    placeholder.textContent = placeholderText;
    portrait.appendChild(placeholder);
  }

  if (canToggle && !hasImage) {
    portrait.appendChild(createToggleButton({ hide: true }));
  }

  portrait.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (typeof onPick === "function") onPick();
  });
  return portrait;
}
