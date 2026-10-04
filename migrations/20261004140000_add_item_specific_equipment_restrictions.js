exports.up = async function up(knex) {
  await knex.schema.alterTable("equipment_options", (table) => {
    table.jsonb("allowed_warrior_type_names").nullable();
    table.text("rule_text").nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("equipment_options", (table) => {
    table.dropColumn("rule_text");
    table.dropColumn("allowed_warrior_type_names");
  });
};