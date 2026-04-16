// @ts-check
// js/pages/combat/combatEmbeddedPanels.js
//
// Slice 7 — Embedded Panels
//
// Panel picker, view model helpers, and renderers for the five supported
// embedded panels: Vitals, Spells, Weapons / Attacks, Equipment, and
// Abilities / Skills.
//
// Architecture rules:
//  - Hosted Character panel modules read/write the active character entry
//    through state.characters — no copied data, no sync layers.
//  - Panel selection and order persist via combat.workspace.
//  - Combat encounter changes do not create a separate embedded-panel sync
//    store; hosted panels operate directly against canonical character state.

import { COMBAT_ENCOUNTER_CHANGED_EVENT } from "./combatEvents.js";
import { initAttacksPanel } from "../character/panels/attackPanel.js";
import { initSpellsPanel } from "../character/panels/spellsPanel.js";
import { initVitalsPanel } from "../character/panels/vitalsPanel.js";
import { initEquipmentPanel } from "../character/panels/equipmentPanel.js";
import { initAbilitiesPanel } from "../character/panels/abilitiesPanel.js";
import { flipSwapTwo } from "../../ui/flipSwap.js";
import { getActiveCharacter } from "../../domain/characterHelpers.js";
import { ACTIVE_CHARACTER_CHANGED_EVENT } from "../../domain/characterEvents.js";

/** @typedef {import("../../state.js").State} State */
/** @typedef {{ markDirty?: () => void }} SaveManagerLike */
/** @typedef {(message: string, opts?: { stickyMs?: number }) => void} CombatStatusFn */
/** @typedef {{ destroy?: () => void }} Destroyable */

/**
 * @typedef {{ id: string, label: string }} EmbeddedPanelDef
 */

// ─── Panel definitions ───────────────────────────────────────────────────────

/**
 * All supported embedded panel definitions.
 * Order here is also the display order in the picker.
 * @type {readonly EmbeddedPanelDef[]}
 */
export const EMBEDDED_PANEL_DEFS = Object.freeze([
  { id: "vitals",     label: "Vitals" },
  { id: "spells",     label: "Spells" },
  { id: "weapons",    label: "Weapons / Attacks" },
  { id: "equipment",  label: "Equipment" },
  { id: "abilities",  label: "Abilities / Skills" },
]);

export const EMBEDDED_PANEL_HOST_SELECTORS = Object.freeze({
  vitals: Object.freeze({
    panelEl: "#combatEmbeddedVitalsSource",
    wrap: "#combatEmbeddedVitalsTiles",
    addBtn: "#combatEmbeddedAddResourceBtn",
    charHpCur: "#combatEmbeddedCharHpCur",
    charHpMax: "#combatEmbeddedCharHpMax",
    hitDieAmt: "#combatEmbeddedHitDieAmt",
    hitDieSize: "#combatEmbeddedHitDieSize",
    charAC: "#combatEmbeddedCharAC",
    charInit: "#combatEmbeddedCharInit",
    charSpeed: "#combatEmbeddedCharSpeed",
    charProf: "#combatEmbeddedCharProf",
    charSpellAtk: "#combatEmbeddedCharSpellAtk",
    charSpellDC: "#combatEmbeddedCharSpellDC",
    charStatus: "#combatEmbeddedCharStatus"
  }),
  spells: Object.freeze({
    panelEl: "#combatEmbeddedSpellsSource",
    containerEl: "#combatEmbeddedSpellLevels",
    addLevelBtnEl: "#combatEmbeddedAddSpellLevelBtn"
  }),
  weapons: Object.freeze({
    panelEl: "#combatEmbeddedWeaponsSource",
    listEl: "#combatEmbeddedAttackList",
    addBtn: "#combatEmbeddedAddAttackBtn"
  }),
  // Equipment: only the outer panel element has a combat-scoped id.
  // Inner elements (inventoryTabs, moneyGP, etc.) keep their canonical ids and
  // are found via root.querySelector inside the scoped bodyEl.
  equipment: Object.freeze({
    panelEl: "#combatEmbeddedEquipmentSource"
  }),
  // Abilities: outer panel and abilityGrid selector need scoping;
  // save-options internals are found via scope.querySelector inside bodyEl.
  abilities: Object.freeze({
    panel: "#combatEmbeddedAbilitiesSource",
    abilityGrid: "#combatEmbeddedAbilitiesSource .abilityGrid"
  })
});

/** @returns {Set<string>} */
function validPanelIdSet() {
  return new Set(EMBEDDED_PANEL_DEFS.map((d) => d.id));
}

/**
 * Keep workspace.embeddedPanels bounded to the three v1 panels with no duplicates.
 * @param {unknown} panelIds
 * @returns {string[]}
 */
function normalizeEmbeddedPanelIds(panelIds) {
  if (!Array.isArray(panelIds)) return [];
  const validIds = validPanelIdSet();
  const seen = new Set();
  const normalized = [];
  for (const panelId of panelIds) {
    if (typeof panelId !== "string" || !validIds.has(panelId) || seen.has(panelId)) continue;
    seen.add(panelId);
    normalized.push(panelId);
  }
  return normalized;
}

// ─── Selection helpers ───────────────────────────────────────────────────────

/**
 * Returns the panel defs that have NOT yet been added to workspace.embeddedPanels.
 * @param {string[]} activeIds
 * @returns {EmbeddedPanelDef[]}
 */
export function getAvailableEmbeddedPanels(activeIds) {
  const activeSet = new Set(
    Array.isArray(activeIds) ? activeIds.filter((id) => typeof id === "string") : []
  );
  return EMBEDDED_PANEL_DEFS.filter((def) => !activeSet.has(def.id));
}

/**
 * Add a panel id to the embeddedPanels array if not already present and valid.
 * Returns true if added; false if duplicate or unknown.
 * @param {string[]} embeddedPanels
 * @param {string} panelId
 * @returns {boolean}
 */
export function addEmbeddedPanel(embeddedPanels, panelId) {
  if (!validPanelIdSet().has(panelId)) return false;
  if (embeddedPanels.includes(panelId)) return false;
  embeddedPanels.push(panelId);
  return true;
}

