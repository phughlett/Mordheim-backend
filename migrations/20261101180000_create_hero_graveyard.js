async function backfillLegacy(knex) {
  const removed = await knex("warrior_injuries").where({ role: "Hero", warrior_id: null });
  for (const injury of removed) {
    const removal = injury.result.effects.find((effect) => effect.type === "remove-warrior");
    if (!removal) continue;
    await knex("hero_graveyard").insert({
      roster_id: injury.roster_id, legacy_injury_id: injury.id, name: injury.warrior_name,
      reason: removal.reason ?? "removed", battle_number: injury.battle_number,
      cause: injury.result, snapshot_complete: false, removed_at: injury.created_at,
      snapshot: { member: { name: injury.warrior_name, role: "Hero" },
        equipment: [], skills: [], spells: [], advances: [], injuries: [injury], startingGear: [] },
    });
  }
}

exports.backfillLegacy = backfillLegacy;
exports.up = async (knex) => {
  await knex.schema.createTable("hero_graveyard", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("roster_id").notNullable().references("id").inTable("rosters").onDelete("CASCADE");
    table.uuid("original_warrior_id").unique();
    table.uuid("legacy_injury_id").unique();
    table.string("name").notNullable();
    table.string("reason").notNullable();
    table.integer("battle_number").notNullable();
    table.jsonb("cause");
    table.jsonb("snapshot").notNullable();
    table.boolean("snapshot_complete").notNullable();
    table.timestamp("removed_at").notNullable().defaultTo(knex.fn.now());
    table.index("roster_id");
  });
  await backfillLegacy(knex);
};

exports.down = async (knex) => {
  await knex.schema.dropTable("hero_graveyard");
};
