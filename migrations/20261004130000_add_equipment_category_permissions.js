exports.up = async function up(knex) {
  await knex.schema.alterTable("warrior_equipment_lists", (table) => {
    table.jsonb("allowed_categories").notNullable().defaultTo(
      knex.raw("'[\"weapon\", \"armour\", \"shield\"]'::jsonb"),
    );
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("warrior_equipment_lists", (table) => {
    table.dropColumn("allowed_categories");
  });
};