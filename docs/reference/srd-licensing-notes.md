# SRD Licensing Notes

_Last updated: 2026-04-20_

## Purpose

This document records the current licensing approach for SRD-derived content used by Lore Ledger's character builder and related rules/content systems.

It exists to answer these questions:

- Which SRD source documents are we using?
- What licensing model applies to each one?
- What is the safe builtin-content policy for Lore Ledger?
- What attribution obligations do we need to satisfy?
- What should contributors avoid when adding new builtin content?

This is a project guidance document, not legal advice.

---

## Canonical Reference Files

The official source reference files stored in this repo are:

- `docs/reference/SRD_OGL_v5.1.pdf`

This PDF is kept for provenance and reference.

It is **not** the preferred working format for implementation. Implementation-facing content decisions should be captured in markdown and structured JSON files elsewhere in the repo.

---

## Current Project Direction

Lore Ledger should follow a conservative, production-friendly content policy:

- Use **SRD-permitted content only** for shipped builtin content.
- Treat anything outside the approved builtin scope as **custom user content**.
- Keep builtin content clearly separated from user-created content in both code and data.
- Keep licensing attribution explicit and easy to audit.
- Avoid depending on ambiguous or unofficial content sources.

This matches the project's overall architecture goals: stable, well-documented, and boringly reliable.

---

## SRD 5.1

`SRD 5.1` was originally released under the Open Gaming License v1.0a. In January 2023, Wizards of the Coast re-released SRD 5.1 under the **Creative Commons Attribution 4.0 International License (CC BY 4.0)**, permanently. This re-release was irrevocable and is the basis for the project's current content strategy.

The CC-BY-4.0 re-release eliminates the OGL compliance burden for new works using SRD 5.1 content. Works using SRD 5.1 content under CC-BY-4.0 must include the attribution statement provided by Wizards of the Coast.

### Practical meaning for Lore Ledger

SRD 5.1 is the **primary source** for all builtin builder content.

- Both SRD 5.1 and SRD 5.2.1 are CC-BY-4.0 licensed — licensing is not a differentiator between them.
- SRD 5.1 is the more complete and widely-used reference; SRD 5.2.1 has been retired from this project.
- All `game-data/srd/*.json` files use `"source": "srd-5.1"`.

### Attribution text for SRD 5.1

When Lore Ledger distributes builtin material derived from SRD 5.1, include this attribution statement:

> This work includes material taken from the System Reference Document 5.1 ("SRD 5.1") by Wizards of the Coast LLC and available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License available at https://creativecommons.org/licenses/by/4.0/legalcode.

This statement is also in `LEGAL.md` at the repo root. Keep both in sync.

### Recommended implementation rule

If Lore Ledger ships builtin content derived from SRD 5.1, the app and repo should contain a clear attribution notice in an appropriate place such as:

- About / Credits / Legal section in-app
- `LEGAL.md` in the repo root
- any future website or README section covering third-party content attribution

See `docs/reference/attribution-requirements.md` for the in-app requirements and timeline.

---

## SRD 5.2.1

`SRD 5.2.1` is provided by Wizards of the Coast under CC-BY-4.0. It has been **retired** from Lore Ledger.

Both SRD 5.1 and SRD 5.2.1 are CC-BY-4.0 licensed with identical attribution obligations. SRD 5.2.1 has no licensing advantage over SRD 5.1. The previous data derived from SRD 5.2.1 has been deleted from `game-data/srd/`.

Do not use SRD 5.2.1 as a source for any new builtin content.

---

## Product Identity and Safe Naming

SRD 5.1 identifies certain names and terms as Product Identity. Lore Ledger contributors should avoid:

- using protected product identity terms as builtin branded content
- implying official endorsement
- using non-SRD proprietary subclasses, races, settings, monsters, or named lore as shipped builtin data unless their status has been explicitly reviewed and documented

When in doubt:

- do not add it as builtin
- treat it as user-added custom content instead

Note: the app and repo may describe themselves as "compatible with fifth edition" or "5E compatible." Do not use "Dungeons & Dragons" or "D&D."

---

## Builtin vs Custom Content Policy

Lore Ledger uses a strict separation:

### Builtin content

Builtin content is content that ships with the app and is stored in the repo as project-owned structured data.

Builtin content must be:

- clearly within approved SRD scope
- documented in repo policy files
- stored in machine-friendly project data files
- attributable in a way that is easy to audit

### Custom content

Custom content is any user-authored or user-imported content that does not ship as official builtin data.

Examples include:

- homebrew races
- homebrew classes/subclasses
- non-approved 5E content
- campaign-specific rules content
- anything outside the approved greenlist

This separation is important both for legal clarity and for clean architecture.

---

## Recommended Source Hierarchy

When adding or modifying builtin character-builder content, use this priority order:

1. `builder-scope-greenlist.md`
2. structured content files under `game-data/srd/`
3. `content-registry-plan.md`
4. official SRD PDFs in `docs/reference/`

Interpretation rule:

- the PDFs are canonical source references
- the markdown policy/docs define project decisions
- the JSON files define implementation-ready approved builtin data

If there is a conflict between raw SRD text and project implementation files, stop and resolve the discrepancy explicitly rather than guessing.

---

## Contributor Rules

When working on Lore Ledger builtin content:

1. Do not add non-greenlit content as builtin.
2. Do not assume "common D&D knowledge" is automatically safe to ship.
3. Do not use unofficial websites as authority for builtin content decisions.
4. Use SRD 5.1 as the source for all new builtin content. SRD 5.2.1 is retired.
5. Keep legal/policy reasoning in markdown and implementation data in JSON.
6. If source status is unclear, do not implement it as builtin until reviewed.

---

## Current Working Recommendation

At the current stage of Lore Ledger's builder work, the safest approach is:

- keep the official SRD PDFs in `docs/reference/`
- use SRD 5.1 (CC-BY-4.0, re-released 2023) as the sole active builtin content source
- use a project-maintained greenlist to define what may ship as builtin
- model approved builtin data in `game-data/srd/*.json` with `"source": "srd-5.1"`
- treat everything else as custom user content
- include the CC-BY-4.0 attribution statement from `LEGAL.md` in-app before public release

This keeps the content system explicit, auditable, and maintainable.

---

## Summary

Current Lore Ledger licensing posture:

- **Primary builtin-content source:** SRD 5.1 (CC-BY-4.0, re-released January 2023)
- **Retired source:** SRD 5.2.1 (data deleted from game-data/srd/)
- **Policy stance:** conservative, greenlist-based, builtin vs custom separated
- **Default rule:** if it is not clearly approved for builtin scope, treat it as custom content
- **Attribution:** CC-BY-4.0 statement in `LEGAL.md`; in-app credits page required before public release (Phase 4)

This document should be updated whenever the project's shipped builtin content scope or attribution strategy changes.
