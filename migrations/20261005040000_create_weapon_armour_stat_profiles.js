// Phase 2: weapon/armour stats & special-rule effects, transcribed from 1Rules.pdf
// ("Weapons & armour" chapter, plus the Dark Venom/Black Lotus weapon poisons and the
// Net entry from "Miscellaneous equipment").
//
// Four small reference tables are introduced:
//   - weapon_profiles           : close combat / missile / blackpowder weapon stat blocks
//   - armour_profiles           : armour / shield / helmet saving throws & rules
//   - weapon_material_modifiers : Ithilmar/Gromril weapon bonuses (apply on top of a base
//                                  weapon_profile; per 1Rules.pdf these only affect
//                                  hand-to-hand weapons, never missile/blackpowder weapons)
//   - weapon_poisons            : Black Lotus / Dark Venom weapon-coating effects
//
// `equipment_options` gets four nullable FK columns pointing at these tables so existing
// per-warband equipment rows can surface stats without duplicating data per warband.
//
// Mapping equipment_options.name -> profile is done with an explicit, manually reasoned
// lookup table (not fuzzy/algorithmic matching) so every alias decision is auditable:
//   - exact rulebook names map 1:1 (e.g. "Axe" -> Axe, "Sword" -> Sword)
//   - cosmetic prefix/suffix variants of a rulebook weapon map to the base profile
//     (e.g. "Battle Axe", "Dwarf Axe", "Stone Axe", "Great Axe of the Icefang" -> Axe or
//     Double-handed weapon; "Quarter staff", "Sigmarite warhammer" -> Hammer/staff/mace/club)
//   - Gromril-/Ithilmar-prefixed hand-to-hand weapons map to the base profile PLUS the
//     matching material modifier; Ithilmar/Gromril-prefixed missile weapons map to the base
//     missile profile only (no modifier), because 1Rules.pdf explicitly restricts both
//     material bonuses to hand-to-hand combat
//   - unique/supplement-specific named weapons (Beastlash, Katana, Rune Staff, Sunstaff,
//     Warplock pistol, Cutlass, Rapier, etc) are intentionally left unmapped: their stats
//     are not described in 1Rules.pdf, so inventing a mapping would risk misrepresenting them

const SOURCE = "1Rules.pdf — Weapons & armour";
const SOURCE_MISC = "1Rules.pdf — Miscellaneous equipment";

