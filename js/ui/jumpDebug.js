let _jumpDebugEnabled = null;
let _jumpDebugRunId = 0;

function isElement(value) {
  return !!value && value.nodeType === Node.ELEMENT_NODE;
}

function getActiveElementLabel() {
  const el = document.activeElement;
  if (!isElement(el)) return "none";

  const tag = (el.tagName || "UNKNOWN").toUpperCase();
  const idPart = el.id ? `#${el.id}` : "";
  const classNames = typeof el.className === "string" ? el.className.trim().split(/\s+/).filter(Boolean) : [];
  const classPart = classNames.length ? `.${classNames.join(".")}` : "";
  return `${tag}${idPart}${classPart}`;
}

function getCardTop(getCardEl) {
  const cardEl = typeof getCardEl === "function" ? getCardEl() : null;
  if (!isElement(cardEl)) return "na";
  return Math.round(cardEl.getBoundingClientRect().top);
}

export function isJumpDebugEnabled() {
  if (_jumpDebugEnabled != null) return _jumpDebugEnabled;
  try {
    const params = new URLSearchParams(window.location.search);
    _jumpDebugEnabled = params.get("jumpDebug") === "1";
  } catch {
    _jumpDebugEnabled = false;
  }
  return _jumpDebugEnabled;
}

export function startJumpDebugRun({ panel, cardId, action, panelEl, getCardEl }) {
  if (!isJumpDebugEnabled()) return null;

  const runId = ++_jumpDebugRunId;

  function log(checkpoint) {
    const winY = Math.round(window.scrollY || 0);
    const panelY = panelEl ? Math.round(panelEl.scrollTop || 0) : "na";
    const top = getCardTop(getCardEl);
    const active = getActiveElementLabel();
    console.log(
      `[jumpDebug] runId=${runId} panel=${panel} card=${cardId} action=${action} checkpoint=${checkpoint} winY=${winY} panelY=${panelY} top=${top} active=${active}`
    );
  }

  return { log };
}

export function queueJumpDebugCheckpoints(run) {
  if (!run) return;

  requestAnimationFrame(() => {
    run.log("after-raf-1");
    requestAnimationFrame(() => {
      run.log("after-raf-2");
    });
  });

  setTimeout(() => {
    run.log("after-timeout-200ms");
  }, 200);
}
