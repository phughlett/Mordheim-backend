const caps = [
  ["Mercenaries", "Hero", "Mercenary Captain", 1, [], 1, "2Warbands.pdf — Choice of Warriors"],
  ["Mercenaries", "Hero", "Champions (Mercenaries & Amazons)", 2, [], 1, "2Warbands.pdf — Choice of Warriors"],
  ["Mercenaries", "Hero", "Youngblood", 2, [], 1, "2Warbands.pdf — Choice of Warriors"],
  ["Mercenaries", "Henchman", "Marksmen (All Others)", 7, [], 1, "2Warbands.pdf — Choice of Warriors"],
  ["Mercenaries", "Henchman", "Swordsmen", 5, [], 1, "2Warbands.pdf — Choice of Warriors"],

  ["Cult of the Possessed", "Hero", "Magister", 1, [], 1, "2Warbands.pdf — Choice of Warriors"],
  ["Cult of the Possessed", "Hero", "The Possessed", 2, [], 1, "2Warbands.pdf — Choice of Warriors"],
  ["Cult of the Possessed", "Hero", "Mutants", 2, [], 1, "2Warbands.pdf — Choice of Warriors"],
  ["Cult of the Possessed", "Henchman", "Darksouls", 5, [], 1, "2Warbands.pdf — Choice of Warriors"],
  ["Cult of the Possessed", "Henchman", "Beastmen", 3, [], 1, "2Warbands.pdf — Choice of Warriors"],

  ["Sisters of Sigmar", "Hero", "Sigmarite Matriarch", 1, [], 1, "2Warbands.pdf — Choice of Warriors"],
  ["Sisters of Sigmar", "Hero", "Sister Superior", 3, [], 1, "2Warbands.pdf — Choice of Warriors"],
  ["Sisters of Sigmar", "Hero", "Augur", 1, [], 1, "2Warbands.pdf — Choice of Warriors"],
  ["Sisters of Sigmar", "Henchman", "Novices", 10, [], 1, "2Warbands.pdf — Choice of Warriors"],

  ["Undead", "Hero", "Vampire", 1, [], 1, "2Warbands.pdf — Choice of Warriors"],
  ["Undead", "Hero", "Necromancer (Lahmia & Undead))", 1, [], 1, "2Warbands.pdf — Choice of Warriors"],
  ["Undead", "Hero", "Dregs", 3, [], 1, "2Warbands.pdf — Choice of Warriors"],
  ["Undead", "Henchman", "Dire Wolves", 5, [], 1, "2Warbands.pdf — Choice of Warriors"],

  ["Skaven", "Hero", "Assassin Adept", 1, [], 1, "2Warbands.pdf — Choice of Warriors"],
  ["Skaven", "Hero", "Eshin Sorcerer", 1, [], 1, "2Warbands.pdf — Choice of Warriors"],
  ["Skaven", "Hero", "Black Skaven", 2, [], 1, "2Warbands.pdf — Choice of Warriors"],
  ["Skaven", "Hero", "Night Runners", 2, [], 1, "2Warbands.pdf — Choice of Warriors"],
  ["Skaven", "Henchman", "Rat Ogre", 1, [], 1, "2Warbands.pdf — Choice of Warriors"],

  ["Dwarf Treasure Hunters", "Hero", "Dwarf Noble", 1, [], 1, "DwarfTreasurehunters.pdf — Choice of Warriors"],
  ["Dwarf Treasure Hunters", "Hero", "Dwarf Engineer", 1, [], 1, "DwarfTreasurehunters.pdf — Choice of Warriors"],
  ["Dwarf Treasure Hunters", "Hero", "Dwarf Troll Slayers", 2, [], 1, "DwarfTreasurehunters.pdf — Choice of Warriors"],
  ["Dwarf Treasure Hunters", "Henchman", "Dwarf Thunderers", 5, [], 1, "DwarfTreasurehunters.pdf — Choice of Warriors"],

  ["Amazons", "Hero", "Priestess", 1, [], 1, "Amazons.pdf — Choice of Warriors"],
  ["Amazons", "Hero", "Champions (Mercenaries & Amazons)", 2, [], 1, "Amazons.pdf — Choice of Warriors"],
  ["Amazons", "Hero", "Totem Warriors", 2, [], 1, "Amazons.pdf — Choice of Warriors"],
  ["Amazons", "Henchman", "Scouts", 3, [], 1, "Amazons.pdf — Choice of Warriors"],

  ["Kislevite", "Hero", "Druzhina Captain", 1, [], 1, "Kislevwarband.pdf — Choice of Warriors"],
  ["Kislevite", "Hero", "Bear Tamer", 1, [], 1, "Kislevwarband.pdf — Choice of Warriors"],
  ["Kislevite", "Hero", "Esaul", 1, [], 1, "Kislevwarband.pdf — Choice of Warriors"],
  ["Kislevite", "Hero", "Youths", 2, [], 1, "Kislevwarband.pdf — Choice of Warriors"],
  ["Kislevite", "Henchman", "Streltsi", 3, [], 1, "Kislevwarband.pdf — Choice of Warriors"],
  ["Kislevite", "Henchman", "Trained Bear", 1, ["Bear Tamer"], 1, "Kislevwarband.pdf — Choice of Warriors"],

  ["Ostlanders", "Hero", "Elder", 1, [], 1, "Ostlanders.pdf — Choice of Warriors"],
  ["Ostlanders", "Hero", "Blood Brothers", 2, [], 1, "Ostlanders.pdf — Choice of Warriors"],
  ["Ostlanders", "Hero", "Priest of Taal", 1, [], 1, "Ostlanders.pdf — Choice of Warriors"],
  ["Ostlanders", "Henchman", "Ruffians", 5, [], 1, "Ostlanders.pdf — Choice of Warriors"],
  ["Ostlanders", "Henchman", "Jaeger", 7, [], 1, "Ostlanders.pdf — Choice of Warriors"],
  ["Ostlanders", "Henchman", "Ogre", 1, [], 1, "Ostlanders.pdf — Choice of Warriors"],

  ["Pirate", "Hero", "Pirate Captain", 1, [], 1, "PirateWarband.pdf — Choice of Warriors"],
  ["Pirate", "Hero", "Ship's Mates", 2, [], 1, "PirateWarband.pdf — Choice of Warriors"],
  ["Pirate", "Hero", "Cabin Boys", 2, [], 1, "PirateWarband.pdf — Choice of Warriors"],
  ["Pirate", "Henchman", "Gunners", 7, [], 1, "PirateWarband.pdf — Choice of Warriors"],
  ["Pirate", "Henchman", "Boatswains", 5, [], 1, "PirateWarband.pdf — Choice of Warriors"],
  ["Pirate", "Henchman", "Swabbies", 5, ["Crew"], 1, "PirateWarband.pdf — Choice of Warriors"],

  ["Night Goblins", "Hero", "Big Boss", 1, [], 1, "Night_Goblins_v3.21.pdf — Choice of Warriors"],
  ["Night Goblins", "Hero", "Shaman (Night Goblins)", 1, [], 1, "Night_Goblins_v3.21.pdf — Choice of Warriors"],
  ["Night Goblins", "Hero", "Bosses (Night Goblins)", 4, [], 1, "Night_Goblins_v3.21.pdf — Choice of Warriors"],
  ["Night Goblins", "Henchman", "Fanatics", 2, [], 1, "Night_Goblins_v3.21.pdf — Choice of Warriors"],
  ["Night Goblins", "Henchman", "Cave Squigs", 5, ["Night Goblins"], 1, "Night_Goblins_v3.21.pdf — Choice of Warriors"],
  ["Night Goblins", "Henchman", "Troll", 1, [], 1, "Night_Goblins_v3.21.pdf — Choice of Warriors"],
  ["Night Goblins", "Henchman", "Snotling Mob", 5, [], 1, "Night_Goblins_v3.21.pdf — Choice of Warriors"],

  ["Orc", "Hero", "Orc Boss", 1, [], 1, "damobrules.pdf — Choice of Warriors"],
  ["Orc", "Hero", "Orc Shaman", 1, [], 1, "damobrules.pdf — Choice of Warriors"],
  ["Orc", "Hero", "Orc Big 'Uns", 2, [], 1, "damobrules.pdf — Choice of Warriors"],
  ["Orc", "Henchman", "Goblin Warriors", null, ["Orc Boss", "Orc Shaman", "Orc Big 'Uns", "Orc Boyz"], 2, "damobrules.pdf — Choice of Warriors"],
  ["Orc", "Henchman", "Cave Squigs", 5, ["Goblin Warriors"], 1, "damobrules.pdf — Choice of Warriors"],
  ["Averlander Mercenaries", "Hero", "Captain (Averlander)", 1, [], 1, "Averlanders.pdf — Choice of Warriors"],
  ["Averlander Mercenaries", "Hero", "Bergjaeger", 2, [], 1, "Averlanders.pdf — Choice of Warriors"],
  ["Averlander Mercenaries", "Hero", "Youngblood", 1, [], 1, "Averlanders.pdf — Choice of Warriors"],
  ["Averlander Mercenaries", "Henchman", "Halfling Scouts", 3, [], 1, "Averlanders.pdf — Choice of Warriors"],

  ["Pit Fighter", "Hero", "Pit King", 1, [], 1, "PitFighter.pdf — Choice of Warriors"],
  ["Pit Fighter", "Hero", "Dwarf Troll Slayer (Pit Fighter)", 1, [], 1, "PitFighter.pdf — Choice of Warriors"],
  ["Pit Fighter", "Hero", "Pit Veterans", 2, [], 1, "PitFighter.pdf — Choice of Warriors"],
  ["Pit Fighter", "Henchman", "Ogre Pit Fighter", 1, [], 1, "PitFighter.pdf — Choice of Warriors"],
  ["Pit Fighter", "Henchman", "Pursuers", 7, [], 1, "PitFighter.pdf — Choice of Warriors"],

  ["Shadow Warrior", "Hero", "Shadow Master", 1, [], 1, "ShadowWarriors.pdf — Choice of Warriors"],
  ["Shadow Warrior", "Hero", "Shadow Walker", 3, [], 1, "ShadowWarriors.pdf — Choice of Warriors"],
  ["Shadow Warrior", "Hero", "Shadow Weaver", 1, [], 1, "ShadowWarriors.pdf — Choice of Warriors"],

  ["Beastmen Raiders", "Hero", "Beastmen Chieftain", 1, [], 1, "MordEMP2.pdf — Choice of Warriors"],
  ["Beastmen Raiders", "Hero", "Beastmen Shaman", 1, [], 1, "MordEMP2.pdf — Choice of Warriors"],
  ["Beastmen Raiders", "Hero", "Bestigors", 2, [], 1, "MordEMP2.pdf — Choice of Warriors"],
  ["Beastmen Raiders", "Hero", "Centigors", 1, [], 1, "MordEMP2.pdf — Choice of Warriors"],
  ["Beastmen Raiders", "Henchman", "Gor", 5, [], 1, "MordEMP2.pdf — Choice of Warriors"],
  ["Beastmen Raiders", "Henchman", "Minotaur", 1, [], 1, "MordEMP2.pdf — Choice of Warriors"],
  ["Beastmen Raiders", "Henchman", "Warhounds of Chaos", 5, [], 1, "MordEMP2.pdf — Choice of Warriors"],

  ["Marauders of Chaos", "Hero", "Marauder Chieftain", 1, [], 1, "10%20Marauders%20of%20Chaos.pdf — Choice of Warriors"],
  ["Marauders of Chaos", "Hero", "Seer", 1, [], 1, "10%20Marauders%20of%20Chaos.pdf — Choice of Warriors"],
  ["Marauders of Chaos", "Hero", "Condemned", 1, [], 1, "10%20Marauders%20of%20Chaos.pdf — Choice of Warriors"],
  ["Marauders of Chaos", "Hero", "Champion", 2, [], 1, "10%20Marauders%20of%20Chaos.pdf — Choice of Warriors"],
  ["Marauders of Chaos", "Henchman", "Warhounds of Chaos", 5, [], 1, "10%20Marauders%20of%20Chaos.pdf — Choice of Warriors"],
  ["Marauders of Chaos", "Henchman", "Spawn of Chaos", 1, [], 1, "10%20Marauders%20of%20Chaos.pdf — Choice of Warriors"],

  ["Battle Monks of Cathay", "Hero", "Emissary", 1, [], 1, "14%20Battle%20Monks.pdf — Choice of Warriors"],
  ["Battle Monks of Cathay", "Hero", "Officer", 1, [], 1, "14%20Battle%20Monks.pdf — Choice of Warriors"],
  ["Battle Monks of Cathay", "Hero", "Dragon Monks", 3, [], 1, "14%20Battle%20Monks.pdf — Choice of Warriors"],
  ["Battle Monks of Cathay", "Henchman", "Warrior Monks", 5, [], 1, "14%20Battle%20Monks.pdf — Choice of Warriors"],
  ["Battle Monks of Cathay", "Henchman", "Raging Peasants", 5, [], 1, "14%20Battle%20Monks.pdf — Choice of Warriors"],

  ["Carnival of Chaos", "Hero", "Carnival Master", 1, [], 1, "MordEMP2.pdf — Choice of Warriors"],
  ["Carnival of Chaos", "Hero", "Brutes (Carnival of Chaos)", 2, [], 1, "MordEMP2.pdf — Choice of Warriors"],
  ["Carnival of Chaos", "Hero", "Tainted Ones", 2, [], 1, "MordEMP2.pdf — Choice of Warriors"],
  ["Carnival of Chaos", "Henchman", "Plague Bearers", 2, [], 1, "MordEMP2.pdf — Choice of Warriors"],
];

