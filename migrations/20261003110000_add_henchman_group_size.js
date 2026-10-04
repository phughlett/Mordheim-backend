exports.up = async function up(knex) {
  await knex.schema.alterTable("warriors", (table) => {
    table.integer("group_size").notNullable().defaultTo(1);
  });
  await knex.raw("ALTER TABLE warriors ADD CONSTRAINT warriors_group_size_check CHECK (group_size BETWEEN 1 AND 5 AND (role = 'Henchman' OR group_size = 1))");
};

exports.down = async function down(knex) {
  await knex.raw("ALTER TABLE warriors DROP CONSTRAINT IF EXISTS warriors_group_size_check");
  await knex.schema.alterTable("warriors", (table) => table.dropColumn("group_size"));
};