exports.up = async function up(knex) {
  await knex.schema.alterTable("rosters", (table) => {
    table.integer("wyrdstone").notNullable().defaultTo(0);
    table.check("wyrdstone >= 0", [], "rosters_wyrdstone_nonnegative");
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("rosters", (table) => {
    table.dropColumn("wyrdstone");
  });
};
