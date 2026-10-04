exports.up = async function up(knex) {
  await knex.schema.alterTable("warriors", (table) => table.dropColumn("experience_peak"));
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("warriors", (table) => table.integer("experience_peak").notNullable().defaultTo(0));
  await knex("warriors").update({ experience_peak: knex.ref("experience") });
};
