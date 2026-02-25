const DEFAULT_MIN_CARD_WIDTH = 175;
const DEFAULT_GAP_VAR = "--cardsGap";

const stateByContainer = new WeakMap();

function toPx(value) {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

function readGap(container, gapVar) {
  const cs = getComputedStyle(container);
  const fromVar = toPx(cs.getPropertyValue(gapVar));
  if (fromVar > 0) return fromVar;
  const rowGap = toPx(cs.rowGap);
  if (rowGap > 0) return rowGap;
  return toPx(cs.gap);
}

function getCardElements(container) {
  return Array.from(container.children).filter((el) => el.classList?.contains("npcCard"));
}

function clearCardLayout(cards) {
  cards.forEach((card) => {
    card.style.transform = "";
    card.style.width = "";
  });
}

function runLayout(state) {
  state.scheduled = false;

  const container = state.container;
  if (!container || !container.isConnected) return;

  const cards = getCardElements(container);
  if (!cards.length) {
    container.style.height = "";
    return;
  }

  container.classList.add("masonryEnabled");

  const opts = state.options;
  const gap = Math.max(0, readGap(container, opts.gapVar));
  const cs = getComputedStyle(container);
  const padLeft = toPx(cs.paddingLeft);
  const padRight = toPx(cs.paddingRight);
  const padTop = toPx(cs.paddingTop);
  const padBottom = toPx(cs.paddingBottom);
  const contentWidth = Math.max(0, container.clientWidth - padLeft - padRight);

  const canUseTwoCols = contentWidth >= ((opts.minCardWidth * 2) + gap);
  const cols = canUseTwoCols ? 2 : 1;
  const columnWidth = cols === 2 ? Math.max(0, (contentWidth - gap) / 2) : contentWidth;

  cards.forEach((card) => {
    card.style.width = cols === 2 ? `${columnWidth}px` : "100%";
  });

  const colY = new Array(cols).fill(padTop);
  const placements = [];

  cards.forEach((card, index) => {
    const col = cols === 1 ? 0 : (index % 2);
    const x = padLeft + (col * (columnWidth + gap));
    const y = colY[col];
    const h = card.getBoundingClientRect().height;

    placements.push({ card, x, y });
    colY[col] += h + gap;
  });

  placements.forEach(({ card, x, y }) => {
    card.style.transform = `translate(${x}px, ${y}px)`;
  });

  const tallestColumnBottom = Math.max(...colY) - gap;
  const height = Math.max(0, tallestColumnBottom + padBottom);
  container.style.height = `${Math.ceil(height)}px`;
}

function schedule(state) {
  if (!state || state.scheduled) return;
  state.scheduled = true;
  state.rafId = requestAnimationFrame(() => runLayout(state));
}

export function attach(container, options = {}) {
  if (!container) return;

  let state = stateByContainer.get(container);
  if (!state) {
    state = {
      container,
      options: {
        panelName: "",
        minCardWidth: DEFAULT_MIN_CARD_WIDTH,
        gapVar: DEFAULT_GAP_VAR,
      },
      resizeObserver: null,
      scheduled: false,
      rafId: 0,
      onLoad: null,
      attached: false,
    };
    stateByContainer.set(container, state);
  }

  state.options = {
    ...state.options,
    ...options,
    minCardWidth: Number.isFinite(options.minCardWidth) ? options.minCardWidth : state.options.minCardWidth,
    gapVar: options.gapVar || state.options.gapVar,
  };

  if (!state.attached) {
    container.classList.add("masonryEnabled");

    state.resizeObserver = new ResizeObserver(() => {
      schedule(state);
    });
    state.resizeObserver.observe(container);

    state.onLoad = (event) => {
      const target = event.target;
      if (target instanceof HTMLImageElement) {
        schedule(state);
      }
    };
    container.addEventListener("load", state.onLoad, true);

    state.attached = true;
  }
}

export function relayout(container) {
  if (!container) return;

  const state = stateByContainer.get(container);
  if (!state) {
    attach(container);
    const created = stateByContainer.get(container);
    schedule(created);
    return;
  }

  schedule(state);
}

export function detach(container) {
  const state = stateByContainer.get(container);
  if (!state) return;

  if (state.rafId) cancelAnimationFrame(state.rafId);
  state.resizeObserver?.disconnect();

  if (state.onLoad) {
    container.removeEventListener("load", state.onLoad, true);
  }

  const cards = getCardElements(container);
  clearCardLayout(cards);
  container.style.height = "";
  container.classList.remove("masonryEnabled");

  stateByContainer.delete(container);
}
