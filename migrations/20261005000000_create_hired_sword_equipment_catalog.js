// Hired Swords are hired by many different warbands (see 20261003020000_correct_hired_sword_eligibility.js),
// so their starting gear cannot live under any single warband's equipment_lists/equipment_options rows
// (those are scoped by warband_id). Instead we anchor a warband-agnostic catalog to a hidden
// "Hired Sword Armoury" warband row (is_available = false, never selectable for a roster) and link each
// Hired Sword warrior type (and, where relevant, a specific equipment_choices option) to the catalog items
// it starts with via a dedicated join table, hired_sword_starting_gear.
const ARMOURY_WARBAND_NAME = "Hired Sword Armoury";
const LIST_KEY = "hired-sword-gear";
const LIST_SOURCE = "20261004240000/20261004250000 Hired Sword starting gear migrations — consolidated equipment catalog";

// Canonical catalog items referenced by the Hired Sword starting-gear table below. Keeping a single row
// per item name means Phase 2 (weapon stats/effects) only has to annotate one place per weapon.
const items = [
  ["Sword", "weapon"],
  ["Dagger", "weapon"],
  ["Net", "set"],
  ["Light Armour", "armour"],
  ["Hunting Rifle", "weapon"],
  ["Longbow", "weapon"],
  ["Rope and Hook", "set"],
  ["Healing Herbs", "set"],
  ["Great Axe of the Icefang", "weapon"],
  ["Sabertooth Tiger Hide", "armour"],
  ["Throwing Daggers", "weapon"],
  ["Crossbow Pistol", "weapon"],
  ["Crossbow", "weapon"],
  ["Shield", "shield"],
  ["Dark Elf Blade", "weapon"],
  ["Repeating Crossbow", "weapon"],
  ["Dark Venom", "set"],
  ["Dark Cloak", "armour"],
  ["Blowpipe with Poison Darts", "weapon"],
  ["Buckler", "shield"],
  ["Rune Staff", "weapon"],
  ["Axe", "weapon"],
  ["Club", "weapon"],
  ["Double-handed Weapon", "weapon"],
  ["Double-handed Axe", "weapon"],
  ["Morning Star", "weapon"],
  ["Spiked Gauntlet", "weapon"],
  ["Helmet", "armour"],
  ["Bow", "weapon"],
  ["Cooking Pot", "armour"],
  ["Staff", "weapon"],
  ["Heavy Armour", "armour"],
  ["Lance", "weapon"],
  ["Warhorse", "set"],
  ["Elf Bow", "weapon"],
  ["Elven Cloak", "armour"],
  ["Throwing Axe", "weapon"],
  ["Skull Rack", "set"],
  ["Brace of Pistols", "weapon"],
  ["Rapier", "weapon"],
  ["Highwayman's Cloak", "shield"],
  ["Horse", "set"],
  ["Horseman's Hammer", "weapon"],
  ["Torch", "set"],
  ["Wolf Cloak", "armour"],
];

// [warriorTypeName, equipmentChoiceId | null, [[itemName, quantity, note?], ...]]
const startingGear = [
  ["Big Game Hunter", null, [["Sword", 1], ["Dagger", 1], ["Net", 1], ["Light Armour", 1], ["Hunting Rifle", 1]]],
  ["Chameleon Skink Pathfinder", null, [["Sword", 1], ["Dagger", 1], ["Longbow", 1], ["Rope and Hook", 1], ["Healing Herbs", 1]]],
  ["Drenok", null, [["Great Axe of the Icefang", 1], ["Sabertooth Tiger Hide", 1]]],
  ["Imperial Assassin", null, [["Sword", 1], ["Dagger", 1], ["Throwing Daggers", 1], ["Crossbow Pistol", 1]]],
  ["Tilean Marksman", null, [["Light Armour", 1], ["Sword", 1], ["Dagger", 1], ["Crossbow", 1]]],
  ["Shadow Warrior (Hired Sword)", null, [["Sword", 1], ["Longbow", 1], ["Dagger", 1], ["Shield", 1], ["Light Armour", 1]]],
  ["Dark Elf Assassin", null, [["Dark Elf Blade", 1], ["Dagger", 1], ["Repeating Crossbow", 1], ["Dark Venom", 1], ["Light Armour", 1], ["Dark Cloak", 1]]],
  ["Chameleon Skink", null, [["Dagger", 1], ["Blowpipe with Poison Darts", 1], ["Buckler", 1]]],
  ["Norse Shaman", "rune-staff-sword", [["Rune Staff", 1], ["Sword", 1]]],
  ["Norse Shaman", "rune-staff-axe", [["Rune Staff", 1], ["Axe", 1]]],
  ["Ogre Bodyguard", "two-swords", [["Sword", 2], ["Light Armour", 1]]],
  ["Ogre Bodyguard", "two-axes", [["Axe", 2], ["Light Armour", 1]]],
  ["Ogre Bodyguard", "two-clubs", [["Club", 2], ["Light Armour", 1]]],
  ["Ogre Bodyguard", "sword-axe", [["Sword", 1], ["Axe", 1], ["Light Armour", 1]]],
  ["Ogre Bodyguard", "sword-club", [["Sword", 1], ["Club", 1], ["Light Armour", 1]]],
  ["Ogre Bodyguard", "axe-club", [["Axe", 1], ["Club", 1], ["Light Armour", 1]]],
  ["Ogre Bodyguard", "double-handed", [["Double-handed Weapon", 1], ["Light Armour", 1]]],
  ["Dwarf Troll Slayer (HS)", "two-axes", [["Axe", 2]]],
  ["Dwarf Troll Slayer (HS)", "double-handed-axe", [["Double-handed Axe", 1]]],
  ["Pit Fighter", null, [["Morning Star", 1], ["Spiked Gauntlet", 1], ["Helmet", 1]]],
  ["Halfling Scout (HS)", null, [["Bow", 1], ["Dagger", 1], ["Cooking Pot", 1, "Counts as a helmet."]]],
  ["Warlock (HS)", null, [["Staff", 1]]],
  ["Freelancer", null, [["Heavy Armour", 1], ["Shield", 1], ["Lance", 1], ["Sword", 1], ["Warhorse", 1]]],
  ["Elf Ranger", null, [["Elf Bow", 1], ["Sword", 1], ["Elven Cloak", 1]]],
  ["Beast Hunter", null, [["Axe", 2], ["Throwing Axe", 1], ["Light Armour", 1], ["Skull Rack", 1]]],
  ["Highwayman", null, [["Brace of Pistols", 1], ["Rapier", 1], ["Highwayman's Cloak", 1, "Acts as a buckler."], ["Dagger", 1], ["Horse", 1]]],
  ["Roadwarden", null, [["Crossbow", 1], ["Horseman's Hammer", 1], ["Dagger", 1], ["Heavy Armour", 1], ["Torch", 3], ["Horse", 1]]],
  // Wolf Priest of Ulric's weapon is not a fixed starting item — the source text only restricts him to
  // "source-permitted blunt weapons and dagger" without granting one for free, so only the included cloak
  // is modeled structurally; the weapon restriction remains a manual/notes matter for the player.
  ["Wolf Priest of Ulric", null, [["Wolf Cloak", 1, "Included. May only use source-permitted blunt weapons and a dagger."]]],
];

