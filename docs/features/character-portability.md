# Character Portability

This document describes the single-character export/import format shipped for Step 4 of the multi-character work.

Source-of-truth modules:

- `js/domain/characterPortability.js`
- `js/pages/character/characterPage.js`
- `js/storage/blobs.js`
- `js/storage/texts-idb.js`

## Purpose

Character portability moves one character between campaigns without moving the source campaign.

The flow exports the active character to a `.ll-character.json` file, then imports that file into the currently active campaign as a new character entry. It is not a full campaign backup, not a tracker-card export, and not a replacement/overwrite flow.

## File Format

The current file shape is:

```json
{
  "formatVersion": 1,
  "type": "lore-ledger-character",
  "character": {
    "id": "char_original",
    "name": "Mira",
    "imgBlobId": "blob_original",
    "spells": {
      "levels": [
        {
          "id": "level_1",
          "spells": [
            { "id": "spell_alpha", "name": "Light" }
          ]
        }
      ]
    }
  },
  "portrait": {
    "dataUrl": "data:image/webp;base64,...",
    "mimeType": "image/webp"
  },
  "spellNotes": {
    "spell_alpha": "Use before entering ruins."
  }
}
```

Fields:

- `formatVersion`: numeric file-format version. The current version is `1`.
- `type`: must be `"lore-ledger-character"` so imports can reject unrelated JSON files.
- `character`: the portable `CharacterEntry` data.
- `portrait`: either `null` or an object containing a full image data URL plus a convenience `mimeType`.
- `spellNotes`: a plain object mapping spell entry IDs to note text.

Exported filenames use:

```text
{sanitized-character-name}-{short-id}.ll-character.json
```

The file picker accepts normal JSON files, and imports are size-gated at 10 MB as a UI safety guard.

## Export Behavior

Export resolves the active character from `state.characters.activeId`, fetches its portrait blob when `imgBlobId` points to one, collects spell IDs from `character.spells.levels[].spells[]`, and reads non-empty spell notes from IndexedDB using:

```text
spell_notes_<campaignId>__<spellId>
```

The portrait is stored as a full data URL, not raw base64 split from its MIME metadata. The full data URL matches the existing `blobToDataUrl(...)` and `dataUrlToBlob(...)` helpers and leaves less room for reconstruction mistakes. `mimeType` is retained for convenience, but the data URL is the canonical payload.

The exported character is copied as plain portable data before serialization. This is intentional. Live runtime state can accumulate values that JSON cannot represent safely, such as functions, `WeakMap`s, non-plain objects, or circular references. `exportCharacterToObject(...)` normalizes the character into JSON-shaped data instead of relying on `structuredClone(...)` against live runtime state, then serializes the result with `JSON.stringify(...)`.

## Import Behavior

Import is split into two phases:

1. `parseAndValidateImport(file)` reads and validates the file before anything touches state or IndexedDB.
2. `commitImport(importObject, deps)` stores the portrait if present, adds the character to state, marks the structured save dirty, and then writes spell notes.

Imports always add a new character. They never replace an existing entry, even if the incoming name or original ID matches a local character.

During commit:

- the current campaign ID comes from `state.appShell.activeCampaignId`
- portrait data is converted with `dataUrlToBlob(...)` and stored as a new blob
- the imported character receives a new generated `char_...` ID
- `state.characters.entries` is initialized defensively if missing
- the new character is pushed into `entries`
- `state.characters.activeId` is set to the new character
- `SaveManager.markDirty()` is called for the structured save
- spell notes are written afterward as best-effort IndexedDB text records

If portrait storage succeeds but the state mutation fails, the staged portrait blob is deleted and the previous `state.characters` snapshot is restored.

## Field Rationale

`imgBlobId` is rewritten on import because blob IDs are local IndexedDB keys, not portable asset identifiers. The export file carries the portrait bytes separately in `portrait.dataUrl`; import stores those bytes as a fresh blob in the destination browser storage and points the new character at that new blob ID. If there is no portrait payload, import sets `imgBlobId` to `null` even if the original character object still contained an old value.

Spell notes are bundled because their bodies live outside structured character state in the IndexedDB `texts` store. The export only includes notes for spell IDs present on the exported character, and empty notes are omitted. On import, the spell IDs inside the character entry are preserved, but the text keys are re-created for the destination campaign:

```text
spell_notes_<newCampaignId>__<spellId>
```

Linked tracker cards do not travel. A tracker card's `characterId` relationship is campaign-local, and cards carry placement, grouping, collapse state, and other tracker-specific context that belongs to the source campaign. Imported characters arrive standalone; users can link them to NPC or Party cards in the destination campaign after import.

`formatVersion` exists so future file shapes can evolve without guessing. Version `1` describes the current `character` plus `portrait.dataUrl` plus `spellNotes` layout. Imports reject newer versions with a clear message rather than trying to partially understand them.

Spell notes are written last and best-effort because the character itself is the primary import result. The atomic portion of the import is the portrait staging plus structured character commit. Once the character exists and the structured save has been marked dirty, note writes can fail independently without rolling back the whole character. This avoids deleting a successfully imported character because one secondary note record could not be stored.

## Validation Notes

Validation rejects:

- non-object import payloads
- unsupported, missing, or newer `formatVersion` values
- unknown `type` values
- missing or non-object `character`
- characters without a string `name`
- malformed `portrait` payloads
- malformed `spellNotes`
- spell-note keys that do not match a spell ID in the imported character

Validation tolerates a non-string original character `id` because import always generates a new character ID before committing.

Portrait `mimeType` mismatches are tolerated. The data URL header is what the blob conversion path actually uses.

## Relationship To Backups

Character portability is narrower than backup import/export:

- backup export captures a whole campaign with referenced blobs and text records
- character export captures one active character, its portrait payload, and only that character's spell notes
- backup import can replace campaign state
- character import only appends one new character to the current campaign

Do not use character portability as a schema migration path. It is a user-facing copy/share feature at the file boundary.
