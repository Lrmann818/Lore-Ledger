// @ts-check
// Attack "Recalculate from Build" (builder completion matrix #9).
//
// Attacks are user-owned sheet content the moment they are seeded (see
// content-registry-plan.md "Seeded Editable Content Ownership") — nothing
// here runs automatically. This module is the pure domain side of an
// explicit, user-requested recalculation: it resolves the attack's source
// weapon through the stable `builderSeed: "weapon:<id>"` marker (never by
// display name), derives what the attack would look like from the
// character's current build, and reports a field-by-field proposal the UI
// can preview. `name` and `notes` are user-owned and never proposed.

import {
  ATTACK_WEAPON_SEED_PREFIX,
  attackWeaponSeedMarker,
  deriveWeaponAttack,
  getAttackSourceWeaponId
} from "./attackCalculation.js";
import { isBuilderCharacter } from "./characterHelpers.js";
import { deriveCharacter } from "./rules/deriveCharacter.js";
import { getContentByKind } from "./rules/registry.js";

/** @typedef {import("./rules/registry.js").ContentRegistry} ContentRegistry */
/** @typedef {import("./rules/registry.js").BuiltinContentEntry} ContentEntry */
/** @typedef {import("../state.js").AttackEntry} AttackEntry */
/** @typedef {import("../state.js").CharacterEntry} CharacterEntry */

// The marker helpers and canonical calculator moved to attackCalculation.js
// (the structured-attack model). Re-exported here so existing imports keep
// working until this proposal engine is retired with the Recalc dialog.
export { ATTACK_WEAPON_SEED_PREFIX, attackWeaponSeedMarker, deriveWeaponAttack, getAttackSourceWeaponId };

/**
 * The recalculable (build-derived) attack fields, in display order. `name`
 * and `notes` are deliberately absent: they are user-owned.
 * @type {ReadonlyArray<{ key: "bonus" | "damage" | "range" | "type", label: string }>}
 */
export const RECALCULABLE_ATTACK_FIELDS = Object.freeze([
  Object.freeze({ key: /** @type {const} */ ("bonus"), label: "Attack bonus" }),
  Object.freeze({ key: /** @type {const} */ ("damage"), label: "Damage" }),
  Object.freeze({ key: /** @type {const} */ ("range"), label: "Range" }),
  Object.freeze({ key: /** @type {const} */ ("type"), label: "Damage type" })
]);

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * @typedef {{
 *   key: "bonus" | "damage" | "range" | "type",
 *   label: string,
 *   current: string,
 *   proposed: string,
 *   changed: boolean
 * }} AttackProposalField
 * @typedef {{
 *   status: "ready" | "no-change" | "unlinked" | "unavailable",
 *   reason: string,
 *   weaponId: string,
 *   weaponName: string,
 *   fields: AttackProposalField[],
 *   patch: Record<string, string> | null
 * }} AttackRecalculationProposal
 *   `patch` holds only the changed build-derived fields (plus a builderSeed
 *   stamp when the user explicitly linked a weapon); it never contains
 *   `name` or `notes`. Null unless status is "ready".
 */

/**
 * Builds the recalculation proposal for one attack against the character's
 * current build. Pure — nothing is mutated; the UI previews the result and
 * applies the (possibly user-filtered) patch atomically on confirmation.
 *
 * Pass `options.weaponId` when the user explicitly chose a source weapon for
 * an unlinked or broken-link attack; the resulting patch then also stamps
 * the `builderSeed` marker so the link is stable from then on. The explicit
 * choice is the only way an unlinked attack gains a source — display names
 * are never used to infer one.
 *
 * @param {AttackEntry} attack
 * @param {CharacterEntry} character
 * @param {ContentRegistry} registry
 * @param {{ weaponId?: string, derived?: ReturnType<typeof deriveCharacter> }} [options]
 * @returns {AttackRecalculationProposal}
 */
export function getAttackRecalculationProposal(attack, character, registry, options = {}) {
  /** @type {AttackRecalculationProposal} */
  const base = {
    status: "unavailable",
    reason: "",
    weaponId: "",
    weaponName: "",
    fields: [],
    patch: null
  };
  if (!isPlainObject(attack)) {
    return { ...base, reason: "This weapon entry could not be read." };
  }
  if (!isBuilderCharacter(character)) {
    return {
      ...base,
      reason: "Recalculation uses the character's build, and this character has no builder data."
    };
  }

  const explicitWeaponId = cleanString(options.weaponId);
  const linkedWeaponId = getAttackSourceWeaponId(attack);
  const weaponId = explicitWeaponId || linkedWeaponId;
  if (!weaponId) {
    return {
      ...base,
      status: "unlinked",
      reason: "This weapon entry isn't linked to a weapon record, so there is nothing to recalculate from. Choose the weapon it represents to link it."
    };
  }

  const weapon = getContentByKind(registry, "weapon", weaponId);
  if (!weapon) {
    return {
      ...base,
      status: explicitWeaponId ? "unavailable" : "unlinked",
      weaponId,
      reason: `The linked weapon "${weaponId}" isn't available any more — it may be removed custom content. Choose a weapon to relink this entry.`
    };
  }

  const derived = options.derived ?? deriveCharacter(character, registry);
  const proposal = deriveWeaponAttack(weapon, derived);

  /** @type {AttackProposalField[]} */
  const fields = RECALCULABLE_ATTACK_FIELDS.map(({ key, label }) => {
    const current = cleanString(attack[key]);
    const proposed = cleanString(proposal[key]);
    return { key, label, current, proposed, changed: current !== proposed };
  });

  const changedFields = fields.filter((field) => field.changed);
  const needsLinkStamp = explicitWeaponId && explicitWeaponId !== linkedWeaponId;
  if (!changedFields.length && !needsLinkStamp) {
    return {
      ...base,
      status: "no-change",
      weaponId,
      weaponName: weapon.name,
      fields,
      reason: "Everything already matches your current build."
    };
  }

  /** @type {Record<string, string>} */
  const patch = {};
  for (const field of changedFields) patch[field.key] = field.proposed;
  if (needsLinkStamp) patch.builderSeed = attackWeaponSeedMarker(explicitWeaponId);

  return {
    status: "ready",
    reason: "",
    weaponId,
    weaponName: weapon.name,
    fields,
    patch
  };
}