const weaponProfiles = [
  {
    name: "Fist",
    weapon_type: "close_combat",
    range_text: "Close Combat",
    strength_modifier: "As user -1",
    special_rules: [
      {
        name: "+1 Enemy armour save",
        description: "An enemy wounded by a fist gains a +1 bonus to his armour save, and a 6+ armour save if he normally has none.",
      },
    ],
    notes: "Only applies to warriors who have lost their weapons; a model fighting with fists can only ever make 1 attack.",
    source_reference: SOURCE,
  },
  {
    name: "Dagger",
    weapon_type: "close_combat",
    range_text: "Close Combat",
    strength_modifier: "As user",
    special_rules: [
      {
        name: "+1 Enemy armour save",
        description: "An enemy wounded by a dagger gains a +1 bonus to his armour save, and a 6+ armour save if he has none normally.",
      },
    ],
    notes: null,
    source_reference: SOURCE,
  },
  {
    name: "Hammer, staff, mace or club",
    weapon_type: "close_combat",
    range_text: "Close Combat",
    strength_modifier: "As user",
    special_rules: [
      {
        name: "Concussion",
        description: "When using a hammer, club or mace, a roll of 2-4 is treated as stunned when rolling to see the extent of a model's injuries.",
      },
    ],
    notes: null,
    source_reference: SOURCE,
  },
  {
    name: "Axe",
    weapon_type: "close_combat",
    range_text: "Close Combat",
    strength_modifier: "As user",
    special_rules: [
      {
        name: "Cutting edge",
        description: "An axe has an extra save modifier of -1, so a model with Strength 4 using an axe has a -2 save modifier when he hits an opponent in hand-to-hand combat.",
      },
    ],
    notes: null,
    source_reference: SOURCE,
  },
  {
    name: "Sword",
    weapon_type: "close_combat",
    range_text: "Close Combat",
    strength_modifier: "As user",
    special_rules: [
      {
        name: "Parry",
        description: "A model armed with a sword may parry blows. When his opponent rolls to hit, the model armed with a sword may roll a D6. If the score is greater than the highest to hit score of his opponent, the model has parried the blow, and that attack is discarded. A model may not parry attacks made with double or more its own Strength.",
      },
    ],
    notes: null,
    source_reference: SOURCE,
  },
  {
    name: "Flail",
    weapon_type: "close_combat",
    range_text: "Close Combat",
    strength_modifier: "As user +2",
    special_rules: [
      {
        name: "Heavy",
        description: "A flail is extremely tiring to use and thus the +2 Strength bonus applies only in the first turn of each hand-to-hand combat.",
      },
      {
        name: "Two-handed",
        description: "As a flail requires two hands to use, a model using a flail may not use a shield, buckler or additional weapon in close combat. If the model has a shield he still gets a +1 bonus to his armour save against shooting.",
      },
    ],
    notes: null,
    source_reference: SOURCE,
  },
  {
    name: "Morning star",
    weapon_type: "close_combat",
    range_text: "Close Combat",
    strength_modifier: "As user +1",
    special_rules: [
      {
        name: "Heavy",
        description: "The morning star is extremely tiring to use, so its +1 Strength bonus applies only in the first turn of each hand-to-hand combat.",
      },
      {
        name: "Difficult to use",
        description: "A model with a morning star may not use a second weapon or buckler in his other hand because it requires all his skill to wield it. He may carry a shield as normal though.",
      },
    ],
    notes: null,
    source_reference: SOURCE,
  },
  {
    name: "Halberd",
    weapon_type: "close_combat",
    range_text: "Close Combat",
    strength_modifier: "As user +1",
    special_rules: [
      {
        name: "Two-handed",
        description: "A model armed with a halberd may not use a shield, buckler or additional weapon in close combat. If the model has a shield he still gets a +1 bonus to his armour save against shooting.",
      },
    ],
    notes: null,
    source_reference: SOURCE,
  },
  {
    name: "Spear",
    weapon_type: "close_combat",
    range_text: "Close Combat",
    strength_modifier: "As user",
    special_rules: [
      {
        name: "Strike first",
        description: "A warrior with a spear strikes first in the first turn of hand-to-hand combat.",
      },
      {
        name: "Unwieldy",
        description: "A warrior with a spear may only use a shield or a buckler in his other hand. He may not use a second weapon.",
      },
      {
        name: "Cavalry bonus",
        description: "If using the rules for mounted models, a mounted warrior armed with a spear receives a +1 Strength bonus when he charges. This bonus only applies for that turn.",
      },
    ],
    notes: null,
    source_reference: SOURCE,
  },
  {
    name: "Lance",
    weapon_type: "close_combat",
    range_text: "Close Combat",
    strength_modifier: "As user +2",
    special_rules: [
      {
        name: "Cavalry weapon",
        description: "A warrior must own a warhorse to use a lance, as it can only be used whilst he is on horseback.",
      },
      {
        name: "Cavalry bonus",
        description: "If using optional rules for mounted models, a warrior armed with a lance receives a +2 Strength bonus when he charges. This bonus only applies for that turn.",
      },
    ],
    notes: null,
    source_reference: SOURCE,
  },
  {
    name: "Double-handed weapon",
    weapon_type: "close_combat",
    range_text: "Close Combat",
    strength_modifier: "As user +2",
    special_rules: [
      {
        name: "Two-handed",
        description: "A model armed with a double-handed weapon may not use a shield, buckler or additional weapon in close combat. If the model is equipped with a shield he will still get a +1 bonus to his armour save against shooting.",
      },
      {
        name: "Strike last",
        description: "Double-handed weapons are so heavy that the model using them always strikes last, even when charging.",
      },
    ],
    notes: "Covers double-handed swords, hammers, axes, etc (\"Double-handed sword, hammer, axe, etc\" per 1Rules.pdf).",
    source_reference: SOURCE,
  },
  {
    name: "Short bow",
    weapon_type: "missile",
    range_text: "16\"",
    strength_modifier: "3",
    special_rules: [],
    notes: null,
    source_reference: SOURCE,
  },
  {
    name: "Bow",
    weapon_type: "missile",
    range_text: "24\"",
    strength_modifier: "3",
    special_rules: [],
    notes: null,
    source_reference: SOURCE,
  },
  {
    name: "Long bow",
    weapon_type: "missile",
    range_text: "30\"",
    strength_modifier: "3",
    special_rules: [],
    notes: null,
    source_reference: SOURCE,
  },
  {
    name: "Elf bow",
    weapon_type: "missile",
    range_text: "36\"",
    strength_modifier: "3",
    special_rules: [
      {
        name: "Save modifier",
        description: "An Elf bow has a -1 save modifier on armour saves against it.",
      },
    ],
    notes: null,
    source_reference: SOURCE,
  },
  {
    name: "Crossbow",
    weapon_type: "missile",
    range_text: "30\"",
    strength_modifier: "4",
    special_rules: [
      {
        name: "Move or fire",
        description: "You may not move and fire a crossbow on the same turn, other than to pivot on the spot to face your target or to stand up.",
      },
    ],
    notes: null,
    source_reference: SOURCE,
  },
  {
    name: "Sling",
    weapon_type: "missile",
    range_text: "18\"",
    strength_modifier: "3",
    special_rules: [
      {
        name: "Fire twice at half range",
        description: "A slinger may fire twice in the shooting phase if he does not move in the movement phase. He cannot shoot over half range (9\") though, if he fires twice. If the model fires twice then each shot is at -1 to hit.",
      },
    ],
    notes: null,
    source_reference: SOURCE,
  },
  {
    name: "Throwing star/knife",
    weapon_type: "missile",
    range_text: "6\"",
    strength_modifier: "As user",
    special_rules: [
      {
        name: "Thrown weapon",
        description: "Models using throwing stars or knives do not suffer penalties for range or moving as these weapons are perfectly balanced for throwing. They cannot be used in close combat.",
      },
    ],
    notes: null,
    source_reference: SOURCE,
  },
  {
    name: "Repeater crossbow",
    weapon_type: "missile",
    range_text: "24\"",
    strength_modifier: "3",
    special_rules: [
      {
        name: "Fire twice",
        description: "A model armed with a repeater crossbow may choose to fire twice per turn with an extra -1 to hit penalty on both shots.",
      },
    ],
    notes: null,
    source_reference: SOURCE,
  },
  {
    name: "Crossbow pistol",
    weapon_type: "missile",
    range_text: "10\"",
    strength_modifier: "4",
    special_rules: [
      {
        name: "Shoot in hand-to-hand combat",
        description: "A model armed with a crossbow pistol may shoot it in the first round of a hand-to-hand combat and this shot is always resolved first, before any blows are struck. This shot has an extra -2 to hit penalty. Use the model's Ballistic Skill to see whether it hits or not. This bonus attack is in addition to any close combat weapon attacks.",
      },
    ],
    notes: null,
    source_reference: SOURCE,
  },
  {
    name: "Pistol",
    weapon_type: "blackpowder",
    range_text: "6\"",
    strength_modifier: "4",
    special_rules: [
      {
        name: "Prepare shot",
        description: "A pistol takes a whole turn to reload, so you may only fire every other turn. If you have a brace of pistols (ie, two) you may fire every turn.",
      },
      {
        name: "Save modifier",
        description: "Pistols are even better at penetrating armour than their Strength value of 4 suggests. A model wounded by a pistol must take its armour save with a -2 modifier.",
      },
      {
        name: "Hand-to-hand",
        description: "Pistols can be used in hand-to-hand combat as well as for shooting. A model armed with a pistol and another close combat weapon gains +1 Attack, resolved at Strength 4 with a -2 save modifier, usable only once per combat. With a brace of pistols, the model can fight with 2 Attacks in the first turn of close combat, resolved with WS like normal close combat attacks and may be parried; successful hits are at Strength 4 with a -2 save modifier regardless of the firer's Strength.",
      },
    ],
    notes: null,
    source_reference: SOURCE,
  },
  {
    name: "Duelling pistol",
    weapon_type: "blackpowder",
    range_text: "10\"",
    strength_modifier: "4",
    special_rules: [
      {
        name: "Accuracy",
        description: "A duelling pistol is built for accuracy. All shots and close combat attacks from a duelling pistol have a +1 bonus to hit.",
      },
      {
        name: "Prepare shot",
        description: "A duelling pistol takes a complete turn to reload, so your model may only fire every other turn. With a brace of duelling pistols he may fire every turn.",
      },
      {
        name: "Save modifier",
        description: "A warrior wounded by a duelling pistol must make his armour save with a -2 modifier.",
      },
      {
        name: "Hand-to-hand",
        description: "Duelling pistols can be used in hand-to-hand combat as well as for shooting. A model armed with a duelling pistol and another close combat weapon gains +1 Attack, resolved at Strength 4 with a -2 save modifier, usable only once per combat. With a brace of duelling pistols, the model can fight with 2 Attacks in the first turn of close combat, resolved with WS like normal close combat attacks and may be parried; successful hits are at Strength 4 with a -2 save modifier regardless of the firer's Strength.",
      },
    ],
    notes: null,
    source_reference: SOURCE,
  },
  {
    name: "Blunderbuss",
    weapon_type: "blackpowder",
    range_text: "Special",
    strength_modifier: "3",
    special_rules: [
      {
        name: "Shot",
        description: "When your model fires the blunderbuss, draw a line 16\" long and 1\" wide in any direction from the firer (the line must be absolutely straight). Any and all models in its path are automatically hit by a Strength 3 hit.",
      },
      {
        name: "Fire Once",
        description: "It takes a very long time to load a blunderbuss so it may only be fired once per battle.",
      },
    ],
    notes: null,
    source_reference: SOURCE,
  },
  {
    name: "Handgun",
    weapon_type: "blackpowder",
    range_text: "24\"",
    strength_modifier: "4",
    special_rules: [
      {
        name: "Prepare shot",
        description: "A handgun takes a complete turn to reload, so you may only fire it every other turn.",
      },
      {
        name: "Move or fire",
        description: "You may not move and fire a handgun in the same turn, other than to pivot on the spot to face your target or stand up.",
      },
      {
        name: "Save modifier",
        description: "A warrior wounded by a handgun must take its armour save with a -2 modifier.",
      },
    ],
    notes: null,
    source_reference: SOURCE,
  },
  {
    name: "Hochland long rifle",
    weapon_type: "blackpowder",
    range_text: "48\"",
    strength_modifier: "4",
    special_rules: [
      {
        name: "Move or fire",
        description: "You may not move and fire a Hochland long rifle in the same turn, other than to pivot on the spot to face your target or stand up from knocked down.",
      },
      {
        name: "Prepare shot",
        description: "A Hochland long rifle takes a complete turn to reload, so you may only fire it every other turn.",
      },
      {
        name: "Pick target",
        description: "A model armed with a Hochland long rifle can target any enemy model in sight, not just the closest one.",
      },
      {
        name: "Save modifier",
        description: "A warrior wounded by a long rifle must make his armour save with a -2 modifier.",
      },
    ],
    notes: null,
    source_reference: SOURCE,
  },
  {
    name: "Net",
    weapon_type: "special",
    range_text: "8\"",
    strength_modifier: "N/A (entangles on a hit)",
    special_rules: [
      {
        name: "Entangle",
        description: "Once per game, the net may be thrown in the shooting phase instead of shooting a missile weapon. Treat the net as a missile weapon in all respects with a range of 8\". Use the model's BS to determine whether the net hits - there are no movement or range penalties. If it hits, the target must immediately roll a D6. If the result is equal to, or lower than, his Strength, he rips the net apart. If higher, he may not move, shoot or cast spells in his next turn, although he is not otherwise affected. In either case the net is lost.",
      },
    ],
    notes: null,
    source_reference: SOURCE_MISC,
  },
];