/**
 * Remove a panel id from the embeddedPanels array.
 * Returns true if removed; false if not found.
 * @param {string[]} embeddedPanels
 * @param {string} panelId
 * @returns {boolean}
 */
export function removeEmbeddedPanel(embeddedPanels, panelId) {
  const idx = embeddedPanels.indexOf(panelId);
  if (idx === -1) return false;
  embeddedPanels.splice(idx, 1);
  return true;
}

/**
 * Move an active embedded panel within workspace.embeddedPanels.
 * This keeps embedded ordering persisted in the existing workspace state bucket.
 * @param {string[]} embeddedPanels
 * @param {string} panelId
 * @param {-1 | 1} direction
 * @returns {boolean}
 */
export function moveEmbeddedPanel(embeddedPanels, panelId, direction) {
  if (!Array.isArray(embeddedPanels)) return false;
  if (direction !== -1 && direction !== 1) return false;
  const idx = embeddedPanels.indexOf(panelId);
  const nextIdx = idx + direction;
  if (idx === -1 || nextIdx < 0 || nextIdx >= embeddedPanels.length) return false;
  [embeddedPanels[idx], embeddedPanels[nextIdx]] = [embeddedPanels[nextIdx], embeddedPanels[idx]];
  return true;
}

// ─── DOM id helper ───────────────────────────────────────────────────────────

const EMBEDDED_PANEL_DOM_ID_PREFIX = "combatEmbeddedPanel_";

/**
 * Returns the DOM id for an embedded panel section element.
 * @param {string} panelId
 * @returns {string}
 */
export function embeddedPanelDomId(panelId) {
  return EMBEDDED_PANEL_DOM_ID_PREFIX + panelId;
}

// ─── View model helpers ──────────────────────────────────────────────────────

/**
 * @param {unknown} value
 * @returns {Record<string, unknown>}
 */
function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : {};
}

/**
 * Returns a non-empty trimmed string, or null.
 * @param {unknown} value
 * @returns {string | null}
 */
function strOrNull(value) {
  if (value == null) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

/**
 * @typedef {{
 *   hp: string,
 *   hpMax: string,
 *   ac: string | null,
 *   initiative: string | null,
 *   speed: string | null,
 *   proficiency: string | null,
 *   spellAttack: string | null,
 *   spellDC: string | null,
 *   resources: Array<{ name: string, cur: string, max: string }>
 * }} VitalsEmbeddedViewModel
 */

/**
 * Build a read-only view model for the Vitals embedded panel from the active character.
 * Safe against missing or malformed state.
 * @param {unknown} state
 * @returns {VitalsEmbeddedViewModel}
 */
export function getVitalsEmbeddedViewModel(state) {
  const c = objectOrEmpty(getActiveCharacter(/** @type {any} */ (state)));

  const rawResources = Array.isArray(c.resources) ? c.resources : [];
  const resources = rawResources.map((r) => {
    const res = objectOrEmpty(r);
    return {
      name: typeof res.name === "string" ? res.name : "",
      cur: res.cur == null ? "—" : String(res.cur),
      max: res.max == null ? "—" : String(res.max),
    };
  });

  return {
    hp: c.hpCur == null ? "—" : String(c.hpCur),
    hpMax: c.hpMax == null ? "—" : String(c.hpMax),
    ac: strOrNull(c.ac),
    initiative: strOrNull(c.initiative),
    speed: strOrNull(c.speed),
    proficiency: strOrNull(c.proficiency),
    spellAttack: strOrNull(c.spellAttack),
    spellDC: strOrNull(c.spellDC),
    resources,
  };
}

/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   known: boolean,
 *   prepared: boolean,
 *   expended: boolean
 * }} SpellEmbeddedEntry
 */

/**
 * @typedef {{
 *   id: string,
 *   label: string,
 *   hasSlots: boolean,
 *   used: string,
 *   total: string,
 *   collapsed: boolean,
 *   spells: SpellEmbeddedEntry[]
 * }} SpellLevelEmbedded
 */

/**
 * @typedef {{ levels: SpellLevelEmbedded[] }} SpellsEmbeddedViewModel
 */

/**
 * Build a view model for the Spells embedded panel from the active character's spells.
 * Safe against missing or malformed state.
 * @param {unknown} state
 * @returns {SpellsEmbeddedViewModel}
 */
export function getSpellsEmbeddedViewModel(state) {
  const c = objectOrEmpty(getActiveCharacter(/** @type {any} */ (state)));
  const spellsObj = objectOrEmpty(c.spells);
  const rawLevels = Array.isArray(spellsObj.levels) ? spellsObj.levels : [];

  const levels = rawLevels.map((rawLevel) => {
    const lv = objectOrEmpty(rawLevel);
    const rawSpells = Array.isArray(lv.spells) ? lv.spells : [];
    return {
      id: typeof lv.id === "string" ? lv.id : "",
      label: typeof lv.label === "string" ? lv.label : "",
      hasSlots: lv.hasSlots === true,
      used: lv.used == null ? "—" : String(lv.used),
      total: lv.total == null ? "—" : String(lv.total),
      collapsed: lv.collapsed === true,
      spells: rawSpells.map((rawSpell) => {
        const sp = objectOrEmpty(rawSpell);
        return {
          id: typeof sp.id === "string" ? sp.id : "",
          name: typeof sp.name === "string" ? sp.name : "",
          known: sp.known !== false,
          prepared: sp.prepared === true,
          expended: sp.expended === true,
        };
      }),
    };
  });

  return { levels };
}

/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   bonus: string,
 *   damage: string,
 *   range: string,
 *   type: string
 * }} WeaponEmbeddedEntry
 */

/**
 * @typedef {{ attacks: WeaponEmbeddedEntry[] }} WeaponsEmbeddedViewModel
 */

/**
 * Build a view model for the Weapons / Attacks embedded panel from
 * the active character's attacks. Safe against missing or malformed state.
 * @param {unknown} state
 * @returns {WeaponsEmbeddedViewModel}
 */
