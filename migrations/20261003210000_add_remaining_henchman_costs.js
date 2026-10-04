const verifiedHenchmanCosts = [
  ["Halfling Scouts", 20, "Averlanders.pdf — Halfling Scouts"],
  ["Mountainguard", 30, "Averlanders.pdf — Mountainguard"],
  ["Soldiers", 25, "14%20Battle%20Monks.pdf — Soldiers"],
  ["Warrior Monks", 35, "14%20Battle%20Monks.pdf — Warrior Monks"],
  ["Raging Peasants", 10, "14%20Battle%20Monks.pdf — Raging Peasants"],
  ["Gor", 35, "MordEMP2.pdf — Gor"],
  ["Minotaur", 200, "MordEMP2.pdf — Minotaur"],
  ["Ungor", 25, "MordEMP2.pdf — Ungor"],
  ["Bowmen", 20, "BretonnianWarband.pdf — Bowmen"],
  ["Men-at-Arms", 25, "BretonnianWarband.pdf — Men-at-Arms"],
  ["Nurglings", 15, "MordEMP2.pdf — Nurglings"],
  ["Plague Bearers", 50, "MordEMP2.pdf — Plague Bearers"],
  ["Plague Cart (CoC)", 120, "MordEMP2.pdf — Plague Cart"],
  ["Cold One Beasthounds", 30, "Lustria3.pdf — Cold One Beasthounds"],
  ["Corsairs (Dark Elves)", 35, "Lustria3.pdf — Corsairs"],
  ["Shades (Dark Elves)", 30, "Lustria3.pdf — Shades"],
  ["Cossacks", 30, "Kislevwarband.pdf — Cossacks"],
  ["Streltsi", 25, "Kislevwarband.pdf — Streltsi"],
  ["Trained Bear", 145, "Kislevwarband.pdf — Trained Bear"],
  ["Spawn of Chaos", 180, "10%20Marauders%20of%20Chaos.pdf — Spawn of Chaos"],
  ["Wolf Companion", 25, "Wolf Priest of Ulric.docx — Wolf Companion"],
  ["Hunters (Norse)", 25, "Lustria4.pdf — Hunters"],
  ["Wolves", 15, "Lustria4.pdf — Wolves"],
  ["Goblin Warriors", 15, "damobrules.pdf — Goblin Warriors"],
  ["Orc Boyz", 25, "damobrules.pdf — Orc Boyz"],
  ["Shadow Warrior Novices", 25, "ShadowWarriors.pdf — Shadow Warrior Novices"],
  ["Shadow Warriors", 35, "ShadowWarriors.pdf — Shadow Warriors"],
  ["Novices", 15, "2Warbands.pdf — Sisters of Sigmar Novices"],
  ["Sigmarite Sister", 25, "2Warbands.pdf — Sigmarite Sister"],
  ["Giant Rats", 15, "2Warbands.pdf — Giant Rats"],
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
