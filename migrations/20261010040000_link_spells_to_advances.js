exports.up = async function up(knex) {
  await knex.schema.alterTable("warrior_advances", (table) => {
    table.uuid("learned_spell_id").nullable().references("id").inTable("warrior_spells").onDelete("RESTRICT");
    table.unique("learned_spell_id");
    table.uuid("reduced_spell_id").nullable().references("id").inTable("warrior_spells").onDelete("RESTRICT");
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("warrior_advances", (table) => {
    table.dropColumn("reduced_spell_id");
    table.dropUnique(["learned_spell_id"]);
    table.dropColumn("learned_spell_id");
  });
};
