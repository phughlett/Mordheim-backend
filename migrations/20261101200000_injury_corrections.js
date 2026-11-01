exports.up = async (knex) => {
  await knex.schema.alterTable("warrior_injuries", (table) => {
    table.jsonb("correction");
  });
};

exports.down = async (knex) => {
  await knex.schema.alterTable("warrior_injuries", (table) => table.dropColumn("correction"));
};
