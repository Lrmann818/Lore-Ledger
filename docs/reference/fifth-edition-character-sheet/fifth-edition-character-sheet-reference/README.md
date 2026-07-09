# Fifth Edition Character Sheet reference screenshots

These screenshots are reference material for comparing Lore Ledger character builder, editable character sheet areas, and level-up flow behavior against the Fifth Edition Character Sheet app.

**These screenshots are UX/reference coverage only. They are NOT a visual-design target.**

Use them to identify:

- which surfaces are editable, and from where
- what information each surface must cover
- the tap/click/long-press edit patterns

Lore Ledger should support the same practical editability pattern: tap/click or long-press a visible sheet field, open a focused edit popover/modal, apply changes, and return to the same sheet/combat context.

Do **not** copy the reference app’s visual design — its colors, spacing, typography, or component styling. Match the behavior, not the look.

Note: this directory is gitignored, so it is absent from a fresh clone. Its absence does not relax any rule here; the binding statements live in `AGENTS.md` → "Reference App Screenshots".

GUARDED THROUGH BUILDER WIZARD:
Race, subrace, class levels, multiclass order, subclass, background, ASI, feats, and starting ability-generation method.

QUICK-EDIT FROM NORMAL SHEET:
HP, temp HP, AC bonuses, initiative, speed, saves, skills, attacks, spells, equipment, features, resources, notes, and other play-state overrides.

## Folder layout

- `01-character-builder-flow/` — initial character creation wizard screens.
- `02-editable-character-sheet/` — editable sheet panels and menus after character creation.
- `03-level-up-flow/` — level-up and multiclass examples.

## Rename manifest

