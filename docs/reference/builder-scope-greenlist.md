# Greenlist

## Spell Scope Distinction

Lore Ledger makes an explicit distinction between **spellcasting progression support** and a **full builtin spell registry**.

### In Scope for Shipped Builder Behavior

The following spell-related capabilities are part of the current intended shipped builder scope:

- spellcasting progression metadata
- spellcasting ability metadata
- spell slot progression
- spell level access/progression
- automatically granted spells or cantrips from builtin races, classes, subclasses, feats, backgrounds, or similar builder-backed content

This means the builder is allowed to determine things like:

- whether a character is a spellcaster
- what spellcasting ability applies
- how many spell slots the character has
- which builtin spells are automatically granted by the build

### Expanded 2026-07-06: Full SRD 5.1 Spell Registry

The full SRD 5.1 spell registry (`game-data/srd/spells.json`, generated from
the 5e SRD API) is now greenlit and shipped. The builder wizard offers
class-list spell selection (cantrips, known, prepared, spellbook) and seeds
selections into the sheet spells model at Finish.

### Still Deferred

- magic items
- monster / NPC stat blocks

### Practical Rule

The existing spells panel remains the manual-entry and at-the-table UI for
user-managed spells. Builder spell selection seeds into it; it never locks it.

# Builder Scope Greenlist

_Last updated: 2026-07-06_

## Purpose

This document defines the current **approved builtin content scope** for Lore Ledger's character builder.

It answers one practical question:

**What content is allowed to ship as builtin builder content right now?**

Anything not clearly approved here should be treated as **custom user content**, not shipped builtin content.

This file exists to keep implementation decisions conservative, auditable, and easy for both humans and coding agents to follow.

---

## Relationship to Other Project Files

This file should be read together with:

- `docs/reference/srd-licensing-notes.md`
- `docs/reference/content-registry-plan.md`
- `game-data/srd/*.json`
- `AGENTS.md`

Interpretation order:

1. `srd-licensing-notes.md` defines the licensing posture
2. this file defines the approved builtin scope
3. `content-registry-plan.md` defines how approved content should be modeled
4. `game-data/srd/*.json` contains the actual implementation-ready builtin records

If content is not approved here, it should not be added to builtin JSON files.

---

## Project Policy

Lore Ledger uses a strict separation between:

- **builtin content**: content that ships with the app
- **custom content**: content created or added by the user

The default rule is simple:

> If it is not explicitly greenlit here, it is custom content.

This is intentional.

Lore Ledger is aiming for a production-grade, legally conservative, architecturally clean builder system. That means we do **not** try to ship every possible 5E option as builtin. We ship the content we have explicitly approved, modeled, and documented.

---

## Primary Source Standard

For new builtin content, Lore Ledger should prefer **SRD 5.1** as the primary source.

SRD 5.2.1 is retired for this project and should not be used as the source for new builtin builder data.

If the project later changes source posture or adds another approved builtin source pack, document that decision explicitly before implementation.

---

## Current Greenlit Builtin Categories

The following categories are approved for builtin builder support, provided they are sourced from approved SRD material and represented in the project's structured data files.

### 1. Race

**Greenlit as builtin category:** Yes

Builtin races may be shipped if they are approved SRD races and are modeled in `game-data/srd/races.json`.

Current expected builtin race scope includes SRD-safe races such as:

- Dragonborn
- Dwarf
- Elf
- Gnome
- Goliath
- Halfling
- Human
- Orc
- Tiefling

Project rule:

- races are part of the required shipped scope for the character builder
- if a race is in the approved SRD scope and Lore Ledger can legally use it, it should be treated as greenlit builtin content
- race support should remain structured and data-driven

### 2. Classes

**Greenlit as builtin category:** Yes

Builtin classes may be shipped if they are approved SRD classes and are modeled in `game-data/srd/classes.json`.

Current expected builtin class scope includes SRD-safe classes such as:

