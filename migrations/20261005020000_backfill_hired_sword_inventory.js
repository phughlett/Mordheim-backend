// Backfills warrior_inventory for Hired Swords hired before the hired_sword_starting_gear catalog existed.
// Non-destructive: existing free-text `equipment` is left untouched; this only adds structured inventory
// rows. For warrior types with equipment_choices, the choice is inferred by matching the stored free-text
// equipment against each choice's descriptive text; ambiguous/no matches are skipped rather than guessed.
exports.up = async function up(knex) {
  const warriors = await knex("warriors").where({ role: "Hired Sword" }).whereNotNull("warrior_type_id")
    .select("id", "warrior_type_id", "equipment", "equipment_choice_id");
  if (!warriors.length) return;

  const typeIds = [...new Set(warriors.map((warrior) => warrior.warrior_type_id))];
  const types = await knex("warrior_types").whereIn("id", typeIds).select("id", "equipment_choices");
  const typeById = new Map(types.map((type) => [type.id, type]));

  for (const warrior of warriors) {
    const type = typeById.get(warrior.warrior_type_id);
    if (!type) continue;

    let choiceId = warrior.equipment_choice_id;
    const choices = type.equipment_choices ?? [];
    if (!choiceId && choices.length) {
      const equipmentText = (warrior.equipment || "").trim().toLowerCase();
      const matches = choices.filter((choice) => equipmentText && equipmentText === String(choice.equipment).trim().toLowerCase());
      if (matches.length === 1) {
        choiceId = matches[0].id;
        await knex("warriors").where({ id: warrior.id }).update({ equipment_choice_id: choiceId, updated_at: new Date() });
      } else {
        // Ambiguous or no match — skip this warrior's structured gear rather than guessing.
        continue;
      }
    }

    const gearQuery = knex("hired_sword_starting_gear").where({ warrior_type_id: warrior.warrior_type_id });
    if (choiceId) {
      gearQuery.andWhere((builder) => builder.whereNull("equipment_choice_id").orWhere("equipment_choice_id", choiceId));
    } else {
      gearQuery.whereNull("equipment_choice_id");
    }
    const gear = await gearQuery.select("equipment_option_id", "quantity");
    if (!gear.length) continue;

    const existing = await knex("warrior_inventory").where({ warrior_id: warrior.id, model_index: -1 }).select("equipment_option_id");
    const existingIds = new Set(existing.map((item) => item.equipment_option_id));
    const inserts = gear
      .filter((item) => !existingIds.has(item.equipment_option_id))
      .map((item) => ({
        warrior_id: warrior.id,
        equipment_option_id: item.equipment_option_id,
        model_index: -1,
        quantity: item.quantity,
        unit_cost_paid: 0,
      }));
    if (inserts.length) await knex("warrior_inventory").insert(inserts);
  }
};

exports.down = async function down() {
  // Non-destructive backfill; intentionally not reversed to avoid removing inventory rows a player may
  // have since edited (e.g. sold/traded items that happen to share an equipment_option_id).
};
