exports.up = async function up(knex) {
  await knex("warrior_types")
    .where({ name: "Swabbies", category: "Henchman" })
    .update({
      hire_cost: 0,
      hire_cost_source: "PirateWarband.pdf — Swabbies are not hired; special recruitment rule",
    });
};

exports.down = async function down(knex) {
  await knex("warrior_types")
    .where({ name: "Swabbies", category: "Henchman" })
    .update({ hire_cost: null, hire_cost_source: null });
};
