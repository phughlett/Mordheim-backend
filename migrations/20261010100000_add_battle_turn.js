exports.up = async function up(knex) {
  await knex.schema.alterTable("rosters", (table) => {
    table.integer("battle_turn").notNullable().defaultTo(1);
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("rosters", (table) => {
    table.dropColumn("battle_turn");
  });
};