const armourProfiles = [
  {
    name: "Light armour",
    item_type: "armour",
    save_text: "6+",
    movement_penalty: null,
    special_rules: [],
    source_reference: SOURCE,
  },
  {
    name: "Heavy armour",
    item_type: "armour",
    save_text: "5+",
    movement_penalty: "-1 Movement if also armed with a shield.",
    special_rules: [],
    source_reference: SOURCE,
  },
  {
    name: "Ithilmar armour",
    item_type: "armour",
    save_text: "5+",
    movement_penalty: null,
    special_rules: [],
    notes: "Does not slow the wearer down if also armed with a shield.",
    source_reference: SOURCE,
  },
  {
    name: "Gromril armour",
    item_type: "armour",
    save_text: "4+",
    movement_penalty: null,
    special_rules: [],
    notes: "Does not slow the wearer down if also armed with a shield.",
    source_reference: SOURCE,
  },
  {
    name: "Shield",
    item_type: "shield",
    save_text: "6+",
    movement_penalty: null,
    special_rules: [],
    source_reference: SOURCE,
  },
  {
    name: "Buckler",
    item_type: "shield",
    save_text: null,
    movement_penalty: null,
    special_rules: [
      {
        name: "Parry",
        description: "A model equipped with a buckler may parry the first blow in each round of hand-to-hand combat. When his opponent scores a hit, a model with a buckler may roll 1D6. If the score is greater than the highest to hit score of his opponent, the model has parried the blow, and that attack is discarded. A model may not parry attacks made with double or more its own Strength.",
      },
    ],
    source_reference: SOURCE,
  },
  {
    name: "Helmet",
    item_type: "helmet",
    save_text: null,
    movement_penalty: null,
    special_rules: [
      {
        name: "Avoid stun",
        description: "A model that is equipped with a helmet has a special 4+ save on a D6 against being stunned. If the save is made, treat the stunned result as knocked down instead. This save is not modified by the opponent's Strength.",
      },
    ],
    source_reference: SOURCE,
  },
];