|  # | New path                                                                              | Original filename                          | Description                                                                              |
|---:|---------------------------------------------------------------------------------------|--------------------------------------------|------------------------------------------------------------------------------------------|
|  1 | `01-character-builder-flow/01-builder-start-use-character-creator-prompt.png`         | `Screenshot 2026-07-08 at 9.32.53 AM.png`  | Initial prompt asking whether to use the character creator.                              |
|  2 | `01-character-builder-flow/02-builder-basic-identity-race-class-background.png`       | `Screenshot 2026-07-08 at 9.33.01 AM.png`  | Builder step with race, subrace, class, and background fields.                           |
|  3 | `01-character-builder-flow/03-builder-race-dropdown-open.png`                         | `Screenshot 2026-07-08 at 9.34.03 AM.png`  | Race selection dropdown open in the builder.                                             |
|  4 | `01-character-builder-flow/04-builder-racial-ability-scores-before-bonus.png`         | `Screenshot 2026-07-08 at 9.34.13 AM.png`  | Ability score step before applying racial score bonus.                                   |
|  5 | `01-character-builder-flow/05-builder-racial-ability-scores-after-bonus.png`          | `Screenshot 2026-07-08 at 9.34.23 AM.png`  | Ability score step showing score inputs and racial stat bonus area.                      |
|  6 | `01-character-builder-flow/06-builder-skill-selection-empty.png`                      | `Screenshot 2026-07-08 at 9.34.27 AM.png`  | Skill selection step before choosing skills.                                             |
|  7 | `01-character-builder-flow/07-builder-skill-selection-chosen.png`                     | `Screenshot 2026-07-08 at 9.34.38 AM.png`  | Skill selection step with chosen proficiencies checked.                                  |
|  8 | `01-character-builder-flow/08-builder-hit-points-class-resource-level-1.png`          | `Screenshot 2026-07-08 at 9.34.43 AM.png`  | Hit points step showing current/next level HP and class resource display.                |
|  9 | `01-character-builder-flow/09-builder-starting-equipment-options-empty.png`           | `Screenshot 2026-07-08 at 9.34.59 AM.png`  | Starting equipment step showing equipment choice groups before selection.                |
| 10 | `01-character-builder-flow/10-builder-starting-equipment-options-selected.png`        | `Screenshot 2026-07-08 at 9.35.07 AM.png`  | Starting equipment step with several equipment choices selected.                         |
| 11 | `01-character-builder-flow/11-builder-finish-character-confirmation.png`              | `Screenshot 2026-07-08 at 9.35.11 AM.png`  | Finish character confirmation dialog.                                                    |
| 12 | `02-editable-character-sheet/01-edit-character-name-modal.png`                        | `Screenshot 2026-07-08 at 9.35.18 AM.png`  | Character sheet edit modal for character name.                                           |
| 13 | `02-editable-character-sheet/02-character-sheet-main-stats-overview.png`              | `Screenshot 2026-07-08 at 9.35.30 AM.png`  | Main character sheet overview after creation.                                            |
| 14 | `02-editable-character-sheet/03-edit-initiative-modal.png`                            | `Screenshot 2026-07-08 at 9.35.34 AM.png`  | Initiative edit modal with proficiency/half proficiency and misc modifier controls.      |
| 15 | `02-editable-character-sheet/04-edit-death-saves-display-modal.png`                   | `Screenshot 2026-07-08 at 9.35.41 AM.png`  | Death saves and HP display edit modal.                                                   |
| 16 | `02-editable-character-sheet/05-edit-hit-points-modal.png`                            | `Screenshot 2026-07-08 at 9.35.46 AM.png`  | Hit points edit modal with damage, heal, and temporary HP controls.                      |
| 17 | `02-editable-character-sheet/06-edit-speed-and-movement-modal.png`                    | `Screenshot 2026-07-08 at 9.35.56 AM.png`  | Speed and movement edit modal.                                                           |
| 18 | `02-editable-character-sheet/07-edit-hit-dice-use-regain-modal.png`                   | `Screenshot 2026-07-08 at 9.36.00 AM.png`  | Use/regain hit dice edit modal.                                                          |
| 19 | `02-editable-character-sheet/08-edit-hit-dice-pool-modal.png`                         | `Screenshot 2026-07-08 at 9.36.05 AM.png`  | Hit dice pool edit modal with extra hit dice controls.                                   |
| 20 | `02-editable-character-sheet/09-edit-armor-class-modal.png`                           | `Screenshot 2026-07-08 at 9.36.10 AM.png`  | Armor class edit modal with armor, shield, dex, magic, and additional modifier controls. |
| 21 | `02-editable-character-sheet/10-edit-proficiency-bonus-modal.png`                     | `Screenshot 2026-07-08 at 9.36.15 AM.png`  | Proficiency bonus edit modal.                                                            |
| 22 | `02-editable-character-sheet/11-edit-ability-scores-and-save-proficiencies-modal.png` | `Screenshot 2026-07-08 at 9.36.30 AM.png`  | Ability score and saving throw proficiency edit modal.                                   |
| 23 | `02-editable-character-sheet/12-edit-saving-throw-bonuses-modal.png`                  | `Screenshot 2026-07-08 at 9.36.34 AM.png`  | Saving throw bonus edit modal for all ability saves.                                     |
| 24 | `02-editable-character-sheet/13-edit-all-save-bonus-type-dropdown.png`                | `Screenshot 2026-07-08 at 9.36.40 AM.png`  | Saving throw bonus modal with all-save bonus type dropdown open.                         |
| 25 | `02-editable-character-sheet/14-skills-page-overview.png`                             | `Screenshot 2026-07-08 at 9.37.24 AM.png`  | Skills page overview with all skill rows and bonuses.                                    |
| 26 | `02-editable-character-sheet/15-edit-athletics-skill-proficiency-modal.png`           | `Screenshot 2026-07-08 at 9.37.32 AM.png`  | Athletics skill edit modal with proficiency options.                                     |
| 27 | `02-editable-character-sheet/16-edit-history-skill-proficiency-modal.png`             | `Screenshot 2026-07-08 at 9.37.37 AM.png`  | History skill edit modal with proficiency options.                                       |
| 28 | `02-editable-character-sheet/17-weapons-page-overview.png`                            | `Screenshot 2026-07-08 at 9.38.11 AM.png`  | Weapons/combat page overview with attack tiles and resource display.                     |
| 29 | `02-editable-character-sheet/18-edit-resource-display-settings-modal.png`             | `Screenshot 2026-07-08 at 9.38.24 AM.png`  | Resource display settings modal for class/resource display and display text.             |
| 30 | `02-editable-character-sheet/19-edit-resource-dice-and-size-modal.png`                | `Screenshot 2026-07-08 at 9.38.27 AM.png`  | Resource edit modal showing max value, die size, size, and spending/rest controls.       |
| 31 | `02-editable-character-sheet/20-edit-resource-name-display-text-row.png`              | `Screenshot 2026-07-08 at 9.38.32 AM.png`  | Resource edit modal focused on resource name and display text row.                       |
| 32 | `02-editable-character-sheet/21-edit-resource-type-dropdown-open.png`                 | `Screenshot 2026-07-08 at 9.38.44 AM.png`  | Resource edit modal with resource type dropdown open.                                    |
| 33 | `02-editable-character-sheet/22-edit-weapon-attack-bonus-modal.png`                   | `Screenshot 2026-07-08 at 9.39.00 AM.png`  | Weapon attack bonus edit modal.                                                          |
| 34 | `02-editable-character-sheet/23-edit-weapon-attack-damage-modal.png`                  | `Screenshot 2026-07-08 at 9.39.07 AM.png`  | Weapon attack damage edit modal.                                                         |
| 35 | `02-editable-character-sheet/24-edit-weapon-damage-extra-dice-modal.png`              | `Screenshot 2026-07-08 at 9.39.11 AM.png`  | Weapon damage edit modal with extra damage die controls.                                 |
| 36 | `02-editable-character-sheet/25-add-weapon-empty-form.png`                            | `Screenshot 2026-07-08 at 9.39.19 AM.png`  | Add weapon modal blank/custom weapon form.                                               |
| 37 | `02-editable-character-sheet/26-add-weapon-simple-melee-club-details.png`             | `Screenshot 2026-07-08 at 9.39.22 AM.png`  | Add weapon modal showing simple melee club details.                                      |
| 38 | `02-editable-character-sheet/27-add-weapon-simple-melee-category-dropdown.png`        | `Screenshot 2026-07-08 at 9.39.27 AM.png`  | Add weapon modal with simple/martial/custom weapon category dropdown.                    |
| 39 | `02-editable-character-sheet/28-add-weapon-melee-ranged-dropdown.png`                 | `Screenshot 2026-07-08 at 9.39.31 AM.png`  | Add weapon modal with melee/ranged dropdown.                                             |
| 40 | `02-editable-character-sheet/29-add-weapon-simple-weapon-select-dropdown.png`         | `Screenshot 2026-07-08 at 9.39.34 AM.png`  | Add weapon modal with simple weapon select dropdown open.                                |
| 41 | `02-editable-character-sheet/30-spells-page-overview.png`                             | `Screenshot 2026-07-08 at 9.39.44 AM.png`  | Spells page overview showing cantrips and first-level spell slots.                       |
| 42 | `02-editable-character-sheet/31-edit-spell-attack-and-dc-modal.png`                   | `Screenshot 2026-07-08 at 9.39.50 AM.png`  | Spell attack and spell DC edit modal.                                                    |
| 43 | `02-editable-character-sheet/32-edit-spellcasting-ability-and-progression-modal.png`  | `Screenshot 2026-07-08 at 9.39.56 AM.png`  | Spellcasting edit modal showing ability and progression controls.                        |
| 44 | `02-editable-character-sheet/33-edit-spellcasting-ability-dropdown-open.png`          | `Screenshot 2026-07-08 at 9.40.04 AM.png`  | Spellcasting edit modal with ability dropdown open.                                      |
| 45 | `02-editable-character-sheet/34-edit-caster-progression-dropdown-open.png`            | `Screenshot 2026-07-08 at 9.40.09 AM.png`  | Spellcasting edit modal with caster progression dropdown open.                           |
| 46 | `02-editable-character-sheet/35-character-details-features-top-section.png`           | `Screenshot 2026-07-08 at 9.40.30 AM.png`  | Character details page top section with class, race, background, and features.           |
| 47 | `02-editable-character-sheet/36-character-details-equipment-personality-section.png`  | `Screenshot 2026-07-08 at 9.40.36 AM.png`  | Character details page middle section with equipment and personality trait panels.       |
| 48 | `02-editable-character-sheet/37-main-menu-character-actions.png`                      | `Screenshot 2026-07-08 at 9.40.41 AM.png`  | Main menu opened with character actions including level up and import/export options.    |
| 49 | `02-editable-character-sheet/38-settings-page-layout-toggles-modal.png`               | `Screenshot 2026-07-08 at 9.40.56 AM.png`  | Settings/page layout modal with visible page toggles and reorder buttons.                |
| 50 | `02-editable-character-sheet/39-settings-restore-character-modal.png`                 | `Screenshot 2026-07-08 at 9.40.59 AM.png`  | Settings/restore character modal showing page toggles and restore options.               |
| 51 | `03-level-up-flow/01-level-up-choose-class-or-multiclass.png`                         | `Screenshot 2026-07-08 at 10.42.28 AM.png` | Level up dialog asking whether to level current class or multiclass.                     |
| 52 | `03-level-up-flow/02-level-up-class-dropdown-open.png`                                | `Screenshot 2026-07-08 at 10.42.34 AM.png` | Level up dialog with class dropdown open.                                                |
| 53 | `03-level-up-flow/03-level-up-wizard-archetype-selection.png`                         | `Screenshot 2026-07-08 at 10.42.48 AM.png` | Wizard archetype/subclass selection modal.                                               |
| 54 | `03-level-up-flow/04-level-up-wizard-hit-point-increase.png`                          | `Screenshot 2026-07-08 at 10.42.55 AM.png` | Wizard level-up hit point increase modal.                                                |
| 55 | `03-level-up-flow/05-level-up-next-class-or-multiclass-choice.png`                    | `Screenshot 2026-07-08 at 10.43.08 AM.png` | Next level-up dialog after wizard level, showing class or multiclass choice.             |
| 56 | `03-level-up-flow/06-level-up-fighter-fighting-style-empty.png`                       | `Screenshot 2026-07-08 at 10.43.15 AM.png` | Fighter fighting style selection modal before selection.                                 |
| 57 | `03-level-up-flow/07-level-up-fighter-fighting-style-list.png`                        | `Screenshot 2026-07-08 at 10.43.17 AM.png` | Fighter fighting style selection modal showing list of style options.                    |
| 58 | `03-level-up-flow/08-level-up-fighter-archery-style-selected.png`                     | `Screenshot 2026-07-08 at 10.43.23 AM.png` | Fighter fighting style selection modal with Archery selected and description visible.    |
| 59 | `03-level-up-flow/09-level-up-fighter-hit-point-increase.png`                         | `Screenshot 2026-07-08 at 10.43.26 AM.png` | Fighter level-up hit point increase modal.                                               |
| 60 | `03-level-up-flow/10-level-up-complete-wizard-2-fighter-1-overview.png`               | `Screenshot 2026-07-08 at 10.43.30 AM.png` | Main sheet after multiclass/level-up completion showing Wizard 2, Fighter 1.             |
| 61 | `03-level-up-flow/11-level-up-character-details-multiclass-top-section.png`           | `Screenshot 2026-07-08 at 10.43.39 AM.png` | Character details top section after leveling/multiclassing.                              |
| 62 | `03-level-up-flow/12-level-up-character-details-multiclass-equipment-section.png`     | `Screenshot 2026-07-08 at 10.43.46 AM.png` | Character details middle section after leveling/multiclassing.                           |
