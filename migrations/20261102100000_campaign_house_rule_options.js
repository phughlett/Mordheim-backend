exports.up = async (knex) => {
  await knex.schema.alterTable("campaigns", (table) => {
    table.jsonb("house_rule_options").notNullable().defaultTo(JSON.stringify({ optionalRules: [], startingBonus: null }));
  });
  await knex.schema.alterTable("warrior_advances", (table) => {
    table.string("house_rule", 40);
  });
};

exports.down = async (knex) => {
  await knex.schema.alterTable("warrior_advances", (table) => table.dropColumn("house_rule"));
  await knex.schema.alterTable("campaigns", (table) => table.dropColumn("house_rule_options"));
};