export function getWeaponsEmbeddedViewModel(state) {
  const c = objectOrEmpty(getActiveCharacter(/** @type {any} */ (state)));
  const rawAttacks = Array.isArray(c.attacks) ? c.attacks : [];

  const attacks = rawAttacks.map((rawAtk) => {
    const atk = objectOrEmpty(rawAtk);
    return {
      id: typeof atk.id === "string" ? atk.id : "",
      name: typeof atk.name === "string" ? atk.name : "",
      bonus: typeof atk.bonus === "string" ? atk.bonus : "",
      damage: typeof atk.damage === "string" ? atk.damage : "",
      range: typeof atk.range === "string" ? atk.range : "",
      type: typeof atk.type === "string" ? atk.type : "",
    };
  });

  return { attacks };
}

// ─── DOM renderers ───────────────────────────────────────────────────────────

/**
 * @param {string} tag
 * @param {string} [className]
 * @param {string} [textContent]
 * @returns {HTMLElement}
 */
function createEl(tag, className, textContent) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (textContent != null) el.textContent = textContent;
  return el;
}

/**
 * Render a scoped Vitals source-panel host into a container.
 * The real Vitals panel initializer binds the controls after this shell exists.
 * @param {HTMLElement} container
 * @returns {void}
 */
export function renderVitalsEmbeddedContent(container) {
  container.replaceChildren();

  const panel = createEl("section", "panel combatEmbeddedSourcePanel combatEmbeddedVitalsHost");
  panel.id = "combatEmbeddedVitalsSource";
  panel.innerHTML = `
    <div class="panelHeader">
      <h2 class="m0">Vitals</h2>
      <button id="combatEmbeddedAddResourceBtn" type="button" class="headerAddBtn" title="Add another resource tracker">+ Resource</button>
    </div>
    <div class="charTiles" id="combatEmbeddedVitalsTiles">
      <div class="charTile" data-vital-key="hp">
        <div class="charTileLabel">HP</div>
        <div class="charHpRow">
          <input id="combatEmbeddedCharHpCur" type="number" placeholder="Cur" />
          <span class="muted">/</span>
          <input id="combatEmbeddedCharHpMax" type="number" placeholder="Max" />
        </div>
      </div>
      <div class="charTile" data-vital-key="hitDie">
        <div class="charTileLabel">Hit Dice</div>
        <div class="charHpRow">
          <input id="combatEmbeddedHitDieAmt" type="number" placeholder="2" />
          <span class="muted">d</span>
          <input id="combatEmbeddedHitDieSize" type="number" placeholder="6" />
        </div>
      </div>
      <div class="charTile" data-vital-key="ac">
        <div class="charTileLabel">Armor Class</div>
        <input id="combatEmbeddedCharAC" type="number" placeholder="AC" />
      </div>
      <div class="charTile" data-vital-key="init">
        <div class="charTileLabel">Initiative</div>
        <input id="combatEmbeddedCharInit" type="number" placeholder="Init" />
      </div>
      <div class="charTile" data-vital-key="speed">
        <div class="charTileLabel">Speed</div>
        <input id="combatEmbeddedCharSpeed" type="number" placeholder="Speed" />
      </div>
      <div class="charTile" data-vital-key="prof">
        <div class="charTileLabel">Proficiency</div>
        <input id="combatEmbeddedCharProf" type="number" placeholder="+X" />
      </div>
      <div class="charTile" data-vital-key="spellAtk">
        <div class="charTileLabel">Spell Attack</div>
        <input id="combatEmbeddedCharSpellAtk" type="number" placeholder="+X" />
      </div>
      <div class="charTile" data-vital-key="spellDC">
        <div class="charTileLabel">Spell DC</div>
        <input id="combatEmbeddedCharSpellDC" type="number" placeholder="DC" />
      </div>
      <div class="charTile charTileWide" data-vital-key="status">
        <div class="charTileLabel">Status Effects</div>
        <input id="combatEmbeddedCharStatus" type="text" placeholder="Poisoned, Charmed…" />
      </div>
    </div>
  `;
  container.appendChild(panel);
}

/**
 * Render a scoped Spells source-panel host into a container.
 * @param {HTMLElement} container
 * @returns {void}
 */
export function renderSpellsEmbeddedContent(container) {
  container.replaceChildren();

  const panel = createEl("section", "panel combatEmbeddedSourcePanel combatEmbeddedSpellsHost");
  panel.id = "combatEmbeddedSpellsSource";
  panel.innerHTML = `
    <div class="row between items-center">
      <h2 class="m0">Spells</h2>
      <button id="combatEmbeddedAddSpellLevelBtn" type="button" class="headerAddBtn" title="Add spell level">+ Level</button>
    </div>
    <div id="combatEmbeddedSpellLevels" class="spellLevels"></div>
    <div class="mutedSmall">Tip: each spell has its own notes box. Use the arrow on a spell to show/hide notes.</div>
  `;
  container.appendChild(panel);
}

/**
 * Render a scoped Weapons / Attacks source-panel host into a container.
 * @param {HTMLElement} container
 * @returns {void}
 */
export function renderWeaponsEmbeddedContent(container) {
  container.replaceChildren();

  const panel = createEl("section", "panel combatEmbeddedSourcePanel combatEmbeddedWeaponsHost");
  panel.id = "combatEmbeddedWeaponsSource";
  panel.innerHTML = `
    <div class="row between items-center">
      <h2 class="m0">Weapons</h2>
      <button id="combatEmbeddedAddAttackBtn" type="button" class="headerAddBtn" title="Add a new weapon">+ Weapon</button>
    </div>
    <div id="combatEmbeddedAttackList" class="attackList"></div>
  `;
  container.appendChild(panel);
}

/**
 * Render a scoped Equipment source-panel host into a container.
 * Inner elements use the same ids as the character page; root-scoped lookups
 * ensure the correct instance is found even when both are in the DOM.
 * @param {HTMLElement} container
 * @returns {void}
 */
