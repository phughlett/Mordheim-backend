const verifiedHenchmanCosts = [
  ["Warriors (All Other)", 25, "2Warbands.pdf — Warriors"],
  ["Marksmen (All Others)", 25, "2Warbands.pdf — Marksmen"],
  ["Swordsmen", 35, "2Warbands.pdf — Swordsmen"],
  ["Darksouls", 35, "2Warbands.pdf — Darksouls"],
  ["Beastmen", 45, "2Warbands.pdf — Beastmen"],
  ["Brethren", 25, "2Warbands.pdf — Brethren"],
  ["Flagellants", 40, "2Warbands.pdf — Flagellants"],
  ["Warhounds", 15, "2Warbands.pdf — Warhounds"],
  ["Zealots", 20, "2Warbands.pdf — Zealots"],
  ["Zombies", 15, "2Warbands.pdf — Zombies"],
  ["Ghouls", 40, "2Warbands.pdf — Ghouls"],
  ["Dire Wolves", 50, "2Warbands.pdf — Dire Wolves"],
  ["Verminkin", 20, "2Warbands.pdf — Verminkin"],
  ["Rat Ogre", 210, "2Warbands.pdf — Rat Ogre"],
  ["Dwarf Clansmen", 40, "DwarfTreasurehunters.pdf — Dwarf Clansmen"],
  ["Beardlings", 25, "DwarfTreasurehunters.pdf — Beardlings"],
  ["Dwarf Thunderers", 40, "DwarfTreasurehunters.pdf — Dwarf Thunderers"],
  ["Kin", 25, "Ostlanders.pdf — Kin"],
  ["Ruffians", 25, "Ostlanders.pdf — Ruffians"],
  ["Jaeger", 25, "Ostlanders.pdf — Jaeger"],
  ["Ogre", 160, "Ostlanders.pdf — Ogre"],
  ["Amazon Warriors", 25, "Amazons.pdf — Amazon Warriors"],
  ["Scouts", 30, "Amazons.pdf — Scouts"],
  ["Skink Braves", 20, "lizardmen.pdf — Skink Braves"],
  ["Saurus Braves", 40, "lizardmen.pdf — Saurus Braves"],
  ["Kroxigor", 200, "lizardmen.pdf — Kroxigor"],
  ["Ogre Pit Fighter", 165, "PitFighter.pdf — Ogre Pit Fighter"],
  ["Pursuers", 25, "PitFighter.pdf — Pursuers"],
  ["Pit Fighters (Pit Fighter)", 35, "PitFighter.pdf — Pit Fighters"],
  ["Night Goblins", 15, "Night_Goblins_v3.21.pdf — Night Goblins"],
  ["Fanatics", 20, "Night_Goblins_v3.21.pdf — Fanatics"],
  ["Cave Squigs", 15, "Night_Goblins_v3.21.pdf — Cave Squigs"],
  ["Troll", 200, "Night_Goblins_v3.21.pdf — Troll"],
  ["Snotling Mob", 10, "Night_Goblins_v3.21.pdf — 50 GC per five-model mob; 10 GC per replacement model"],
  ["Marauders", 25, "10 Marauders of Chaos.pdf — Marauders"],
  ["Warhounds of Chaos", 15, "10 Marauders of Chaos.pdf — Warhounds of Chaos"],
  ["Crew", 25, "PirateWarband.pdf — Crew"],
  ["Gunners", 25, "PirateWarband.pdf — Gunners"],
  ["Boatswains", 32, "PirateWarband.pdf — Boatswains"],
];

exports.up = async function up(knex) {
  for (const [name, hireCost, source] of verifiedHenchmanCosts) {
    await knex("warrior_types")
      .where({ name, category: "Henchman" })
      .update({ hire_cost: hireCost, hire_cost_source: source });
  }
};

exports.down = async function down(knex) {
  for (const [name] of verifiedHenchmanCosts) {
    await knex("warrior_types")
      .where({ name, category: "Henchman" })
      .update({ hire_cost: null, hire_cost_source: null });
  }
};
