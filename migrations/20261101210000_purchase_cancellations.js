exports.up = async (knex) => {
  for (const tableName of ["warband_stash", "warrior_inventory"]) {
    await knex.schema.alterTable(tableName, (table) => {
      table.integer("purchase_battles_fought").nullable();
      table.uuid("purchase_id").nullable();
      table.index(["purchase_id"], `${tableName}_purchase_id_idx`);
    });
  }

  await knex.schema.createTable("purchase_cancellations", (table) => {
    table.uuid("purchase_id").primary();
    table.uuid("roster_id").notNullable().references("id").inTable("rosters").onDelete("CASCADE");
    table.integer("purchase_battles_fought").notNullable();
    table.integer("unit_cost").notNullable();
    table.jsonb("inventory_snapshots").notNullable();
    table.timestamp("canceled_at", { useTz: true });
    table.timestamps(true, true);
    table.check("purchase_battles_fought >= 0 AND unit_cost >= 0");
  });
};

exports.down = async (knex) => {
  const cancellations = await knex("purchase_cancellations").first("purchase_id");
  if (cancellations) throw new Error("Cannot roll back purchase cancellations while upgrade cancellation history exists.");
  const owned = await knex("warband_stash").whereNotNull("purchase_id").first("id")
    || await knex("warrior_inventory").whereNotNull("purchase_id").first("id");
  if (owned) throw new Error("Cannot roll back purchase provenance while purchased equipment exists.");
  await knex.schema.dropTable("purchase_cancellations");
  for (const tableName of ["warband_stash", "warrior_inventory"]) {
    await knex.schema.alterTable(tableName, (table) => {
      table.dropIndex(["purchase_id"], `${tableName}_purchase_id_idx`);
      table.dropColumn("purchase_id");
      table.dropColumn("purchase_battles_fought");
    });
  }
};
