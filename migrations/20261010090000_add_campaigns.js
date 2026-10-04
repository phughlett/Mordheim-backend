exports.up = async function up(knex) {
  await knex.schema.createTable("campaigns", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("name", 120).notNullable();
    table.integer("max_gc").notNullable().defaultTo(500);
    table.timestamps(true, true);
  });
  await knex.schema.alterTable("rosters", (table) => {
    table.uuid("campaign_id").references("id").inTable("campaigns").onDelete("RESTRICT");
    table.index("campaign_id");
  });
  const existing = await knex("rosters").count("id as count").first();
  if (Number(existing.count) > 0) {
    const [campaign] = await knex("campaigns").insert({ name: "Default Campaign", max_gc: 500 }).returning("id");
    await knex("rosters").update({ campaign_id: campaign.id });
  }
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("rosters", (table) => {
    table.dropColumn("campaign_id");
  });
  await knex.schema.dropTable("campaigns");
};