- Barbarian
- Bard
- Cleric
- Druid
- Fighter
- Monk
- Paladin
- Ranger
- Rogue
- Sorcerer
- Warlock
- Wizard

Project rule:

- classes are part of the required shipped scope for the character builder
- if a class is in the approved SRD scope and Lore Ledger can legally use it, it should be treated as greenlit builtin content
- class support should be implemented in a structured, data-driven way rather than ad hoc in UI code

### 3. Backgrounds

**Greenlit as builtin category:** Yes

Builtin backgrounds may be shipped if they are approved SRD backgrounds and are modeled in `game-data/srd/backgrounds.json`.

Current expected builtin background scope includes SRD-safe backgrounds such as:

- Acolyte
- Criminal
- Sage
- Soldier

Project rule:

- backgrounds are part of the required shipped scope for the character builder
- if a background is in the approved SRD scope and Lore Ledger can legally use it, it should be treated as greenlit builtin content
- background support should remain explicit and data-driven

### 4. Subclasses

**Greenlit as builtin category:** Yes

Builtin subclasses may be shipped if they are approved SRD subclasses and are modeled in the appropriate project data files.

Project rule:

- subclasses are part of the required shipped scope for the character builder
- if a subclass is in the approved SRD scope and Lore Ledger can legally use it, it should be treated as greenlit builtin content
- subclass support should be implemented in a structured, data-driven way rather than ad hoc in UI code

### 5. Feats

**Greenlit as builtin category:** Yes

Builtin feats may be shipped if they are approved SRD feats and are modeled in the appropriate project data files.

Project rule:

- feats are part of the required shipped scope for the character builder
- if a feat is in the approved SRD scope and Lore Ledger can legally use it, it should be treated as greenlit builtin content
- feat handling should remain explicit and data-driven so prerequisites and ASI interactions stay maintainable

### 6. Weapons

**Greenlit as builtin category:** Yes

Builtin weapons may be shipped if they are approved SRD weapons and are modeled in `game-data/srd/equipment.weapons.json`.

Project rule:

- weapons are part of the required shipped scope for the character builder
- if a weapon is in the approved SRD scope and Lore Ledger can legally use it, it should be treated as greenlit builtin content
- weapons must be represented as structured records rather than ad hoc hardcoding in UI code

### 7. Armor

**Greenlit as builtin category:** Yes

Builtin armor may be shipped if they are approved SRD armor entries and are modeled in `game-data/srd/equipment.armor.json`.

Project rule:

- armor is part of the required shipped scope for the character builder
- if an armor entry is in the approved SRD scope and Lore Ledger can legally use it, it should be treated as greenlit builtin content
- armor must be represented in structured records so AC logic derives from registry data, not scattered UI assumptions

### 8. Equipment Packs (added 2026-07-09)

**Greenlit as builtin category:** Yes

Builtin equipment packs may be shipped if they are approved SRD packs and are modeled in `game-data/srd/equipment.packs.json` (7 packs, generated from the 5e SRD API).

Project rule:

- equipment packs are part of the required shipped scope because class and background starting equipment reference them by id (`explorers-pack`, `dungeoneers-pack`, …)
- a pack is a **container**: its record carries the pack's `contents` inline as `{ itemId, name, quantity }` rows so builder Finish can seed a dedicated inventory pocket listing what the pack actually holds
- the individual adventuring-gear items inside a pack (bedroll, torch, rations, …) are captured inline on the pack record and are **not** shipped as standalone registry entries
- packs must be represented as structured records; do not hardcode pack contents in seeding or UI code

Deliberately still out of builtin scope: standalone adventuring gear, tools, and trade goods as their own registry kind. Only the pack containers referenced by starting equipment are shipped.

---

## Spell Scope (expanded 2026-07-06)

The full SRD 5.1 spell registry is greenlit and shipped in
`game-data/srd/spells.json` (319 spells, generated from the 5e SRD API).

In scope for shipped builder behavior:

