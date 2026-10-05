exports.up = async function up(knex) {
  await knex.schema.createTable("correction_submissions", (table) => {
    table.uuid("id").primary();
    table.string("payload_hash", 64).notNullable();
    table.string("status").notNullable();
    table.text("issue_id");
    table.text("issue_url");
    table.text("project_id");
    table.timestamps(true, true);
  });
  await knex.schema.createTable("correction_rate_limits", (table) => {
    table.string("key", 64).primary();
    table.timestamp("window_started").notNullable();
    table.integer("count").notNullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("correction_rate_limits");
  await knex.schema.dropTableIfExists("correction_submissions");
};
