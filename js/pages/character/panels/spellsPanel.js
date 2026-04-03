import { safeAsync } from "../../../ui/safeAsync.js";
import { requireMany } from "../../../utils/domGuards.js";

let _state = null;

function notifyStatus(setStatus, message) {
    if (typeof setStatus === "function") {
        setStatus(message);
        return;
    }
    console.warn(message);
}


export function initSpellsPanel(deps = {}) {
    const {
        state,
        SaveManager,

        // Spells notes storage
        textKey_spellNotes,
        putText,
        getText,
        deleteText,

        // Common UI helpers
        autoSizeInput,
        enhanceNumberSteppers,
        uiAlert,
        uiConfirm,
        uiPrompt,
        setStatus,
        applyTextareaSize
    } = deps;
    _state = state;

    if (!_state) throw new Error("initSpellsPanel requires state");
    if (!SaveManager) throw new Error("initSpellsPanel requires SaveManager");
    const required = {
        panelEl: "#charSpellsPanel",
        containerEl: "#spellLevels",
        addLevelBtnEl: "#addSpellLevelBtn"
    };
    const guard = requireMany(required, { root: document, setStatus, context: "Spells panel" });
    if (!guard.ok) return guard.destroy;
    const { containerEl, addLevelBtnEl } = guard.els;

    // ---------- Spells v2 UI (dynamic levels + spells) ----------
    const _spellNotesCache = new Map(); // spellId -> text
    const _spellNotesSaveTimers = new Map(); // spellId -> timeoutId

    function newTextId(prefix = "id") {
        return `${prefix}_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
    }

    function ensureSpellsV2Shape() {
        if (!_state.character.spells || typeof _state.character.spells !== "object") {
            _state.character.spells = { levels: [] };
        }
        if (!Array.isArray(_state.character.spells.levels)) _state.character.spells.levels = [];
    }

    function newSpellLevel(label, hasSlots = true) {
        return { id: newTextId('spellLevel'), label: label || 'New Level', hasSlots: !!hasSlots, used: null, total: null, collapsed: false, spells: [] };
    }

    // Spell factory (Spells v2).
    // Keep this local so the UI can always create a valid spell object,
    // even if shared helper names change.
    function newSpell(name = '') {
        return {
            id: newTextId('spell'),
            name: name || '',
            notesCollapsed: true,
            known: true,
            prepared: false,
            expended: false
        };
    }

    function setupSpellsV2() {
        const container = containerEl;
        const addLevelBtn = addLevelBtnEl;

        ensureSpellsV2Shape();
        if (!_state.character.spells.levels.length) {
            _state.character.spells.levels = [
                newSpellLevel('Cantrips', false),
                newSpellLevel('1st Level', true),
                newSpellLevel('2nd Level', true),
                newSpellLevel('3rd Level', true)
            ];
        }

        const scheduleSpellNotesSave = (spellId, text) => {
            _spellNotesCache.set(spellId, text);
            const prev = _spellNotesSaveTimers.get(spellId);
            if (prev) clearTimeout(prev);
            const t = setTimeout(() => {
                putText(_spellNotesCache.get(spellId) || '', textKey_spellNotes(spellId)).catch(err => console.warn("Failed to save spell notes:", err));
            }, 250);
            _spellNotesSaveTimers.set(spellId, t);
        };

        addLevelBtn.addEventListener(
            'click',
            safeAsync(async () => {
                const suggested = (() => {
                    // Find the highest numbered "<n>th Level" and suggest the next one.
                    const levels = (_state.character?.spells?.levels || []).map(l => String(l.label || ""));
                    let max = 0;
                    for (const lab of levels) {
                        const m = lab.match(/\b(\d+)\s*(st|nd|rd|th)?\s*level\b/i);
                        if (!m) continue;
                        const n = Number(m[1]);
                        if (Number.isFinite(n) && n > max) max = n;
                    }
                    const next = Math.max(1, max + 1);
                    const ordinal = (n) => {
                        const s = ["th", "st", "nd", "rd"];
                        const v = n % 100;
                        return n + (s[(v - 20) % 10] || s[v] || s[0]);
                    };
                    return `${ordinal(next)} Level`;
                })();

                const label = ((await uiPrompt('New spell level name:', { defaultValue: suggested, title: 'New Spell Level' })) || '').trim();
                if (!label) return;
                const isCantrip = label.toLowerCase().includes('cantrip');
                _state.character.spells.levels.push(newSpellLevel(label, !isCantrip));
                SaveManager.markDirty();
                render();
            }, (err) => {
                console.error(err);
                notifyStatus(setStatus, "Add spell level failed.");
            })
        );

        async function ensureSpellNotesLoaded(spellId) {
            if (_spellNotesCache.has(spellId)) return;
            const txt = await getText(textKey_spellNotes(spellId));
            _spellNotesCache.set(spellId, txt || '');
        }

        function render() {
            container.innerHTML = '';
            const levels = _state.character.spells.levels;
            if (!levels.length) {
                const empty = document.createElement('div');
                empty.className = 'mutedSmall';
                empty.textContent = 'No spell levels yet. Click + Level.';
                container.appendChild(empty);
                return;
            }
            levels.forEach((lvl, i) => container.appendChild(renderLevel(lvl, i)));
            enhanceNumberSteppers(container);
        }

        function renderLevel(level, levelIndex) {
            if (!Array.isArray(level.spells)) level.spells = [];

            const card = document.createElement('div');
            card.className = 'spellLevel';

            const header = document.createElement('div');
            header.className = 'spellLevelHeader';

            const left = document.createElement('div');
            left.className = 'spellLevelLeft';

            const collapseBtn = document.createElement('button');
            collapseBtn.type = 'button';
            collapseBtn.className = 'spellCollapseBtn';
            collapseBtn.title = level.collapsed ? 'Expand level' : 'Collapse level';
            collapseBtn.textContent = level.collapsed ? '▸' : '▾';
            collapseBtn.setAttribute(
                'aria-expanded',
                level.collapsed ? 'false' : 'true'
            );
            collapseBtn.addEventListener('click', (e) => {
                e.preventDefault();
                level.collapsed = !level.collapsed;
                collapseBtn.setAttribute(
                    'aria-expanded',
                    level.collapsed ? 'false' : 'true'
                );
                SaveManager.markDirty();
                render();
            });

            const titleWrap = document.createElement('div');
            titleWrap.className = 'spellLevelTitle';
            const titleInput = document.createElement('input');
            titleInput.value = level.label || '';
            titleInput.placeholder = 'Level name';
            titleInput.addEventListener('input', () => {
                level.label = titleInput.value;
                SaveManager.markDirty();
            });
            titleWrap.appendChild(titleInput);

            left.appendChild(collapseBtn);
            left.appendChild(titleWrap);

            const right = document.createElement('div');
            right.className = 'spellLevelRight';

            if (level.hasSlots) {
                const slots = document.createElement('div');
                slots.className = 'spellSlots';
                const used = document.createElement('input');
                used.classList.add("num-sum");
                used.type = 'number';
                used.placeholder = 'Used';
                used.value = (level.used ?? '');
                used.addEventListener('input', () => {
                    level.used = used.value === '' ? null : Number(used.value); SaveManager.markDirty();
                });
                const sep = document.createElement('span');
                sep.className = 'muted';
                sep.textContent = '/';
                const total = document.createElement('input');
                total.classList.add("num-sum");
                total.type = 'number';
                total.placeholder = 'Total';
                total.value = (level.total ?? '');
                total.addEventListener('input', () => {
                    level.total = total.value === '' ? null : Number(total.value); SaveManager.markDirty();
                });
                slots.appendChild(used); slots.appendChild(sep); slots.appendChild(total);
                right.appendChild(slots);
            }

            const actions = document.createElement('div');
            actions.className = 'spellLevelActions';

            const addSpellBtn = document.createElement('button');
            addSpellBtn.type = 'button';
            addSpellBtn.textContent = '+ Spell';
            addSpellBtn.addEventListener('click', () => {
                // Defensive: ensure the spells array exists before pushing.
                if (!Array.isArray(level.spells)) level.spells = [];
                level.spells.push(newSpell(''));
                SaveManager.markDirty();
                render();
            });

            const resetExpBtn = document.createElement('button');
            resetExpBtn.type = 'button';
            resetExpBtn.textContent = 'Reset Cast';
            resetExpBtn.title = 'Clear expended/cast flags for this level';
            resetExpBtn.addEventListener('click', () => {
                level.spells.forEach(sp => sp.expended = false);
                SaveManager.markDirty();
                render();
            });

            const deleteLevelBtn = document.createElement('button');
            deleteLevelBtn.type = 'button';
            deleteLevelBtn.className = 'danger';
            deleteLevelBtn.textContent = 'X';
            deleteLevelBtn.addEventListener(
                'click',
                safeAsync(async () => {
                    if (!(await uiConfirm(`Delete level "${level.label || 'this level'}" and all its spells?`, { title: 'Delete Spell Level', okText: 'Delete' }))) return;
                    // delete associated notes
                    for (const sp of level.spells) {
                        _spellNotesCache.delete(sp.id);
                        await deleteText(textKey_spellNotes(sp.id));
                    }
                    _state.character.spells.levels.splice(levelIndex, 1);
                    SaveManager.markDirty();
                    render();
                }, (err) => {
                    console.error(err);
                    notifyStatus(setStatus, "Delete spell level failed.");
                })
            );

            actions.appendChild(addSpellBtn);
            actions.appendChild(resetExpBtn);
            actions.appendChild(deleteLevelBtn);
            right.appendChild(actions);

            header.appendChild(left);
            header.appendChild(right);
            card.appendChild(header);

            if (!level.collapsed) {
                const body = document.createElement('div');
                body.className = 'spellBody';

                if (!level.spells.length) {
                    const empty = document.createElement('div');
                    empty.className = 'mutedSmall';
                    empty.textContent = 'No spells yet. Click + Spell.';
                    body.appendChild(empty);
                } else {
                    level.spells.forEach((spell, spellIndex) => body.appendChild(renderSpell(level, spell, levelIndex, spellIndex)));
                }

                card.appendChild(body);
            }

            return card;
        }

        function renderSpell(level, spell, levelIndex, spellIndex) {
            const row = document.createElement('div');
            row.className = 'spellRow';

            const top = document.createElement('div');
            top.className = 'spellRowTop';

            const collapseBtn = document.createElement('button');
            collapseBtn.type = 'button';
            collapseBtn.className = 'spellSpellCollapseBtn';
            collapseBtn.title = spell.notesCollapsed ? 'Show notes' : 'Hide notes';
            collapseBtn.textContent = spell.notesCollapsed ? '▸' : '▾';
            collapseBtn.setAttribute(
                'aria-expanded',
                spell.notesCollapsed ? 'false' : 'true'
            );
            collapseBtn.addEventListener(
                'click',
                safeAsync(async () => {
                    spell.notesCollapsed = !spell.notesCollapsed;
                    if (!spell.notesCollapsed) {
                        await ensureSpellNotesLoaded(spell.id);
                    }
                    collapseBtn.setAttribute(
                        'aria-expanded',
                        spell.notesCollapsed ? 'false' : 'true'
                    );
                    SaveManager.markDirty();
                    render();
                }, (err) => {
                    console.error(err);
                    notifyStatus(setStatus, "Toggle spell notes failed.");
                })
            );

            const name = document.createElement('input');
            name.className = 'spellName';
            name.placeholder = 'Spell name';
            name.value = spell.name || '';
            name.addEventListener('input', () => {
                spell.name = name.value; SaveManager.markDirty();
            });

            const toggles = document.createElement('div');
            toggles.className = 'spellToggles';

            const mkToggle = (label, key, extraClass = '') => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = `spellToggle ${extraClass}`.trim();
                b.textContent = label;

                const refresh = () => {
                    const isOn = !!spell[key];
                    b.classList.toggle('on', isOn);
                    b.setAttribute('aria-pressed', isOn ? 'true' : 'false');
                };

                refresh();

                b.addEventListener('click', () => {
                    spell[key] = !spell[key];
                    refresh();
                    SaveManager.markDirty();
                });

                return b;
            };

            toggles.appendChild(mkToggle('Known', 'known'));
            toggles.appendChild(mkToggle('Prepared', 'prepared'));
            toggles.appendChild(mkToggle('Cast', 'expended', 'warn'));

            const mini = document.createElement('div');
            mini.className = 'spellMiniBtns';

            const up = document.createElement('button');
            up.type = 'button';
            up.className = 'moveBtn';
            up.title = 'Move up';
            up.textContent = '↑';
            up.disabled = spellIndex === 0;
            up.addEventListener('click', () => {
                if (spellIndex === 0) return;
                const arr = level.spells;
                arr.splice(spellIndex - 1, 0, arr.splice(spellIndex, 1)[0]);
                SaveManager.markDirty();
                render();
            });

            const down = document.createElement('button');
            down.type = 'button';
            down.className = 'moveBtn';
            down.title = 'Move down';
            down.textContent = '↓';
            down.disabled = spellIndex === level.spells.length - 1;
            down.addEventListener('click', () => {
                if (spellIndex >= level.spells.length - 1) return;
                const arr = level.spells;
                arr.splice(spellIndex + 1, 0, arr.splice(spellIndex, 1)[0]);
                SaveManager.markDirty();
                render();
            });

            const del = document.createElement('button');
            del.type = 'button';
            del.className = 'danger';
            del.textContent = 'X';
            del.addEventListener(
                'click',
                safeAsync(async () => {
                    if (!(await uiConfirm(`Delete spell "${spell.name || 'this spell'}"?`, { title: 'Delete Spell', okText: 'Delete' }))) return;
                    level.spells.splice(spellIndex, 1);
                    _spellNotesCache.delete(spell.id);
                    await deleteText(textKey_spellNotes(spell.id));
                    SaveManager.markDirty();
                    render();
                }, (err) => {
                    console.error(err);
                    notifyStatus(setStatus, "Delete spell failed.");
                })
            );

            mini.appendChild(up);
            mini.appendChild(down);
            mini.appendChild(del);

            top.appendChild(collapseBtn);
            top.appendChild(name);
            top.appendChild(toggles);
            top.appendChild(mini);
            row.appendChild(top);

            if (!spell.notesCollapsed) {
                const notesWrap = document.createElement('div');
                notesWrap.className = 'spellNotes';
                const ta = document.createElement('textarea');
                // Stable id so we can persist the resized height even when the spell collapses/expands
                ta.id = `spellNotes_${spell.id}`;
                ta.setAttribute('data-persist-size', '');
                ta.placeholder = 'Spell notes / description...';
                // Load cached value if present; otherwise empty until async load finishes
                ta.value = _spellNotesCache.get(spell.id) ?? '';
                ta.addEventListener('input', () => {
                    scheduleSpellNotesSave(spell.id, ta.value);
                });
                // Ensure loaded
                if (!_spellNotesCache.has(spell.id)) {
                    ta.placeholder = 'Loading...';
                    ensureSpellNotesLoaded(spell.id).then(() => {
                        ta.placeholder = 'Spell notes / description...';
                        ta.value = _spellNotesCache.get(spell.id) ?? '';

                        // Re-measure after programmatic value set (otherwise it won't autosize until focus/blur)
                        requestAnimationFrame(() => applyTextareaSize?.(ta));
                    });
                }
                notesWrap.appendChild(ta);
                row.appendChild(notesWrap);
            }

            return row;
        }

        render();
    }
    setupSpellsV2();
}
