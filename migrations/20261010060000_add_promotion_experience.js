exports.up = async function up(knex) {
  await knex.schema.alterTable("warriors", (table) => {
    table.integer("promotion_experience").notNullable().defaultTo(0);
  });
  await knex.raw(`
    update warriors set promotion_experience = experience
    where role = 'Hero' and warrior_type_id in (select id from warrior_types where category = 'Henchman')
  `);
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("warriors", (table) => table.dropColumn("promotion_experience"));
};
