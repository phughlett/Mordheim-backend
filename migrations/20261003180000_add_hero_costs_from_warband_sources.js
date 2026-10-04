const verifiedHeroCosts = [
  ["Emissary", 60, "14%20Battle%20Monks.pdf — Emissary"],
  ["Officer", 40, "14%20Battle%20Monks.pdf — Officer"],
  ["Dragon Monks", 55, "14%20Battle%20Monks.pdf — Dragon Monks"],
  ["Beastmen Chieftain", 65, "MordEMP2.pdf — Beastmen Chieftain"],
  ["Beastmen Shaman", 45, "MordEMP2.pdf — Beastmen Shaman"],
  ["Bestigors", 45, "MordEMP2.pdf — Bestigors"],
  ["Centigors", 80, "MordEMP2.pdf — Centigors"],
  ["Champion", 45, "10%20Marauders%20of%20Chaos.pdf — Champions"],
  ["Questing Knight", 80, "BretonnianWarband.pdf — Questing Knight"],
  ["Knight Errant", 50, "BretonnianWarband.pdf — Knight Errant"],
  ["Squires", 15, "BretonnianWarband.pdf — Squires"],
  ["Carnival Master", 70, "MordEMP2.pdf — Carnival Master"],
  ["Brutes (Carnival of Chaos)", 60, "MordEMP2.pdf — Brutes"],
  ["Tainted Ones", 25, "MordEMP2.pdf — Tainted Ones"],
  ["High Born", 70, "Lustria3.pdf — High Born"],
  ["Beast Master (Dark Elves)", 45, "Lustria3.pdf — Beast Master"],
  ["Dark Elf Sorceress (Dark Elves)", 55, "Lustria3.pdf — Dark Elf Sorceress"],
  ["Fellblades", 40, "Lustria3.pdf — Fellblades"],
  ["Captain (Averlander)", 60, "Averlanders.pdf — Captain"],
  ["Bergjaeger", 35, "Averlanders.pdf — Bergjaeger"],
  ["Druzhina Captain", 80, "Kislevwarband.pdf — Druzhina Captain"],
  ["Bear Tamer", 35, "Kislevwarband.pdf — Bear Tamer"],
  ["Esaul", 35, "Kislevwarband.pdf — Esaul"],
  ["Youths", 15, "Kislevwarband.pdf — Youths"],
  ["Jarl", 70, "Lustria4.pdf — Jarl"],
  ["Wulfin", 90, "Lustria4.pdf — Wulfen"],
  ["Berserkers", 50, "Lustria4.pdf — Berserkers"],
  ["Bondsmen (Norse)", 15, "Lustria4.pdf — Bondsmen"],
  ["Orc Boss", 80, "damobrules.pdf — Orc Boss"],
  ["Orc Big 'Uns", 40, "damobrules.pdf — Orc Big 'Uns"],
  ["Orc Shaman", 40, "damobrules.pdf — Orc Shaman"],
  ["Shadow Master", 70, "ShadowWarriors.pdf — Shadow Master"],
  ["Shadow Walker", 45, "ShadowWarriors.pdf — Shadow Walker"],
  ["Shadow Weaver", 55, "ShadowWarriors.pdf — Shadow Weaver"],
  ["Sigmarite Matriarch", 70, "2Warbands.pdf — Sigmarite Matriarch"],
  ["Sister Superior", 35, "2Warbands.pdf — Sister Superior"],
  ["Augur", 25, "2Warbands.pdf — Augur"],
  ["Necromancer (Lahmia & Undead))", 35, "2Warbands.pdf — Necromancer"],
];

exports.up = async function up(knex) {
  for (const [name, hireCost, source] of verifiedHeroCosts) {
    await knex("warrior_types")
      .where({ name, category: "Hero" })
      .update({ hire_cost: hireCost, hire_cost_source: source });
  }
};

exports.down = async function down(knex) {
  for (const [name] of verifiedHeroCosts) {
    await knex("warrior_types")
      .where({ name, category: "Hero" })
      .update({ hire_cost: null, hire_cost_source: null });
  }
};
