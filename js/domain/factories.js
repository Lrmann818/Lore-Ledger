// @ts-nocheck

export function makeId(prefix) {
  // Short, readable id good enough for local use.
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function makeNpc({ sectionId = "", group = "undecided", name = "", notes = "" } = {}) {
  return {
    id: makeId("npc"),
    // sectionId is the primary grouping field for current saves.
    // We keep `group` for backwards-compat / older saves.
    sectionId,
    group,
    name,
    notes,
    status: "",
    className: "",
    hpMax: null,
    hpCurrent: null,
    imgBlobId: null,
    portraitHidden: false,
    collapsed: false
  };
}

export function makePartyMember({ sectionId = "party", name = "", notes = "" } = {}) {
  return {
    id: makeId("party"),
    sectionId,
    name,
    notes,
    status: "",
    className: "",
    hpMax: null,
    hpCurrent: null,
    imgBlobId: null,
    portraitHidden: false,
    collapsed: false
  };
}

export function makeLocation({ sectionId = "", title = "", notes = "", type = "town" } = {}) {
  return {
    id: makeId("loc"),
    sectionId,
    title,
    notes,
    type,
    imgBlobId: null,
    portraitHidden: false,
    collapsed: false
  };
}