export function renderEquipmentEmbeddedContent(container) {
  container.replaceChildren();

  const panel = createEl("section", "panel combatEmbeddedSourcePanel combatEmbeddedEquipmentHost");
  panel.id = "combatEmbeddedEquipmentSource";
  panel.innerHTML = `
    <div class="panelHeader">
      <h2 class="m0">Equipment</h2>
    </div>
    <div class="fieldLabelRow">
      <div class="fieldLabel">Inventory</div>
      <button type="button" class="panelCollapseBtn" data-collapse-target="combatEmbeddedInventory" aria-expanded="true" title="Collapse/Expand">▾</button>
    </div>
    <div id="combatEmbeddedInventory">
      <div class="sessionHeader">
        <div class="fieldLabel">Pockets</div>
        <div class="sessionControls panelControls">
          <button id="addInventoryBtn" class="panelBtn panelBtnSm" type="button" title="Add a new inventory item">+ Pocket</button>
          <button id="renameInventoryBtn" class="panelBtn panelBtnSm" type="button" title="Rename current item">Rename</button>
          <button id="deleteInventoryBtn" class="danger panelBtn panelBtnSm" type="button" title="Delete current item">Delete</button>
          <input id="inventorySearch" class="sessionSearch panelSearch" placeholder="Search inventory..." />
        </div>
      </div>
      <div class="sessionTabsWrap" role="tablist" aria-label="Inventory">
        <div id="inventoryTabs" class="sessionTabs"></div>
      </div>
      <textarea id="inventoryNotesBox" placeholder="Notes for this item..."></textarea>
    </div>
    <div class="moneyRow">
      <div class="moneyTile"><div class="moneyLabel">GP</div><input id="moneyGP" type="number" placeholder="0" /></div>
      <div class="moneyTile"><div class="moneyLabel">SP</div><input id="moneySP" type="number" placeholder="0" /></div>
      <div class="moneyTile"><div class="moneyLabel">CP</div><input id="moneyCP" type="number" placeholder="0" /></div>
      <div class="moneyTile"><div class="moneyLabel">PP</div><input id="moneyPP" type="number" placeholder="0" /></div>
      <div class="moneyTile"><div class="moneyLabel">EP</div><input id="moneyEP" type="number" placeholder="0" /></div>
    </div>
  `;
  container.appendChild(panel);
}

/**
 * Render a scoped Abilities / Skills source-panel host into a container.
 * Save-options internals use the same ids as the character page; they are
 * always looked up via scope.querySelector inside the scoped bodyEl.
 * The abilityGrid elements use classes + data attributes only — no unique ids.
 * @param {HTMLElement} container
 * @returns {void}
 */
