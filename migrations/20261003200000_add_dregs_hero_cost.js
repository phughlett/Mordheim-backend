exports.up = async function up(knex) {
  await knex("warrior_types")
    .where({ name: "Dregs", category: "Hero" })
    .update({
      hire_cost: 20,
      hire_cost_source: "2Warbands.pdf — Dregs",
    });
};

exports.down = async function down(knex) {
  await knex("warrior_types")
    .where({ name: "Dregs", category: "Hero" })
    .update({ hire_cost: null, hire_cost_source: null });
};
