exports.up = async (knex) => {
  await knex.schema.alterTable("battles", (table) => {
    table.string("first_team", 1).notNullable().defaultTo("A");
    table.string("active_team", 1).notNullable().defaultTo("A");
  });
};

exports.down = async (knex) => {
  await knex.schema.alterTable("battles", (table) => {
    table.dropColumn("first_team");
    table.dropColumn("active_team");
  });
};
