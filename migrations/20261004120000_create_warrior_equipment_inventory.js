exports.up = async function up(knex) {
  await knex.schema.createTable("equipment_lists", (table) => {
    table.uuid("warband_id").notNullable().references("id").inTable("warbands").onDelete("CASCADE");
    table.string("list_key").notNullable();
    table.string("name").notNullable();
    table.text("source_reference").notNullable();
    table.primary(["warband_id", "list_key"]);
  });

  await knex.schema.createTable("equipment_options", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("warband_id").notNullable().references("id").inTable("warbands").onDelete("CASCADE");
    table.string("list_key").notNullable();
    table.string("name").notNullable();
    table.string("category").notNullable();
    table.integer("unit_cost").notNullable();
    table.boolean("first_free").notNullable().defaultTo(false);
    table.text("source_reference").notNullable();
    table.check("category IN ('weapon', 'armour', 'shield')");
    table.check("unit_cost >= 0");
    table.foreign(["warband_id", "list_key"]).references(["warband_id", "list_key"]).inTable("equipment_lists").onDelete("CASCADE");
    table.index(["warband_id", "list_key"]);
  });

  await knex.schema.createTable("warrior_equipment_lists", (table) => {
    table.uuid("warband_id").notNullable().references("id").inTable("warbands").onDelete("CASCADE");
    table.uuid("warrior_type_id").notNullable().references("id").inTable("warrior_types").onDelete("CASCADE");
    table.string("list_key").notNullable();
    table.boolean("allow_individual_group_gear").notNullable().defaultTo(false);
    table.text("source_reference").notNullable();
    table.text("rule_text").notNullable();
    table.primary(["warband_id", "warrior_type_id", "list_key"]);
    table.foreign(["warband_id", "list_key"]).references(["warband_id", "list_key"]).inTable("equipment_lists").onDelete("CASCADE");
  });

  await knex.schema.createTable("warrior_inventory", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("warrior_id").notNullable().references("id").inTable("warriors").onDelete("CASCADE");
    table.uuid("equipment_option_id").notNullable().references("id").inTable("equipment_options").onDelete("RESTRICT");
    table.integer("model_index").notNullable().defaultTo(-1);
    table.integer("quantity").notNullable().defaultTo(1);
    table.integer("unit_cost_paid").notNullable();
    table.timestamps(true, true);
    table.check("model_index >= -1");
    table.check("quantity > 0");
    table.check("unit_cost_paid >= 0");
    table.index(["warrior_id", "equipment_option_id"]);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("warrior_inventory");
  await knex.schema.dropTableIfExists("warrior_equipment_lists");
  await knex.schema.dropTableIfExists("equipment_options");
  await knex.schema.dropTableIfExists("equipment_lists");
};