const materialModifiers = [
  {
    name: "Ithilmar weapon",
    effect_text: "An ithilmar weapon gives its user +1 Initiative in hand-to-hand combat, and costs three times the price of a normal weapon of its kind.",
    cost_multiplier: 3,
    applies_to: "hand_to_hand_only",
    source_reference: SOURCE,
  },
  {
    name: "Gromril weapon",
    effect_text: "A gromril weapon has an extra -1 save modifier, and costs four times the price of a normal weapon of its kind.",
    cost_multiplier: 4,
    applies_to: "hand_to_hand_only",
    source_reference: SOURCE,
  },
];

const weaponPoisons = [
  {
    name: "Black Lotus",
    effect_text: "A weapon coated with the sap of the Black Lotus will wound its target automatically if you roll a 6 to hit. You still roll a dice for every wound inflicted this way; a 6 causes a critical hit, otherwise a normal wound. Take armour saves as normal.",
    source_reference: SOURCE_MISC,
  },
  {
    name: "Dark Venom",
    effect_text: "Any hit caused by a weapon coated with Dark Venom counts as having +1 Strength (eg, a Strength 3 warrior wielding a poisoned sword causes a Strength 4 hit instead). Armour saving throws are modified to take into account the increased Strength of the attack.",
    source_reference: SOURCE_MISC,
  },
];