export function renderAbilitiesEmbeddedContent(container) {
  container.replaceChildren();

  const panel = createEl("section", "panel combatEmbeddedSourcePanel combatEmbeddedAbilitiesHost");
  panel.id = "combatEmbeddedAbilitiesSource";
  panel.innerHTML = `
    <div class="panelHeader items-center abilitiesHeader">
      <h2 class="m0">Abilities &amp; Skills</h2>
      <div class="saveOptionsDropdown" id="saveOptionsDropdown">
        <button id="saveOptionsBtn" type="button" class="moveBtn" aria-haspopup="true" aria-expanded="false" title="Save options">&#8943;</button>
        <div class="saveOptionsMenu" id="saveOptionsMenu" hidden>
          <div class="saveOptionsTitle">Misc Save Bonus</div>
          <div class="saveOptionsGrid">
            <div class="saveOpt"><div class="saveOptTop"><input id="miscSave_str" type="number" /></div><div class="saveOptLabel">Str Save</div></div>
            <div class="saveOpt"><div class="saveOptTop"><input id="miscSave_dex" type="number" /></div><div class="saveOptLabel">Dex Save</div></div>
            <div class="saveOpt"><div class="saveOptTop"><input id="miscSave_con" type="number" /></div><div class="saveOptLabel">Con Save</div></div>
            <div class="saveOpt"><div class="saveOptTop"><input id="miscSave_int" type="number" /></div><div class="saveOptLabel">Int Save</div></div>
            <div class="saveOpt"><div class="saveOptTop"><input id="miscSave_wis" type="number" /></div><div class="saveOptLabel">Wis Save</div></div>
            <div class="saveOpt"><div class="saveOptTop"><input id="miscSave_cha" type="number" /></div><div class="saveOptLabel">Cha Save</div></div>
          </div>
          <div class="settingsDivider"></div>
          <div class="saveOptionsRow">
            <div class="saveOptionsRowLabel">Ability Mod To All Saves</div>
            <select id="saveModToAllSelect" class="settingsSelect abilitySaves" title="Ability Mod To All Saves">
              <option value="">None</option>
              <option value="str">Str</option>
              <option value="dex">Dex</option>
              <option value="con">Con</option>
              <option value="int">Int</option>
              <option value="wis">Wis</option>
              <option value="cha">Cha</option>
            </select>
          </div>
        </div>
      </div>
    </div>
    <div class="abilityGrid">
      <div class="abilityBlock" data-ability="str">
        <div class="abilityHeader">
          <div class="abilityTitle">Strength</div>
          <div class="abilityStats">
            <input type="number" class="abilityScore" data-stat="score" />
            <div class="abilityStat">Mod <span data-stat="mod">+0</span></div>
            <div class="abilityStat">Save <span data-stat="save">+0</span><input type="checkbox" data-stat="saveProf" /></div>
          </div>
        </div>
        <div class="abilitySkills">
          <div class="skillRow"><input type="checkbox" data-skill-prof="athletics" /><span>Athletics</span><span data-skill-value="athletics">+0</span></div>
        </div>
      </div>
      <div class="abilityBlock" data-ability="dex">
        <div class="abilityHeader">
          <div class="abilityTitle">Dexterity</div>
          <div class="abilityStats">
            <input type="number" class="abilityScore" data-stat="score" />
            <div class="abilityStat">Mod <span data-stat="mod">+0</span></div>
            <div class="abilityStat">Save <span data-stat="save">+0</span><input type="checkbox" data-stat="saveProf" /></div>
          </div>
        </div>
        <div class="abilitySkills">
          <div class="skillRow"><input type="checkbox" data-skill-prof="acrobatics" /><span>Acrobatics</span><span data-skill-value="acrobatics">+0</span></div>
          <div class="skillRow"><input type="checkbox" data-skill-prof="sleight" /><span>Sleight of Hand</span><span data-skill-value="sleight">+0</span></div>
          <div class="skillRow"><input type="checkbox" data-skill-prof="stealth" /><span>Stealth</span><span data-skill-value="stealth">+0</span></div>
        </div>
      </div>
      <div class="abilityBlock" data-ability="con">
        <div class="abilityHeader">
          <div class="abilityTitle">Constitution</div>
          <div class="abilityStats">
            <input type="number" class="abilityScore" data-stat="score" />
            <div class="abilityStat">Mod <span data-stat="mod">+0</span></div>
            <div class="abilityStat">Save <span data-stat="save">+0</span><input type="checkbox" data-stat="saveProf" /></div>
          </div>
        </div>
        <div class="abilitySkills">
          <div class="mutedSmall">No skills use Constitution</div>
        </div>
      </div>
      <div class="abilityBlock" data-ability="int">
        <div class="abilityHeader">
          <div class="abilityTitle">Intelligence</div>
          <div class="abilityStats">
            <input type="number" class="abilityScore" data-stat="score" />
            <div class="abilityStat">Mod <span data-stat="mod">+0</span></div>
            <div class="abilityStat">Save <span data-stat="save">+0</span><input type="checkbox" data-stat="saveProf" /></div>
          </div>
        </div>
        <div class="abilitySkills">
          <div class="skillRow"><input type="checkbox" data-skill-prof="arcana" /><span>Arcana</span><span data-skill-value="arcana">+0</span></div>
          <div class="skillRow"><input type="checkbox" data-skill-prof="history" /><span>History</span><span data-skill-value="history">+0</span></div>
          <div class="skillRow"><input type="checkbox" data-skill-prof="investigation" /><span>Investigation</span><span data-skill-value="investigation">+0</span></div>
          <div class="skillRow"><input type="checkbox" data-skill-prof="nature" /><span>Nature</span><span data-skill-value="nature">+0</span></div>
          <div class="skillRow"><input type="checkbox" data-skill-prof="religion" /><span>Religion</span><span data-skill-value="religion">+0</span></div>
        </div>
      </div>
      <div class="abilityBlock" data-ability="wis">
        <div class="abilityHeader">
          <div class="abilityTitle">Wisdom</div>
          <div class="abilityStats">
            <input type="number" class="abilityScore" data-stat="score" />
            <div class="abilityStat">Mod <span data-stat="mod">+0</span></div>
            <div class="abilityStat">Save <span data-stat="save">+0</span><input type="checkbox" data-stat="saveProf" /></div>
          </div>
        </div>
        <div class="abilitySkills">
          <div class="skillRow"><input type="checkbox" data-skill-prof="animal" /><span>Animal Handling</span><span data-skill-value="animal">+0</span></div>
          <div class="skillRow"><input type="checkbox" data-skill-prof="insight" /><span>Insight</span><span data-skill-value="insight">+0</span></div>
          <div class="skillRow"><input type="checkbox" data-skill-prof="medicine" /><span>Medicine</span><span data-skill-value="medicine">+0</span></div>
          <div class="skillRow"><input type="checkbox" data-skill-prof="perception" /><span>Perception</span><span data-skill-value="perception">+0</span></div>
          <div class="skillRow"><input type="checkbox" data-skill-prof="survival" /><span>Survival</span><span data-skill-value="survival">+0</span></div>
        </div>
      </div>
      <div class="abilityBlock" data-ability="cha">
        <div class="abilityHeader">
          <div class="abilityTitle">Charisma</div>
          <div class="abilityStats">
            <input type="number" class="abilityScore" data-stat="score" />
            <div class="abilityStat">Mod <span data-stat="mod">+0</span></div>
            <div class="abilityStat">Save <span data-stat="save">+0</span><input type="checkbox" data-stat="saveProf" /></div>
          </div>
        </div>
        <div class="abilitySkills">
          <div class="skillRow"><input type="checkbox" data-skill-prof="deception" /><span>Deception</span><span data-skill-value="deception">+0</span></div>
          <div class="skillRow"><input type="checkbox" data-skill-prof="intimidation" /><span>Intimidation</span><span data-skill-value="intimidation">+0</span></div>
          <div class="skillRow"><input type="checkbox" data-skill-prof="performance" /><span>Performance</span><span data-skill-value="performance">+0</span></div>
          <div class="skillRow"><input type="checkbox" data-skill-prof="persuasion" /><span>Persuasion</span><span data-skill-value="persuasion">+0</span></div>
        </div>
      </div>
    </div>
  `;
  container.appendChild(panel);
}

// ─── Panel section DOM builder ───────────────────────────────────────────────

/**
 * Build an embedded panel host element.
 * @param {EmbeddedPanelDef} def
 * @returns {HTMLElement}
 */
function buildEmbeddedPanelSection(def) {
  const section = document.createElement("section");
  section.className = "combatEmbeddedPanel";
  section.id = embeddedPanelDomId(def.id);
  section.dataset.embeddedPanelId = def.id;
  section.setAttribute("aria-label", def.label);

  const body = createEl("div", "combatEmbeddedPanelBody");
  body.dataset.embeddedPanelBody = def.id;
  section.appendChild(body);

  return section;
}

/**
 * @param {HTMLElement} sourcePanelEl
 * @returns {HTMLElement | null}
 */
function findEmbeddedSourcePanelHeader(sourcePanelEl) {
  const explicit = sourcePanelEl.querySelector(":scope > [data-panel-header]");
  if (explicit instanceof HTMLElement) return explicit;

  const first = sourcePanelEl.firstElementChild;
  if (first instanceof HTMLElement && first.querySelector("h2")) return first;
  return null;
}

/**
 * @param {EmbeddedPanelDef} def
 * @param {number} index
 * @param {number} total
 * @returns {HTMLElement}
 */
