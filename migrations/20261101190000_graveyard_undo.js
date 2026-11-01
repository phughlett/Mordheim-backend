exports.up = async (knex) => {
  await knex.schema.alterTable("hero_graveyard", (table) => {
    table.integer("removed_battles_fought");
    table.jsonb("removal_injury_ids").notNullable().defaultTo("[]");
  });
  // Older snapshots lack removal counters and dependent records needed for a safe undo.
};

exports.down = async (knex) => {
  await knex.schema.alterTable("hero_graveyard", (table) => {
    table.dropColumn("removed_battles_fought");
    table.dropColumn("removal_injury_ids");
  });
};
