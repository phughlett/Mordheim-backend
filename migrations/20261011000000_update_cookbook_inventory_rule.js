const cookbook = require("../trading-catalog.json").find((item) => item.id === "halfling-cookbook");

exports.up = async function up(knex) {
  await knex("shop_items").where({ id: cookbook.id }).update({
    definition: knex.raw("jsonb_set(definition, '{description}', ?::jsonb)", [JSON.stringify(cookbook.description)]),
  });
};

exports.down = async function down(knex) {
  const description = "Hero-only book whose recipes increase the warband's maximum membership by one. Undead and Carnival of Chaos warbands cannot use it; the membership change is not automatic.";
  await knex("shop_items").where({ id: cookbook.id }).update({
    definition: knex.raw("jsonb_set(definition, '{description}', ?::jsonb)", [JSON.stringify(description)]),
  });
};
