exports.up = async (knex) => {
  await knex.schema.alterTable("warriors", (table) => {
    table.jsonb("injury_conditions").notNullable().defaultTo("[]");
  });
  await knex.schema.createTable("warrior_injuries", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("roster_id").notNullable().references("id").inTable("rosters").onDelete("CASCADE");
    table.uuid("warrior_id").references("id").inTable("warriors").onDelete("SET NULL");
    table.string("warrior_name").notNullable();
    table.string("role").notNullable();
    table.integer("model_index").notNullable();
    table.integer("battle_number").notNullable();
    table.string("mode").notNullable();
    table.jsonb("result").notNullable();
    table.boolean("pending").notNullable().defaultTo(false);
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
    table.timestamp("resolved_at");
  });
  await knex.schema.createTable("injury_previews", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("roster_id").notNullable().references("id").inTable("rosters").onDelete("CASCADE");
    table.uuid("warrior_id").notNullable().references("id").inTable("warriors").onDelete("CASCADE");
    table.uuid("resolves_id").references("id").inTable("warrior_injuries").onDelete("CASCADE");
    table.integer("model_index").notNullable();
    table.integer("battle_number").notNullable();
    table.string("mode").notNullable();
    table.jsonb("result").notNullable();
    table.jsonb("member_snapshot").notNullable();
    table.timestamp("created_at").notNullable().defaultTo(knex.fn.now());
  });
};

exports.down = async (knex) => {
  await knex.schema.dropTable("injury_previews");
  await knex.schema.dropTable("warrior_injuries");
  await knex.schema.alterTable("warriors", (table) => table.dropColumn("injury_conditions"));
};