// equipment_options.name (exact, as currently stored) -> mapping decision.
// weaponProfile/armourProfile reference the `name` keys above; materialModifier is only
// ever paired with a weaponProfile (hand-to-hand weapons only, per 1Rules.pdf).
const weaponNameMap = {
  "Axe": { weaponProfile: "Axe" },
  "Battle Axe": { weaponProfile: "Axe" },
  "Battle axe": { weaponProfile: "Axe" },
  "Club": { weaponProfile: "Hammer, staff, mace or club" },
  "Crossbow": { weaponProfile: "Crossbow" },
  "Crossbow Pistol": { weaponProfile: "Crossbow pistol" },
  "Crossbow pistol": { weaponProfile: "Crossbow pistol" },
  "Dagger": { weaponProfile: "Dagger" },
  "Double-handed Axe": { weaponProfile: "Double-handed weapon" },
  "Double-handed Weapon": { weaponProfile: "Double-handed weapon" },
  "Double-handed weapon": { weaponProfile: "Double-handed weapon" },
  "Duelling Pistol": { weaponProfile: "Duelling pistol" },
  "Duelling pistol": { weaponProfile: "Duelling pistol" },
  "Dwarf Axe": { weaponProfile: "Axe" },
  "Dwarf axe": { weaponProfile: "Axe" },
  "Elf Bow": { weaponProfile: "Elf bow" },
  "Flail": { weaponProfile: "Flail" },
  "Great Axe of the Icefang": { weaponProfile: "Double-handed weapon" },
  "Great axe": { weaponProfile: "Double-handed weapon" },
  "Gromril axe": { weaponProfile: "Axe", materialModifier: "Gromril weapon" },
  "Gromril dagger": { weaponProfile: "Dagger", materialModifier: "Gromril weapon" },
  "Gromril double-handed weapon": { weaponProfile: "Double-handed weapon", materialModifier: "Gromril weapon" },
  "Gromril dwarf axe": { weaponProfile: "Axe", materialModifier: "Gromril weapon" },
  "Gromril halberd": { weaponProfile: "Halberd", materialModifier: "Gromril weapon" },
  "Gromril hammer": { weaponProfile: "Hammer, staff, mace or club", materialModifier: "Gromril weapon" },
  "Gromril mace": { weaponProfile: "Hammer, staff, mace or club", materialModifier: "Gromril weapon" },
  "Gromril spear": { weaponProfile: "Spear", materialModifier: "Gromril weapon" },
  "Gromril sword": { weaponProfile: "Sword", materialModifier: "Gromril weapon" },
  "Halberd": { weaponProfile: "Halberd" },
  "Hammer": { weaponProfile: "Hammer, staff, mace or club" },
  "Hammer/Mace": { weaponProfile: "Hammer, staff, mace or club" },
  "Handgun": { weaponProfile: "Handgun" },
  "Horseman's Hammer": { weaponProfile: "Hammer, staff, mace or club" },
  "Ithilmar Elf Bow": { weaponProfile: "Elf bow" },
  "Ithilmar bow": { weaponProfile: "Bow" },
  "Ithilmar dagger": { weaponProfile: "Dagger", materialModifier: "Ithilmar weapon" },
  "Ithilmar double-handed weapon": { weaponProfile: "Double-handed weapon", materialModifier: "Ithilmar weapon" },
  "Ithilmar longbow": { weaponProfile: "Long bow" },
  "Ithilmar spear": { weaponProfile: "Spear", materialModifier: "Ithilmar weapon" },
  "Ithilmar sword": { weaponProfile: "Sword", materialModifier: "Ithilmar weapon" },
  "Lance": { weaponProfile: "Lance" },
  "Long bow": { weaponProfile: "Long bow" },
  "Longbow": { weaponProfile: "Long bow" },
  "Mace": { weaponProfile: "Hammer, staff, mace or club" },
  "Mace/Hammer": { weaponProfile: "Hammer, staff, mace or club" },
  "Mace/hammer": { weaponProfile: "Hammer, staff, mace or club" },
  "Morning Star": { weaponProfile: "Morning star" },
  "Morning star": { weaponProfile: "Morning star" },
  "Pistol": { weaponProfile: "Pistol" },
  "Brace of Pistols": { weaponProfile: "Pistol" },
  "Poison daggers": { weaponProfile: "Dagger" },
  "Quarter staff": { weaponProfile: "Hammer, staff, mace or club" },
  "Repeater crossbow": { weaponProfile: "Repeater crossbow" },
  "Repeating Crossbow": { weaponProfile: "Repeater crossbow" },
  "Short Bow": { weaponProfile: "Short bow" },
  "Short bow": { weaponProfile: "Short bow" },
  "Shortbow": { weaponProfile: "Short bow" },
  "Sigmarite warhammer": { weaponProfile: "Hammer, staff, mace or club" },
  "Sling": { weaponProfile: "Sling" },
  "Spear": { weaponProfile: "Spear" },
  "Staff": { weaponProfile: "Hammer, staff, mace or club" },
  "Stone Axe": { weaponProfile: "Axe" },
  "Sword": { weaponProfile: "Sword" },
  "Throwing Axe": { weaponProfile: "Throwing star/knife" },
  "Throwing Daggers": { weaponProfile: "Throwing star/knife" },
  "Throwing Knives": { weaponProfile: "Throwing star/knife" },
  "Throwing axes": { weaponProfile: "Throwing star/knife" },
  "Throwing knives": { weaponProfile: "Throwing star/knife" },
  "Throwing stars": { weaponProfile: "Throwing star/knife" },
  "Blunderbuss": { weaponProfile: "Blunderbuss" },
  "Bow": { weaponProfile: "Bow" },
};

