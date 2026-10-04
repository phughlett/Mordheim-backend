exports.up = async function up(knex) {
  await knex.schema.alterTable("rosters", (table) => {
    table.string("campaign_phase", 20).notNullable().defaultTo("setup");
    table.integer("campaign_step").notNullable().defaultTo(1);
    table.integer("battles_fought").notNullable().defaultTo(0);
    table.string("scenario", 80).nullable();
  });
  await knex.raw(`
    ALTER TABLE rosters
    ADD CONSTRAINT rosters_campaign_phase_check
    CHECK (campaign_phase IN ('setup', 'pre_battle', 'battle', 'post_battle'))
  `);
};

exports.down = async function down(knex) {
  await knex.raw("ALTER TABLE rosters DROP CONSTRAINT IF EXISTS rosters_campaign_phase_check");
  await knex.schema.alterTable("rosters", (table) => {
    table.dropColumn("campaign_phase");
    table.dropColumn("campaign_step");
    table.dropColumn("battles_fought");
    table.dropColumn("scenario");
  });
};
