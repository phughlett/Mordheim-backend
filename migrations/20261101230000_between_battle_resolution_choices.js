exports.up = async (knex) => {
  await knex.schema.alterTable("warriors", (table) => table.integer("skill_list_choice_battles_fought"));
  await knex("warriors").whereRaw("jsonb_array_length(coalesce(skill_category_overrides, '[]'::jsonb)) > 0")
    .update({ skill_list_choice_battles_fought: -1 });
  await knex.schema.alterTable("warrior_advances", (table) => table.integer("resolution_battles_fought"));
  await knex("warrior_advances").whereNotNull("reduced_spell_id").update({ resolution_battles_fought: -1 });
};

exports.down = async (knex) => {
  await knex.schema.alterTable("warriors", (table) => table.dropColumn("skill_list_choice_battles_fought"));
  await knex.schema.alterTable("warrior_advances", (table) => table.dropColumn("resolution_battles_fought"));
};