exports.up = async function up(knex) {
  let [armoury] = await knex("warbands").where({ name: ARMOURY_WARBAND_NAME }).select("id");
  if (!armoury) {
    [armoury] = await knex("warbands")
      .insert({
        name: ARMOURY_WARBAND_NAME,
        source_reference: "Internal catalog anchor — not a playable warband. Hired Swords are hired across many warbands, so their gear is stored here instead of under a single warband.",
        is_available: false,
      })
      .returning(["id"]);
  }
  const armouryId = armoury.id;

  const existingList = await knex("equipment_lists").where({ warband_id: armouryId, list_key: LIST_KEY }).first();
  if (!existingList) {
    await knex("equipment_lists").insert({
      warband_id: armouryId,
      list_key: LIST_KEY,
      name: "Hired Sword Starting Gear",
      source_reference: LIST_SOURCE,
    });
  }

  const itemIdByName = new Map();
  for (const [name, category] of items) {
    let [option] = await knex("equipment_options").where({ warband_id: armouryId, list_key: LIST_KEY, name }).select("id");
    if (!option) {
      [option] = await knex("equipment_options")
        .insert({
          warband_id: armouryId,
          list_key: LIST_KEY,
          name,
          category,
          unit_cost: 0,
          first_free: true,
          source_reference: LIST_SOURCE,
        })
        .returning(["id"]);
    }
    itemIdByName.set(name, option.id);
  }

  await knex.schema.createTable("hired_sword_starting_gear", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("warrior_type_id").notNullable().references("id").inTable("warrior_types").onDelete("CASCADE");
    table.string("equipment_choice_id").nullable();
    table.uuid("equipment_option_id").notNullable().references("id").inTable("equipment_options").onDelete("RESTRICT");
    table.integer("quantity").notNullable().defaultTo(1);
    table.text("note").nullable();
    table.check("quantity > 0");
    table.index(["warrior_type_id", "equipment_choice_id"]);
  });

  const rows = [];
  for (const [typeName, choiceId, gear] of startingGear) {
    const warriorType = await knex("warrior_types").where({ name: typeName, category: "Hired Sword" }).first("id");
    if (!warriorType) throw new Error(`Hired Sword type is missing from the catalog: ${typeName}`);
    for (const [itemName, quantity, note] of gear) {
      const equipmentOptionId = itemIdByName.get(itemName);
      if (!equipmentOptionId) throw new Error(`Hired Sword gear item is missing from the catalog: ${itemName}`);
      rows.push({
        warrior_type_id: warriorType.id,
        equipment_choice_id: choiceId,
        equipment_option_id: equipmentOptionId,
        quantity,
        note: note ?? null,
      });
    }
  }
  if (rows.length) await knex("hired_sword_starting_gear").insert(rows);
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("hired_sword_starting_gear");
  const armoury = await knex("warbands").where({ name: ARMOURY_WARBAND_NAME }).first("id");
  if (armoury) {
    await knex("equipment_options").where({ warband_id: armoury.id, list_key: LIST_KEY }).delete();
    await knex("equipment_lists").where({ warband_id: armoury.id, list_key: LIST_KEY }).delete();
    await knex("warbands").where({ id: armoury.id }).delete();
  }
};
