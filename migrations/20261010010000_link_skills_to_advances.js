exports.up = async function up(knex) {
  await knex.schema.alterTable("warrior_advances", (table) => {
    table.uuid("learned_skill_id").nullable().references("id").inTable("warrior_skills").onDelete("RESTRICT");
    table.unique("learned_skill_id");
  });
  await knex("warrior_advances")
    .whereIn("warrior_id", knex("warriors").where({ role: "Hired Sword" }).select("id"))
    .where({ advance_table: "Henchman" })
    .update({ advance_table: "Hero" });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("warrior_advances", (table) => {
    table.dropUnique(["learned_skill_id"]);
    table.dropColumn("learned_skill_id");
  });
};