- spellcasting progression metadata (ability, slots, known/prepared counts)
- builder spell selection from class spell lists (cantrips, known,
  prepared, and wizard spellbook flows)
- automatically granted spells (e.g. domain spells) from builtin content
- multiclass and pact-magic slot derivation

Still deferred: magic items, monster / NPC stat blocks.

Practical rule: the spells panel remains the manual-entry and at-the-table
surface. Builder Finish seeds selections and slot totals into it
additively; user edits are never overwritten.

---

## Explicitly Not Greenlit as Builtin by Default

The following should be treated as **custom-only unless explicitly reviewed and added later**:

- non-SRD races
- non-SRD classes
- non-SRD subclasses
- non-SRD feats
- non-SRD backgrounds
- setting-specific or brand-specific lore content
- protected named characters, locations, factions, or proprietary settings
- unofficial web-sourced content
- "common D&D knowledge" that has not been tied to an approved source and modeled intentionally

Examples of practical interpretation:

- Aasimar: custom unless explicitly approved later
- Artificer: custom unless explicitly approved later
- homebrew subclasses: custom
- homebrew feats: custom
- setting-specific origins or lore packages: custom

---

## Builtin Means Greenlit, Intended to Ship, and Implemented Safely

For Lore Ledger, a category being greenlit means items in that category are intended to ship as builtin content when they are included in the approved SRD scope, legally usable, and represented in the project's structured data files.

For Lore Ledger, builtin content must meet **all** of these conditions:

1. the category is greenlit in this document
2. the specific item is included in the approved SRD scope
3. Lore Ledger can legally use and ship that item
4. the item has been modeled in project data files
5. the builder currently supports the mechanics needed to use it safely

So there are still separate states that contributors and coding agents must keep distinct:

- **not greenlit**
- **greenlit in policy**
- **greenlit and intended to ship**
- **actually implemented in data/code**

Coding agents and contributors must not collapse those into one concept.

---

## Safe Contributor Rules

When adding or changing builder content:

1. Check this file first.
2. If the category or item is not clearly greenlit, stop and treat it as custom.
3. Do not expand builtin scope silently inside JSON files or UI code.
4. Do not use unofficial sources to justify builtin additions.
5. Update this file before or alongside any intentional scope expansion.
6. Keep builtin decisions explicit enough that a future contributor can audit them quickly.

---

## Current Working Scope for the Builder

At the current stage of Lore Ledger builder development, the safe working builtin scope is:

### Approved current focus

- races (and SRD subraces)
- classes
- backgrounds
- subclasses
- feats
- armor
- weapons
- spells (full SRD 5.1 registry)
- languages, skills, features
- spellcasting progression metadata
- automatically granted builtin spells

### Deferred / later

- magic items
- monster data

This scope is intentionally narrow so the builder can mature without legal ambiguity, content sprawl, or unnecessary architectural churn.

---

## When to Update This File

Update this file whenever any of the following happens:

- a new builtin content category is approved
- a previously deferred category becomes active implementation scope
- the project intentionally expands beyond the current greenlist
- the licensing posture changes in a way that affects shipped builtin content
- contributors need a clearer rule because ambiguity caused confusion during implementation

---

## Summary

Lore Ledger's current builder greenlist is conservative where it needs to be, but it does include the full core character-builder scope required for shipping.

**Approved builtin direction right now:**

- races (and SRD subraces)
- classes (with level tables, multiclassing data, starting equipment)
- backgrounds
- subclasses (with granted spells)
- feats
- armor
- weapons
- equipment packs (with inline contents)
- the full SRD 5.1 spell registry
- languages, skills, features (supporting registries)
- spellcasting progression metadata
- automatically granted builtin spells

**Not default builtin right now:**

- magic items
- monsters
- standalone adventuring gear, tools, and trade goods
- non-SRD content

Final rule:

> If it is greenlit, in approved SRD scope, legally usable, and modeled in project data, it is intended to ship as builtin content. Otherwise, treat it as deferred or custom user content.
