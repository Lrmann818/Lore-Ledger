// @ts-check
// Minimal read-only builtin content for the Step 3 rules foundation.

/**
 * @typedef {"race" | "class" | "background"} BuiltinContentKind
 * @typedef {{
 *   id: string,
 *   kind: BuiltinContentKind,
 *   name: string,
 *   source: "builtin",
 *   ruleset: "srd-5.1",
 *   data: Record<string, unknown>
 * }} BuiltinContentEntry
 */

const RULESET = "srd-5.1";

/** @type {readonly BuiltinContentEntry[]} */
export const BUILTIN_CONTENT = Object.freeze([
  Object.freeze({
    id: "race_human",
    kind: "race",
    name: "Human",
    source: "builtin",
    ruleset: RULESET,
    data: Object.freeze({ speed: 30 })
  }),
  Object.freeze({
    id: "race_dwarf",
    kind: "race",
    name: "Dwarf",
    source: "builtin",
    ruleset: RULESET,
    data: Object.freeze({ speed: 30 })
  }),
  Object.freeze({
    id: "race_elf",
    kind: "race",
    name: "Elf",
    source: "builtin",
    ruleset: RULESET,
    data: Object.freeze({ speed: 30 })
  }),
  Object.freeze({
    id: "class_fighter",
    kind: "class",
    name: "Fighter",
    source: "builtin",
    ruleset: RULESET,
    data: Object.freeze({ hitDie: 10, saveProficiencies: Object.freeze(["str", "con"]) })
  }),
  Object.freeze({
    id: "class_cleric",
    kind: "class",
    name: "Cleric",
    source: "builtin",
    ruleset: RULESET,
    data: Object.freeze({ hitDie: 8, saveProficiencies: Object.freeze(["wis", "cha"]) })
  }),
  Object.freeze({
    id: "class_wizard",
    kind: "class",
    name: "Wizard",
    source: "builtin",
    ruleset: RULESET,
    data: Object.freeze({ hitDie: 6, saveProficiencies: Object.freeze(["int", "wis"]) })
  }),
  Object.freeze({
    id: "background_acolyte",
    kind: "background",
    name: "Acolyte",
    source: "builtin",
    ruleset: RULESET,
    data: Object.freeze({})
  }),
  Object.freeze({
    id: "background_sage",
    kind: "background",
    name: "Sage",
    source: "builtin",
    ruleset: RULESET,
    data: Object.freeze({})
  }),
  Object.freeze({
    id: "background_soldier",
    kind: "background",
    name: "Soldier",
    source: "builtin",
    ruleset: RULESET,
    data: Object.freeze({})
  })
]);

