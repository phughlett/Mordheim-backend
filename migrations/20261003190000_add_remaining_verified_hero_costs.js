const verifiedHeroCosts = [
  ["Captain (Averlander)", 60, "Averlanders.pdf — Captain"],
  ["Bergjaeger", 35, "Averlanders.pdf — Bergjaeger"],
  ["Champion", 45, "10%20Marauders%20of%20Chaos.pdf — Champions"],
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
