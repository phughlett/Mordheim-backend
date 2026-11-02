exports.up = async (knex) => {
  await knex.schema.alterTable("campaigns", (table) => {
    table.boolean("league_enabled").notNullable().defaultTo(false);
    table.integer("scenario_limit");
    table.text("house_rules").notNullable().defaultTo("");
    table.jsonb("allowed_warband_ids").notNullable().defaultTo("[]");
    table.integer("max_warbands_per_player");
  });
  await knex.schema.createTable("league_scenarios", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("owner_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    table.string("share_code", 32).notNullable().unique();
    table.jsonb("definition").notNullable();
    table.timestamps(true, true);
  });
  await knex.schema.createTable("campaign_rounds", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("campaign_id").notNullable().references("id").inTable("campaigns").onDelete("CASCADE");
    table.integer("number").notNullable();
    table.string("status", 16).notNullable().defaultTo("scheduled");
    table.jsonb("scenario").notNullable();
    table.timestamp("starts_at", { useTz: true }).notNullable();
    table.timestamp("ends_at", { useTz: true }).notNullable();
    table.string("timezone", 80).notNullable();
    table.string("location", 240).notNullable().defaultTo("");
    table.jsonb("tables").notNullable().defaultTo("[]");
    table.jsonb("absences").notNullable().defaultTo("[]");
    table.jsonb("absence_notes").notNullable().defaultTo("{}");
    table.timestamps(true, true);
    table.unique(["campaign_id", "number"]);
  });
  await knex.schema.createTable("league_games", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("round_id").notNullable().references("id").inTable("campaign_rounds").onDelete("CASCADE");
    table.integer("table_number").notNullable();
    table.string("status", 20).notNullable().defaultTo("preparing");
    table.jsonb("seats").notNullable();
    table.jsonb("results");
    table.text("notes").notNullable().defaultTo("");
    table.timestamps(true, true);
    table.unique(["round_id", "table_number"]);
  });
  await knex.schema.alterTable("rosters", (table) => {
    table.boolean("league_retired").notNullable().defaultTo(false);
  });
};

exports.down = async (knex) => {
  await knex.schema.alterTable("rosters", (table) => table.dropColumn("league_retired"));
  await knex.schema.dropTable("league_games");
  await knex.schema.dropTable("campaign_rounds");
  await knex.schema.dropTable("league_scenarios");
  await knex.schema.alterTable("campaigns", (table) => {
    for (const column of ["league_enabled", "scenario_limit", "house_rules", "allowed_warband_ids", "max_warbands_per_player"]) table.dropColumn(column);
  });
};
