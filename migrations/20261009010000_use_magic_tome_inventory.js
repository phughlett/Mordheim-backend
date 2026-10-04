exports.up = async function up(knex) {
  await knex.schema.createTable("warrior_magic_tomes", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.uuid("warrior_id").notNullable().references("id").inTable("warriors").onDelete("CASCADE");
    table.integer("unit_cost_paid");
    table.timestamp("acquired_at").notNullable().defaultTo(knex.fn.now());
    table.timestamps(true, true);
    table.check("unit_cost_paid IS NULL OR unit_cost_paid >= 0");
    table.index(["warrior_id", "acquired_at"]);
  });

  await knex.schema.alterTable("warriors", (table) => {
    table.boolean("lesser_magic_unlocked").notNullable().defaultTo(false);
  });

  const legacyTomes = await knex("warriors")
    .where({ has_magic_tome: true })
    .select("id");
  if (legacyTomes.length) {
    await knex("warrior_magic_tomes").insert(legacyTomes.map((warrior) => ({
      warrior_id: warrior.id,
      unit_cost_paid: null,
    })));
  }

  await knex.schema.alterTable("warriors", (table) => {
    table.dropColumn("has_magic_tome");
  });
};

exports.down = async function down(knex) {
  const tomes = await knex("warrior_magic_tomes").distinct("warrior_id");
  await knex.schema.alterTable("warriors", (table) => {
    table.boolean("has_magic_tome").notNullable().defaultTo(false);
  });
  if (tomes.length) {
    await knex("warriors").whereIn("id", tomes.map((row) => row.warrior_id)).update({ has_magic_tome: true });
  }
  await knex.schema.alterTable("warriors", (table) => {
    table.dropColumn("lesser_magic_unlocked");
  });
  await knex.schema.dropTableIfExists("warrior_magic_tomes");
};