function buildEmbeddedPanelControls(def, index, total) {
  const controls = createEl("div", "panelControls combatEmbeddedPanelControls");
  controls.dataset.embeddedPanelControls = def.id;

  const movesWrap = createEl("div", "sectionMoves combatEmbeddedMoves");
  movesWrap.dataset.embeddedPanelMoves = def.id;

  const moveUpBtn = document.createElement("button");
  moveUpBtn.type = "button";
  moveUpBtn.className = "moveBtn";
  moveUpBtn.dataset.moveEmbeddedPanel = "-1";
  moveUpBtn.textContent = "↑";
  moveUpBtn.title = "Move panel up";
  moveUpBtn.disabled = index <= 0;
  moveUpBtn.setAttribute("aria-label", `Move ${def.label} panel up`);
  movesWrap.appendChild(moveUpBtn);

  const moveDownBtn = document.createElement("button");
  moveDownBtn.type = "button";
  moveDownBtn.className = "moveBtn";
  moveDownBtn.dataset.moveEmbeddedPanel = "1";
  moveDownBtn.textContent = "↓";
  moveDownBtn.title = "Move panel down";
  moveDownBtn.disabled = index >= total - 1;
  moveDownBtn.setAttribute("aria-label", `Move ${def.label} panel down`);
  movesWrap.appendChild(moveDownBtn);

  controls.appendChild(movesWrap);

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "panelBtn panelBtnSm danger combatEmbeddedRemoveBtn";
  removeBtn.dataset.removeEmbeddedPanel = def.id;
  removeBtn.textContent = "Remove";
  removeBtn.setAttribute("aria-label", `Remove ${def.label} panel`);
  controls.appendChild(removeBtn);

  return controls;
}

/**
 * Move source panel header actions into a standard panelControls group, then add
 * Combat's reorder/remove controls alongside them.
 * @param {HTMLElement} section
 * @param {EmbeddedPanelDef} def
 * @param {number} index
 * @param {number} total
 * @param {boolean} collapsed
 * @returns {void}
 */
function installEmbeddedPanelHeaderControls(section, def, index, total, collapsed) {
  const sourcePanelEl = section.querySelector(":scope > [data-embedded-panel-body] > section.panel");
  if (!(sourcePanelEl instanceof HTMLElement)) return;

  const headerEl = findEmbeddedSourcePanelHeader(sourcePanelEl);
  if (!(headerEl instanceof HTMLElement)) return;

  headerEl.setAttribute("data-panel-header", "");
  headerEl.dataset.combatEmbeddedPanelHeader = def.id;
  headerEl.classList.add("panelHeaderClickable");

  sourcePanelEl.dataset.collapsed = collapsed ? "true" : "false";
  sourcePanelEl.setAttribute("aria-expanded", collapsed ? "false" : "true");

  headerEl.querySelector("[data-embedded-panel-controls]")?.remove();

  const controls = buildEmbeddedPanelControls(def, index, total);
  const sourceActions = Array.from(headerEl.children).filter((child) => (
    child instanceof HTMLElement
    && !child.matches("h1, h2, h3, h4, h5, h6")
    && child !== controls
  ));
  const embeddedMoves = controls.querySelector("[data-embedded-panel-moves]");
  sourceActions.forEach((child) => controls.insertBefore(child, embeddedMoves));
  headerEl.appendChild(controls);
}

// ─── Panel picker DOM builder ────────────────────────────────────────────────

/**
 * Build the panel picker row showing buttons for all currently-available panels.
 * @param {EmbeddedPanelDef[]} available
 * @returns {HTMLElement}
 */
function buildPanelPickerRow(available) {
  const row = createEl("div", "combatPanelPicker");
  row.id = "combatPanelPickerRow";

  if (!available.length) {
    row.appendChild(createEl("span", "mutedSmall", "All panels added."));
    return row;
  }

  row.appendChild(createEl("span", "combatPanelPickerLabel", "Add panel:"));

  for (const def of available) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "panelBtn panelBtnSm";
    btn.dataset.addEmbeddedPanel = def.id;
    btn.textContent = `+ ${def.label}`;
    btn.setAttribute("aria-label", `Add ${def.label} panel`);
    row.appendChild(btn);
  }

  return row;
}

// ─── Main initializer ────────────────────────────────────────────────────────

/**
 * Initialize the embedded panels area for the Combat Workspace.
 *
 * Renders a panel picker and one reorderable source-panel host per active panel.
 * Panel additions, removals, and order are persisted via
 * combat.workspace.embeddedPanels.
 *
 * @param {{
 *   state: State,
 *   SaveManager: SaveManagerLike,
 *   setStatus?: CombatStatusFn,
 *   root: HTMLElement,
 *   uiConfirm?: Function,
 *   uiPrompt?: Function,
 *   Popovers?: unknown,
 *   textKey_spellNotes?: Function,
 *   putText?: Function,
 *   getText?: Function,
 *   deleteText?: Function,
 *   autoSizeInput?: Function,
 *   enhanceNumberSteppers?: Function,
 *   applyTextareaSize?: Function
 * }} deps
 * @returns {{ destroy: () => void }}
 */
