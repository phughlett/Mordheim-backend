exports.up = async function up(knex) {
  await knex.schema.alterTable("campaigns", (table) => {
    table.jsonb("trading_rules").notNullable().defaultTo('{"overrides":{},"customItems":[]}');
  });
  await knex.schema.createTable("shop_items", (table) => {
    table.string("id").primary();
    table.uuid("campaign_id").references("id").inTable("campaigns").onDelete("CASCADE");
    table.jsonb("definition").notNullable();
    table.uuid("weapon_profile_id").references("id").inTable("weapon_profiles");
    table.uuid("armour_profile_id").references("id").inTable("armour_profiles");
    table.uuid("material_modifier_id").references("id").inTable("weapon_material_modifiers");
  });
  const { catalog } = require("../src/services/trading-catalog.service");
  const weapons = await knex("weapon_profiles").select("id", "name");
  const armours = await knex("armour_profiles").select("id", "name");
  const materials = await knex("weapon_material_modifiers").select("id", "name");
  for (const item of catalog) {
    const match = (rows, name) => rows.find((row) => row.name.toLowerCase() === name?.toLowerCase())?.id ?? null;
    await knex("shop_items").insert({
      id: item.id, definition: JSON.stringify(item),
      weapon_profile_id: item.category === "weapon" ? match(weapons, item.profileName) : null,
      armour_profile_id: ["armour", "shield"].includes(item.category) ? match(armours, item.profileName) : null,
      material_modifier_id: match(materials, item.materialName),
    });
  }
  await knex.schema.alterTable("warrior_inventory", (table) => {
    table.uuid("equipment_option_id").nullable().alter();
    table.string("shop_item_id").references("id").inTable("shop_items").onDelete("RESTRICT");
    table.check("(equipment_option_id IS NULL) <> (shop_item_id IS NULL)", [], "inventory_item_origin");
  });
  await knex.schema.createTable("warband_stash", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("roster_id").notNullable().references("id").inTable("rosters").onDelete("CASCADE");
    table.uuid("equipment_option_id").references("id").inTable("equipment_options").onDelete("RESTRICT");
    table.string("shop_item_id").references("id").inTable("shop_items").onDelete("RESTRICT");
    table.integer("quantity").notNullable();
    table.integer("unit_cost_paid").notNullable();
    table.check("quantity > 0 AND unit_cost_paid >= 0");
    table.check("(equipment_option_id IS NULL) <> (shop_item_id IS NULL)");
    table.timestamps(true, true);
  });
  await knex.schema.createTable("trading_hero_status", (table) => {
    table.uuid("roster_id").notNullable().references("id").inTable("rosters").onDelete("CASCADE");
    table.uuid("hero_id").notNullable().references("id").inTable("warriors").onDelete("CASCADE");
    table.integer("battle_number").notNullable();
    table.boolean("out_of_action").notNullable().defaultTo(false);
    table.primary(["hero_id", "battle_number"]);
  });
  await knex.schema.createTable("trading_searches", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("roster_id").notNullable().references("id").inTable("rosters").onDelete("CASCADE");
    table.uuid("hero_id").references("id").inTable("warriors").onDelete("SET NULL");
    table.string("hero_name").notNullable();
    table.integer("battle_number").notNullable();
    table.string("item_id").notNullable().references("id").inTable("shop_items").onDelete("RESTRICT");
    table.jsonb("dice").notNullable();
    table.integer("modifier").notNullable();
    table.integer("total").notNullable();
    table.boolean("success").notNullable();
    table.boolean("purchased").notNullable().defaultTo(false);
    table.unique(["roster_id", "hero_id", "battle_number"]);
    table.timestamps(true, true);
  });
  await knex.schema.createTable("trading_quotes", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("roster_id").notNullable().references("id").inTable("rosters").onDelete("CASCADE");
    table.string("item_id").notNullable().references("id").inTable("shop_items").onDelete("RESTRICT");
    table.integer("battle_number").notNullable();
    table.integer("price").notNullable();
    table.jsonb("dice").notNullable();
    table.boolean("consumed").notNullable().defaultTo(false);
    table.timestamps(true, true);
  });
  await knex.schema.createTable("warrior_starting_gear_grants", (table) => {
    table.uuid("warrior_id").notNullable().references("id").inTable("warriors").onDelete("CASCADE");
    table.uuid("equipment_option_id").notNullable().references("id").inTable("equipment_options").onDelete("RESTRICT");
    table.integer("model_index").notNullable();
    table.primary(["warrior_id", "equipment_option_id", "model_index"]);
  });
  const grants = await knex("warrior_inventory").where({ unit_cost_paid: 0 }).whereNotNull("equipment_option_id")
    .distinct("warrior_id", "equipment_option_id", "model_index");
  if (grants.length) await knex("warrior_starting_gear_grants").insert(grants);
};

exports.down = async function down(knex) {
  const owned = await knex("warband_stash").first("id")
    || await knex("warrior_inventory").whereNotNull("shop_item_id").first("id");
  if (owned) throw new Error("Cannot roll back trading while stash or shop equipment exists.");
  await knex.schema.dropTable("warrior_starting_gear_grants");
  await knex.schema.dropTable("trading_quotes");
  await knex.schema.dropTable("trading_searches");
  await knex.schema.dropTable("trading_hero_status");
  await knex.schema.dropTable("warband_stash");
  await knex.schema.alterTable("warrior_inventory", (table) => {
    table.dropChecks("inventory_item_origin");
    table.dropColumn("shop_item_id");
    table.uuid("equipment_option_id").notNullable().alter();
  });
  await knex.schema.dropTable("shop_items");
  await knex.schema.alterTable("campaigns", (table) => table.dropColumn("trading_rules"));
};