exports.up = async function up(knex) {
  await knex.schema.alterTable("warband_warrior_types", (table) => {
    table.integer("max_count").nullable();
    table.jsonb("max_count_reference_types").notNullable().defaultTo(knex.raw("'[]'::jsonb"));
    table.integer("max_count_multiplier").notNullable().defaultTo(1);
  });

  for (const [warbandName, category, typeName, maxCount, referenceTypeNames, multiplier, source] of caps) {
    const band = await knex("warbands").where({ name: warbandName }).first("id");
    const typeRows = await knex("warrior_types").where({ name: typeName, category }).select("id");
    if (!band || typeRows.length === 0) throw new Error(`Missing cap association: ${warbandName} / ${typeName} (${category})`);
    const updated = await knex("warband_warrior_types")
      .where({ warband_id: band.id })
      .whereIn("warrior_type_id", typeRows.map((type) => type.id))
      .update({
        max_count: maxCount,
        max_count_reference_types: JSON.stringify(referenceTypeNames),
        max_count_multiplier: multiplier,
        source_reference: source,
        rule_text: maxCount === null
          ? `No more than ${multiplier} ${typeName} per ${referenceTypeNames.join(", ")}.`
          : `Maximum ${maxCount} ${typeName}${referenceTypeNames.length ? `, and no more than ${multiplier} per ${referenceTypeNames.join(", ")}` : ""}.`,
      });
    if (updated === 0) throw new Error(`Missing cap link: ${warbandName} / ${typeName} (${category})`);
  }
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("warband_warrior_types", (table) => {
    table.dropColumn("max_count_multiplier");
    table.dropColumn("max_count_reference_types");
    table.dropColumn("max_count");
  });
};