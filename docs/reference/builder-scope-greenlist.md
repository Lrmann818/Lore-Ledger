# Builder Scope Greenlist

Last updated: 2026-07-09

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

## Shipped Scope at a Glance

SRD 5.1 is a **much smaller** content set than full 5E. Agents routinely assume otherwise
and hallucinate content that was never shipped. The counts below are the ground truth,
measured from `game-data/srd/*.json`:

| Category | File | Shipped |
| --- | --- | --- |
| Races | `races.json` | 9 base + 4 subraces (13 records) |
| Classes | `classes.json` | 12 |
| Subclasses | `subclasses.json` | 12 (one per class) |
| Backgrounds | `backgrounds.json` | **1** — Acolyte only |
| Feats | `feats.json` | **1** — Grappler only |
| Spells | `spells.json` | 319 |
| Equipment packs | `equipment.packs.json` | 7 |
| Armor / weapons | `equipment.armor.json`, `equipment.weapons.json` | full SRD 5.1 sets |
| Languages / skills / features | `languages.json`, `skills.json`, `features.json` | supporting registries |

If you are about to write a doc, test, or UI list that names a background other than
Acolyte, a feat other than Grappler, or a Goliath/Orc race, stop: that content is not
shipped. Verify against the JSON before asserting it exists.

---

## Current Greenlit Builtin Categories

Greenlit categories: **races** (and SRD subraces), **classes**, **subclasses**,
**backgrounds**, **feats**, **weapons**, **armor**, **equipment packs**, **spells**, and the
supporting **languages / skills / features** registries.

The exact shipped contents of each are in the glance table above. That table is the single
enumeration in this document — do not restate it.

### Item-level scope, where it is surprising

- **Races** — the 9 SRD 5.1 base races (Dragonborn, Dwarf, Elf, Gnome, Half-Elf, Half-Orc,
  Halfling, Human, Tiefling), plus 4 subraces as `kind: "subrace"` records (High Elf, Hill
  Dwarf, Lightfoot Halfling, Rock Gnome).
  **Goliath and Orc are not in scope** — they are SRD 5.2.1 races, and 5.2.1 is retired for
  this project (see [`srd-licensing-notes.md`](./srd-licensing-notes.md)). Treat as custom.
- **Backgrounds** — **Acolyte only.** It is the only background in SRD 5.1. Criminal, Sage,
  and Soldier are **not** SRD 5.1 content and are not shipped; treat as custom content
  unless a future source pack is explicitly approved.
- **Feats** — **Grappler only.** It is the only feat in SRD 5.1. Every other feat (Alert,
  Great Weapon Master, Lucky, Sentinel, War Caster, …) is **not** SRD 5.1 content and is not
  shipped; treat as custom content.
- **Subclasses** — the 12 SRD 5.1 subclasses, one per class: Berserker, Champion, Devotion,
  Draconic, Evocation, Fiend, Hunter, Land, Life, Lore, Open Hand, Thief.
- **Equipment packs** — 7 SRD packs. A pack is a **container**: its record carries `contents`
  inline as `{ itemId, name, quantity }` rows, so builder Finish can seed a dedicated
  inventory pocket listing what the pack holds. Class and background starting equipment
  reference packs by id (`explorers-pack`, `dungeoneers-pack`, …). The individual gear items
  inside a pack (bedroll, torch, rations, …) are captured inline and are **not** shipped as
  standalone registry entries.
  Deliberately out of scope: standalone adventuring gear, tools, and trade goods as their
  own registry kind.

### The rule that applies to every greenlit category

1. The category is part of the required shipped scope for the character builder.
2. If an item is in the approved SRD scope and Lore Ledger can legally use it, it is
   greenlit builtin content.
3. Support must be **structured and data-driven** — modeled in `game-data/srd/*.json`, never
   hardcoded ad hoc in UI or seeding code. AC logic derives from armor records; pack
   contents come from pack records; feat prerequisites and ASI interactions come from feat
   records.

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
- Goliath, Orc: custom — SRD 5.2.1 races, and 5.2.1 is retired
- Criminal, Sage, Soldier: custom — not SRD 5.1 backgrounds
- Alert, Lucky, Sentinel, War Caster, and every feat except Grappler: custom — not SRD 5.1 feats
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

## Deferred / Not Builtin

Not shipped as builtin content today:

- magic items
- monster / NPC stat blocks
- standalone adventuring gear, tools, and trade goods as their own registry kind
- any non-SRD content

The greenlit scope is intentionally narrow so the builder can mature without legal
ambiguity, content sprawl, or unnecessary architectural churn.

Final rule:

> If it is greenlit, in approved SRD scope, legally usable, and modeled in project data, it is intended to ship as builtin content. Otherwise, treat it as deferred or custom user content.

---

## When to Update This File

Update this file whenever any of the following happens:

- a new builtin content category is approved
- a previously deferred category becomes active implementation scope
- the project intentionally expands beyond the current greenlist
- the licensing posture changes in a way that affects shipped builtin content
- contributors need a clearer rule because ambiguity caused confusion during implementation