const armourNameMap = {
  "Heavy Armour": { armourProfile: "Heavy armour" },
  "Heavy armour": { armourProfile: "Heavy armour" },
  "Light Armour": { armourProfile: "Light armour" },
  "Light armour": { armourProfile: "Light armour" },
  "Gromril armour": { armourProfile: "Gromril armour" },
  "Ithilmar armour": { armourProfile: "Ithilmar armour" },
  "Helmet": { armourProfile: "Helmet" },
};

const shieldNameMap = {
  "Shield": { armourProfile: "Shield" },
  "Buckler": { armourProfile: "Buckler" },
};

const setNameMap = {
  "Net": { weaponProfile: "Net" },
  "Dark Venom": { weaponPoison: "Dark Venom" },
};

exports.up = async function up(knex) {
  await knex.schema.createTable("weapon_profiles", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("name", 255).notNullable().unique();
    table.string("weapon_type", 32).notNullable();
    table.string("range_text", 64).notNullable();
    table.string("strength_modifier", 64).notNullable();
    table.jsonb("special_rules").notNullable().defaultTo("[]");
    table.text("notes");
    table.text("source_reference").notNullable();
    table.timestamps(true, true);
  });

  await knex.schema.createTable("armour_profiles", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("name", 255).notNullable().unique();
    table.string("item_type", 32).notNullable();
    table.string("save_text", 16);
    table.text("movement_penalty");
    table.jsonb("special_rules").notNullable().defaultTo("[]");
    table.text("notes");
    table.text("source_reference").notNullable();
    table.timestamps(true, true);
  });

  await knex.schema.createTable("weapon_material_modifiers", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("name", 255).notNullable().unique();
    table.text("effect_text").notNullable();
    table.integer("cost_multiplier").notNullable();
    table.string("applies_to", 32).notNullable();
    table.text("source_reference").notNullable();
    table.timestamps(true, true);
  });

  await knex.schema.createTable("weapon_poisons", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("name", 255).notNullable().unique();
    table.text("effect_text").notNullable();
    table.text("source_reference").notNullable();
    table.timestamps(true, true);
  });

  await knex.schema.alterTable("equipment_options", (table) => {
    table.uuid("weapon_profile_id").references("id").inTable("weapon_profiles").onDelete("SET NULL");
    table.uuid("armour_profile_id").references("id").inTable("armour_profiles").onDelete("SET NULL");
    table.uuid("material_modifier_id").references("id").inTable("weapon_material_modifiers").onDelete("SET NULL");
    table.uuid("weapon_poison_id").references("id").inTable("weapon_poisons").onDelete("SET NULL");
  });

  await knex("weapon_profiles").insert(weaponProfiles.map((profile) => ({
    name: profile.name,
    weapon_type: profile.weapon_type,
    range_text: profile.range_text,
    strength_modifier: profile.strength_modifier,
    special_rules: JSON.stringify(profile.special_rules),
    notes: profile.notes || null,
    source_reference: profile.source_reference,
  })));

  await knex("armour_profiles").insert(armourProfiles.map((profile) => ({
    name: profile.name,
    item_type: profile.item_type,
    save_text: profile.save_text,
    movement_penalty: profile.movement_penalty,
    special_rules: JSON.stringify(profile.special_rules),
    notes: profile.notes || null,
    source_reference: profile.source_reference,
  })));

  await knex("weapon_material_modifiers").insert(materialModifiers.map((modifier) => ({
    name: modifier.name,
    effect_text: modifier.effect_text,
    cost_multiplier: modifier.cost_multiplier,
    applies_to: modifier.applies_to,
    source_reference: modifier.source_reference,
  })));

  await knex("weapon_poisons").insert(weaponPoisons.map((poison) => ({
    name: poison.name,
    effect_text: poison.effect_text,
    source_reference: poison.source_reference,
  })));

  const weaponRows = await knex("weapon_profiles").select("id", "name");
  const weaponIdByName = new Map(weaponRows.map((row) => [row.name, row.id]));
  const armourRows = await knex("armour_profiles").select("id", "name");
  const armourIdByName = new Map(armourRows.map((row) => [row.name, row.id]));
  const modifierRows = await knex("weapon_material_modifiers").select("id", "name");
  const modifierIdByName = new Map(modifierRows.map((row) => [row.name, row.id]));
  const poisonRows = await knex("weapon_poisons").select("id", "name");
  const poisonIdByName = new Map(poisonRows.map((row) => [row.name, row.id]));

  const allMaps = [
    { nameMap: weaponNameMap, category: "weapon" },
    { nameMap: armourNameMap, category: "armour" },
    { nameMap: shieldNameMap, category: "shield" },
    { nameMap: setNameMap, category: "set" },
  ];

  for (const { nameMap, category } of allMaps) {
    for (const [equipmentName, mapping] of Object.entries(nameMap)) {
      const update = {};
      if (mapping.weaponProfile) update.weapon_profile_id = weaponIdByName.get(mapping.weaponProfile) || null;
      if (mapping.armourProfile) update.armour_profile_id = armourIdByName.get(mapping.armourProfile) || null;
      if (mapping.materialModifier) update.material_modifier_id = modifierIdByName.get(mapping.materialModifier) || null;
      if (mapping.weaponPoison) update.weapon_poison_id = poisonIdByName.get(mapping.weaponPoison) || null;
      if (Object.keys(update).length === 0) continue;
      await knex("equipment_options").where({ category, name: equipmentName }).update(update);
    }
  }
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("equipment_options", (table) => {
    table.dropColumn("weapon_profile_id");
    table.dropColumn("armour_profile_id");
    table.dropColumn("material_modifier_id");
    table.dropColumn("weapon_poison_id");
  });
  await knex.schema.dropTableIfExists("weapon_poisons");
  await knex.schema.dropTableIfExists("weapon_material_modifiers");
  await knex.schema.dropTableIfExists("armour_profiles");
  await knex.schema.dropTableIfExists("weapon_profiles");
};
