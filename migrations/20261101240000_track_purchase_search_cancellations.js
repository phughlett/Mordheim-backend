exports.up = async (knex) => {
  await knex.schema.alterTable("trading_searches", (table) => {
    table.uuid("purchase_id").nullable();
    table.index(["purchase_id"], "trading_searches_purchase_id_idx");
  });
};

exports.down = async (knex) => {
  const linked = await knex("trading_searches").whereNotNull("purchase_id").first("id");
  if (linked) throw new Error("Cannot roll back purchase search links while canceled or purchased search history exists.");
  await knex.schema.alterTable("trading_searches", (table) => {
    table.dropIndex(["purchase_id"], "trading_searches_purchase_id_idx");
    table.dropColumn("purchase_id");
  });
};
