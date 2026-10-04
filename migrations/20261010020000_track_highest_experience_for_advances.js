exports.up = async function up(knex) {
  await knex.schema.alterTable("warriors", (table) => {
    table.integer("experience_peak").notNullable().defaultTo(0);
  });

  await knex.raw(`
    UPDATE warriors
    SET experience_peak = GREATEST(
      warriors.experience,
      COALESCE((
        SELECT MAX(warrior_advances.experience_threshold)
        FROM warrior_advances
        WHERE warrior_advances.warrior_id = warriors.id
      ), 0)
    )
  `);
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("warriors", (table) => {
    table.dropColumn("experience_peak");
  });
};
