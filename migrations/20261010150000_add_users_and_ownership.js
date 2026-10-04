exports.up = async function up(knex) {
  await knex.schema.createTable("users", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("username", 32).notNullable();
    table.string("password_hash", 256).notNullable();
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw("create unique index users_username_lower_idx on users (lower(username))");
  await knex.schema.createTable("sessions", (table) => {
    table.string("token_hash", 64).primary();
    table.uuid("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp("expires_at", { useTz: true }).notNullable();
  });
  await knex.schema.alterTable("campaigns", (table) => {
    table.uuid("owner_id").references("id").inTable("users").onDelete("SET NULL");
    table.string("invite_code", 12);
    table.unique(["invite_code"]);
  });
  await knex.schema.createTable("campaign_members", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("campaign_id").notNullable().references("id").inTable("campaigns").onDelete("CASCADE");
    table.uuid("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    table.timestamp("joined_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.unique(["campaign_id", "user_id"]);
  });
  await knex.schema.alterTable("rosters", (table) => {
    table.uuid("user_id").references("id").inTable("users").onDelete("SET NULL");
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("rosters", (table) => table.dropColumn("user_id"));
  await knex.schema.dropTableIfExists("campaign_members");
  await knex.schema.alterTable("campaigns", (table) => {
    table.dropColumn("owner_id");
    table.dropColumn("invite_code");
  });
  await knex.schema.dropTableIfExists("sessions");
  await knex.schema.dropTableIfExists("users");
};
