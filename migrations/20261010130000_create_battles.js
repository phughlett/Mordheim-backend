exports.up = async function up(knex) {
  await knex.schema.createTable("battles", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("campaign_id").notNullable().references("id").inTable("campaigns").onDelete("CASCADE");
    table.string("format", 8).notNullable();
    table.string("status", 16).notNullable().defaultTo("forming");
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("updated_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.createTable("battle_rosters", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("battle_id").notNullable().references("id").inTable("battles").onDelete("CASCADE");
    table.uuid("roster_id").notNullable().references("id").inTable("rosters").onDelete("CASCADE");
    table.string("team", 1).notNullable();
    table.unique(["battle_id", "roster_id"]);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("battle_rosters");
  await knex.schema.dropTableIfExists("battles");
};
