const verifiedHeroCosts = [
  ["Mercenary Captain", 60, "2Warbands.pdf — Mercenary Captain"],
  ["Champions (Mercenaries & Amazons)", 35, "2Warbands.pdf — Mercenary Champions"],
  ["Youngblood", 15, "2Warbands.pdf — Mercenary Youngbloods"],
  ["Magister", 70, "2Warbands.pdf — Magister"],
  ["The Possessed", 90, "2Warbands.pdf — The Possessed"],
  ["Mutants", 25, "2Warbands.pdf — Mutants"],
  ["Witch Hunter Captain", 60, "2Warbands.pdf — Witch Hunter Captain"],
  ["Witch Hunters", 25, "2Warbands.pdf — Witch Hunters"],
  ["Warrior Priest", 40, "2Warbands.pdf — Warrior-Priest"],
  ["Vampire", 110, "2Warbands.pdf — Vampire"],
  ["Assassin Adept", 60, "2Warbands.pdf — Assassin Adept"],
  ["Black Skaven", 40, "2Warbands.pdf — Black Skaven"],
  ["Eshin Sorcerer", 45, "2Warbands.pdf — Eshin Sorcerer"],
  ["Night Runners", 20, "2Warbands.pdf — Night Runners"],
  ["Dwarf Noble", 85, "DwarfTreasurehunters.pdf — Dwarf Noble"],
  ["Dwarf Troll Slayers", 50, "DwarfTreasurehunters.pdf — Troll Slayers"],
  ["Dwarf Engineer", 50, "DwarfTreasurehunters.pdf — Dwarf Engineer"],
  ["Elder", 60, "Ostlanders.pdf — Elder"],
  ["Blood Brothers", 35, "Ostlanders.pdf — Blood-Brothers"],
  ["Priest of Taal", 45, "Ostlanders.pdf — Priest of Taal"],
  ["Priestess", 70, "Amazons.pdf — Priestess"],
  ["Totem Warriors", 30, "Amazons.pdf — Totem Warriors"],
  ["Skink Priest", 60, "lizardmen.pdf — Skink Priest"],
  ["Saurus Totem Warrior", 60, "lizardmen.pdf — Saurus Totem Warrior"],
  ["Skink Great Crests", 30, "lizardmen.pdf — Skink Great Crests"],
  ["Pit King", 80, "PitFighter.pdf — Pit King"],
  ["Dwarf Troll Slayer (Pit Fighter)", 50, "PitFighter.pdf — Dwarf Troll Slayer"],
  ["Pit Veterans", 35, "PitFighter.pdf — Pit Veterans"],
  ["Big Boss", 45, "Night_Goblins_v3.21.pdf — Big Boss"],
  ["Shaman (Night Goblins)", 50, "Night_Goblins_v3.21.pdf — Shaman"],
  ["Bosses (Night Goblins)", 25, "Night_Goblins_v3.21.pdf — Bosses"],
  ["Marauder Chieftain", 95, "10 Marauders of Chaos.pdf — Marauder Chieftain"],
  ["Seer", 45, "10 Marauders of Chaos.pdf — Seer"],
  ["Condemned", 55, "10 Marauders of Chaos.pdf — Condemned"],
  ["Pirate Captain", 60, "PirateWarband.pdf — Pirate Captain"],
  ["Cabin Boys", 15, "PirateWarband.pdf — Cabin Boys"],
  ["Ship's Mates", 35, "PirateWarband.pdf — Ship's Mates"],
];

exports.up = async function up(knex) {
  await knex.schema.alterTable("warrior_types", (table) => {
    table.integer("hire_cost").nullable();
    table.text("hire_cost_source").nullable();
  });

  for (const [name, hireCost, source] of verifiedHeroCosts) {
    await knex("warrior_types")
      .where({ name, category: "Hero" })
      .update({ hire_cost: hireCost, hire_cost_source: source });
  }
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("warrior_types", (table) => {
    table.dropColumn("hire_cost_source");
    table.dropColumn("hire_cost");
  });
};
