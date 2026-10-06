exports.up = async function up(knex) {
  const catalog = require("../trading-post-catalog.json");
  const weapons = await knex("weapon_profiles").select("id", "name");
  const armours = await knex("armour_profiles").select("id", "name");
  const materials = await knex("weapon_material_modifiers").select("id", "name");
  const match = (rows, name) => rows.find((row) => row.name.toLowerCase() === name?.toLowerCase())?.id ?? null;
  for (const item of catalog) {
    await knex("shop_items").insert({
      id: item.id, definition: JSON.stringify(item),
      weapon_profile_id: item.category === "weapon" ? match(weapons, item.profileName) : null,
      armour_profile_id: ["armour", "shield"].includes(item.category) ? match(armours, item.profileName) : null,
      material_modifier_id: match(materials, item.materialName),
    }).onConflict("id").merge();
  }
  for (const tableName of ["warband_stash", "warrior_inventory"]) {
    if (!await knex.schema.hasColumn(tableName, "bound_warrior_id")) {
      await knex.schema.alterTable(tableName, (table) => {
        table.uuid("bound_warrior_id").references("id").inTable("warriors").onDelete("CASCADE");
      });
    }
    if (!await knex.schema.hasColumn(tableName, "nontransferable")) {
      await knex.schema.alterTable(tableName, (table) => {
        table.boolean("nontransferable").notNullable().defaultTo(false);
      });
    }
  }
  if (!await knex.schema.hasColumn("trading_quotes", "buyer_id")) {
    await knex.schema.alterTable("trading_quotes", (table) => {
      table.uuid("buyer_id").references("id").inTable("warriors").onDelete("CASCADE");
    });
  }
};

exports.down = async function down() {
  throw new Error("The graded trading catalog migration cannot be rolled back after items or bound upgrades may have been acquired. Restore a database backup instead.");
};
