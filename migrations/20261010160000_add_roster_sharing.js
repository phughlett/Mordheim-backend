exports.up = async function up(knex) {
  await knex.schema.alterTable("rosters", (table) => {
    table.string("share_code", 16);
    table.unique(["share_code"]);
  });
  await knex.schema.createTable("roster_shares", (table) => {
    table.uuid("roster_id").notNullable().references("id").inTable("rosters").onDelete("CASCADE");
    table.uuid("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.primary(["roster_id", "user_id"]);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTable("roster_shares");
  await knex.schema.alterTable("rosters", (table) => {
    table.dropUnique(["share_code"]);
    table.dropColumn("share_code");
  });
};