export function initCombatEmbeddedPanels({
  state,
  SaveManager,
  root,
  setStatus,
  uiConfirm,
  uiPrompt,
  Popovers,
  textKey_spellNotes,
  putText,
  getText,
  deleteText,
  autoSizeInput,
  enhanceNumberSteppers,
  applyTextareaSize
}) {
  const containerEl = root.querySelector("#combatEmbeddedPanels");
  if (!(containerEl instanceof HTMLElement)) {
    // Container not present in DOM — degrade gracefully.
    return { destroy() {} };
  }

  let destroyed = false;
  const ac = new AbortController();
  const { signal } = ac;
  /** @type {Map<string, Destroyable>} */
  const panelApis = new Map();

  /**
   * @param {string} panelId
   * @returns {void}
   */
  function destroyPanelApi(panelId) {
    const api = panelApis.get(panelId);
    try { api?.destroy?.(); } catch (err) { console.warn("Embedded panel destroy failed:", err); }
    panelApis.delete(panelId);
  }

  /**
   * @returns {void}
   */
  function destroyAllPanelApis() {
    for (const panelId of Array.from(panelApis.keys())) destroyPanelApi(panelId);
  }

  /**
   * Get or repair the workspace sub-object from state.
   * @returns {{ embeddedPanels: string[], panelCollapsed: Record<string, boolean> }}
   */
  function getWorkspace() {
    const combat = /** @type {Record<string, unknown>} */ (state.combat || {});
    let workspace = /** @type {Record<string, unknown>} */ (combat.workspace || {});
    if (!workspace || typeof workspace !== "object" || Array.isArray(workspace)) {
      workspace = {};
      combat.workspace = workspace;
    }
    workspace.embeddedPanels = normalizeEmbeddedPanelIds(workspace.embeddedPanels);
    if (!workspace.panelCollapsed || typeof workspace.panelCollapsed !== "object" || Array.isArray(workspace.panelCollapsed)) {
      workspace.panelCollapsed = {};
    }
    return /** @type {any} */ (workspace);
  }

  /**
   * Re-render the content body of a single embedded panel.
   * Hosted panels resolve fresh active character data each time they render.
   * @param {EmbeddedPanelDef} def
   * @param {number} index
   * @param {number} total
   * @returns {void}
   */
  function renderPanelContent(def, index, total) {
    const panelId = def.id;
    const bodyEl = containerEl.querySelector(`[data-embedded-panel-body="${panelId}"]`);
    if (!(bodyEl instanceof HTMLElement)) return;

    destroyPanelApi(panelId);

    /** @type {Destroyable | null} */
    let api = null;
    if (panelId === "vitals") {
      renderVitalsEmbeddedContent(bodyEl);
      api = initVitalsPanel({
        state,
        SaveManager,
        root: bodyEl,
        selectors: EMBEDDED_PANEL_HOST_SELECTORS.vitals,
        autoSizeInput,
        enhanceNumberSteppers,
        uiConfirm,
        setStatus
      });
    } else if (panelId === "spells") {
      renderSpellsEmbeddedContent(bodyEl);
      api = initSpellsPanel({
        state,
        SaveManager,
        root: bodyEl,
        selectors: EMBEDDED_PANEL_HOST_SELECTORS.spells,
        noteTextareaIdPrefix: "combatEmbeddedSpellNotes_",
        textKey_spellNotes,
        putText,
        getText,
        deleteText,
        uiConfirm,
        uiPrompt,
        setStatus,
        enhanceNumberSteppers,
        applyTextareaSize
      });
    } else if (panelId === "weapons") {
      renderWeaponsEmbeddedContent(bodyEl);
      api = initAttacksPanel({
        state,
        SaveManager,
        root: bodyEl,
        selectors: EMBEDDED_PANEL_HOST_SELECTORS.weapons,
        uiConfirm,
        autoSizeInput,
        setStatus
      });
    } else if (panelId === "equipment") {
      renderEquipmentEmbeddedContent(bodyEl);
      api = initEquipmentPanel({
        state,
        SaveManager,
        root: bodyEl,
        selectors: EMBEDDED_PANEL_HOST_SELECTORS.equipment,
        uiConfirm,
        uiPrompt,
        autoSizeInput,
        setStatus
      });
      // Wire the inner Inventory collapse button (mirrors character-page panelCollapseBtn behavior).
      const inventoryCollapseBtn = bodyEl.querySelector("[data-collapse-target='combatEmbeddedInventory']");
      const inventorySection = bodyEl.querySelector("#combatEmbeddedInventory");
      if (inventoryCollapseBtn instanceof HTMLButtonElement && inventorySection instanceof HTMLElement) {
        inventoryCollapseBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const nowCollapsed = !inventorySection.hidden;
          inventorySection.hidden = nowCollapsed;
          inventoryCollapseBtn.textContent = nowCollapsed ? "▸" : "▾";
          inventoryCollapseBtn.setAttribute("aria-expanded", String(!nowCollapsed));
        }, { signal });
      }
    } else if (panelId === "abilities") {
      renderAbilitiesEmbeddedContent(bodyEl);
      api = initAbilitiesPanel({
        state,
        SaveManager: /** @type {any} */ (SaveManager),
        Popovers: /** @type {any} */ (Popovers),
        root: bodyEl,
        selectors: EMBEDDED_PANEL_HOST_SELECTORS.abilities,
        setStatus
      });
    }

    const workspace = getWorkspace();
    const sectionEl = bodyEl.closest("[data-embedded-panel-id]");
    installEmbeddedPanelHeaderControls(
      sectionEl instanceof HTMLElement ? sectionEl : bodyEl,
      def,
      index,
      total,
      workspace.panelCollapsed?.[embeddedPanelDomId(panelId)] === true
    );

    if (api && typeof api === "object") panelApis.set(panelId, api);
  }

  /**
   * Keep host move buttons accurate after a DOM swap that avoids a full render.
   * @returns {void}
   */
  function syncEmbeddedPanelMoveButtons() {
    const sections = Array.from(containerEl.querySelectorAll("[data-embedded-panel-id]"))
      .filter((el) => el instanceof HTMLElement);
    const last = sections.length - 1;
    sections.forEach((section, index) => {
      const up = section.querySelector("[data-move-embedded-panel='-1']");
      const down = section.querySelector("[data-move-embedded-panel='1']");
      if (up instanceof HTMLButtonElement) up.disabled = index <= 0;
      if (down instanceof HTMLButtonElement) down.disabled = index >= last;
    });
  }

  /**
   * @param {string} panelId
   * @param {-1 | 1} direction
   * @param {HTMLButtonElement | null} fallbackBtn
   * @returns {void}
   */
  function focusEmbeddedMoveButton(panelId, direction, fallbackBtn = null) {
    requestAnimationFrame(() => {
      if (destroyed) return;
      const section = containerEl.querySelector(`[data-embedded-panel-id="${panelId}"]`);
      const target = section?.querySelector(`[data-move-embedded-panel="${direction}"]`) || fallbackBtn;
      if (!(target instanceof HTMLElement)) return;
      try { target.focus({ preventScroll: true }); } catch { target.focus(); }
    });
  }

  /**
   * Full re-render: rebuild the picker and all active embedded panel sections.
   * @returns {void}
   */
  function render() {
    if (destroyed) return;

    const workspace = getWorkspace();
    const activePanelIds = /** @type {string[]} */ (workspace.embeddedPanels);
    const available = getAvailableEmbeddedPanels(activePanelIds);

    destroyAllPanelApis();
    containerEl.replaceChildren();

    // Panel picker
    containerEl.appendChild(buildPanelPickerRow(available));

    // One source-panel host per active panel
    activePanelIds.forEach((panelId, index) => {
      const def = EMBEDDED_PANEL_DEFS.find((d) => d.id === panelId);
      if (!def) return; // unknown id — skip defensively

      const section = buildEmbeddedPanelSection(def);
      containerEl.appendChild(section);
      renderPanelContent(def, index, activePanelIds.length);
    });
  }

  /**
   * Rebind currently visible hosted Character panels after state.characters.activeId
   * changes. The hosted panel modules still resolve data from getActiveCharacter(state).
   * @returns {void}
   */
  function refreshVisibleHostedPanels() {
    if (destroyed) return;
    const workspace = getWorkspace();
    const activePanelIds = /** @type {string[]} */ (workspace.embeddedPanels);
    const needsFullRender = activePanelIds.some((panelId) => {
      const def = EMBEDDED_PANEL_DEFS.find((d) => d.id === panelId);
      const bodyEl = containerEl.querySelector(`[data-embedded-panel-body="${panelId}"]`);
      return !def || !(bodyEl instanceof HTMLElement);
    });
    if (needsFullRender) {
      render();
      return;
    }
    activePanelIds.forEach((panelId, index) => {
      const def = EMBEDDED_PANEL_DEFS.find((d) => d.id === panelId);
      if (!def) return;
      renderPanelContent(def, index, activePanelIds.length);
    });
  }

  // ─── Event handling ─────────────────────────────────────────────────────

  containerEl.addEventListener("click", (event) => {
    if (destroyed) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    // Add panel button
    const addBtn = target.closest("[data-add-embedded-panel]");
    if (addBtn instanceof HTMLElement && addBtn.dataset.addEmbeddedPanel) {
      const workspace = getWorkspace();
      const added = addEmbeddedPanel(
        /** @type {string[]} */ (workspace.embeddedPanels),
        addBtn.dataset.addEmbeddedPanel
      );
      if (added) {
        SaveManager.markDirty?.();
        render();
      }
      return;
    }

    // Reorder embedded panels within workspace.embeddedPanels.
    const moveBtn = target.closest("[data-move-embedded-panel]");
    if (moveBtn instanceof HTMLButtonElement && moveBtn.dataset.moveEmbeddedPanel) {
      const sectionEl = moveBtn.closest("[data-embedded-panel-id]");
      if (!(sectionEl instanceof HTMLElement)) return;
      const panelId = sectionEl.dataset.embeddedPanelId;
      const direction = Number(moveBtn.dataset.moveEmbeddedPanel) < 0 ? -1 : 1;
      const workspace = getWorkspace();
      const activePanelIds = /** @type {string[]} */ (workspace.embeddedPanels);
      const fromIndex = activePanelIds.indexOf(panelId || "");
      const adjacentId = activePanelIds[fromIndex + direction] || "";
      const adjacentEl = adjacentId
        ? containerEl.querySelector(`[data-embedded-panel-id="${adjacentId}"]`)
        : null;
      const moved = moveEmbeddedPanel(
        activePanelIds,
        panelId || "",
        /** @type {-1 | 1} */ (direction)
      );
      if (moved) {
        SaveManager.markDirty?.();
        const canAnimate = sectionEl.parentElement === containerEl
          && adjacentEl instanceof HTMLElement
          && adjacentEl.parentElement === containerEl;
        if (!canAnimate) {
          render();
          return;
        }

        const didSwap = flipSwapTwo(sectionEl, adjacentEl, {
          durationMs: 260,
          easing: "cubic-bezier(.22,1,.36,1)",
          swap: () => {
            if (direction < 0) containerEl.insertBefore(sectionEl, adjacentEl);
            else containerEl.insertBefore(adjacentEl, sectionEl);
          },
          afterSwap: syncEmbeddedPanelMoveButtons
        });

        if (!didSwap) {
          render();
          return;
        }
        syncEmbeddedPanelMoveButtons();
        focusEmbeddedMoveButton(panelId || "", /** @type {-1 | 1} */ (direction), moveBtn);
      }
      return;
    }

    // Remove panel button
    const removeBtn = target.closest("[data-remove-embedded-panel]");
    if (removeBtn instanceof HTMLElement && removeBtn.dataset.removeEmbeddedPanel) {
      const workspace = getWorkspace();
      const removed = removeEmbeddedPanel(
        /** @type {string[]} */ (workspace.embeddedPanels),
        removeBtn.dataset.removeEmbeddedPanel
      );
      if (removed) {
        SaveManager.markDirty?.();
        render();
      }
      return;
    }

    const headerEl = target.closest("[data-combat-embedded-panel-header]");
    if (headerEl instanceof HTMLElement && headerEl.dataset.combatEmbeddedPanelHeader) {
      if (target.closest("button, input, select, textarea, a, label, summary, [role='button'], [role='link']")) {
        return;
      }
      const sourcePanelEl = headerEl.closest("section.panel");
      if (!(sourcePanelEl instanceof HTMLElement)) return;

      const panelId = headerEl.dataset.combatEmbeddedPanelHeader;
      const collapsedKey = embeddedPanelDomId(panelId);
      const workspace = getWorkspace();
      const next = workspace.panelCollapsed?.[collapsedKey] !== true;
      workspace.panelCollapsed = {
        ...(workspace.panelCollapsed || {}),
        [collapsedKey]: next
      };
      sourcePanelEl.dataset.collapsed = next ? "true" : "false";
      sourcePanelEl.setAttribute("aria-expanded", next ? "false" : "true");
      SaveManager.markDirty?.();
      return;
    }

  }, { signal });

  // Combat encounter changes should not create a second sync layer for hosted
  // Character panels. This only repairs a visible host if its DOM was removed.
  window.addEventListener(COMBAT_ENCOUNTER_CHANGED_EVENT, () => {
    if (destroyed) return;
    const workspace = getWorkspace();
    const activePanelIds = /** @type {string[]} */ (workspace.embeddedPanels);
    for (const panelId of activePanelIds) {
      const bodyEl = containerEl.querySelector(`[data-embedded-panel-body="${panelId}"]`);
      if (
        bodyEl instanceof HTMLElement
        && !panelApis.has(panelId)
      ) {
        const def = EMBEDDED_PANEL_DEFS.find((d) => d.id === panelId);
        const index = activePanelIds.indexOf(panelId);
        if (def) renderPanelContent(def, index, activePanelIds.length);
      }
    }
  }, { signal });

  window.addEventListener(ACTIVE_CHARACTER_CHANGED_EVENT, refreshVisibleHostedPanels, { signal });

  render();

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      ac.abort();
      destroyAllPanelApis();
      containerEl.replaceChildren();
    }
  };
}
