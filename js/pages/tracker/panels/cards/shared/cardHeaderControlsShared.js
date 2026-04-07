// Shared header control button builders for tracker cards.

/**
 * @typedef {{
 *   direction: -1 | 1,
 *   onMove: (direction: -1 | 1) => void,
 *   className?: string,
 *   titleUp?: string,
 *   titleDown?: string
 * }} MoveButtonOptions
 */
/**
 * @typedef {{
 *   isCollapsed: boolean,
 *   onToggle: () => void,
 *   className?: string
 * }} CollapseButtonOptions
 */

/**
 * Create a move button (up/down) for card headers.
 *
 * @param {MoveButtonOptions | undefined} options
 * @returns {HTMLButtonElement}
 */
export function createMoveButton(options) {
  const direction = options?.direction;
  const onMove = options?.onMove;
  const className = options?.className || "moveBtn";
  const titleUp = options?.titleUp || "Move card up";
  const titleDown = options?.titleDown || "Move card down";
  const dir = direction === -1 ? -1 : 1;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = className;
  btn.textContent = dir === -1 ? "\u2191" : "\u2193";
  btn.title = dir === -1 ? titleUp : titleDown;
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (typeof onMove === "function") onMove(dir);
  });
  return btn;
}

/**
 * Create a collapse/expand toggle button for card headers.
 *
 * @param {CollapseButtonOptions | undefined} options
 * @returns {HTMLButtonElement}
 */
export function createCollapseButton(options) {
  const isCollapsed = options?.isCollapsed;
  const onToggle = options?.onToggle;
  const className = options?.className || "cardCollapseBtn";
  const collapsed = !!isCollapsed;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = className;
  btn.setAttribute("aria-label", collapsed ? "Expand card" : "Collapse card");
  btn.setAttribute("aria-expanded", (!collapsed).toString());
  btn.textContent = collapsed ? "\u25bc" : "\u25b2";
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (typeof onToggle === "function") onToggle();
  });
  return btn;
}
