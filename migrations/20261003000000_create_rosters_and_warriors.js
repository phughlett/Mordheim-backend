exports.up = async function up(knex) {
  await knex.schema.createTable("rosters", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("name").notNullable().defaultTo("Untitled Warband");
    table.string("warband").nullable();
    table.integer("treasury").notNullable().defaultTo(500);
    table.integer("rating").notNullable().defaultTo(0);
    table.timestamps(true, true);
  });

  await knex.schema.createTable("warriors", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("roster_id").notNullable().references("id").inTable("rosters").onDelete("CASCADE");
    table.string("name").notNullable();
    table.string("type").notNullable().defaultTo("");
    table.string("role").notNullable();
    table.integer("experience").notNullable().defaultTo(0);
    table.jsonb("stats").notNullable().defaultTo(knex.raw("'{}'::jsonb"));
    table.text("equipment").notNullable().defaultTo("");
    table.text("skills").notNullable().defaultTo("");
    table.text("notes").notNullable().defaultTo("");
    table.integer("position").notNullable().defaultTo(0);
    table.timestamps(true, true);
    table.index("roster_id");
    table.check("role IN ('Hero', 'Henchman')");
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("warriors");
  await knex.schema.dropTableIfExists("rosters");
};