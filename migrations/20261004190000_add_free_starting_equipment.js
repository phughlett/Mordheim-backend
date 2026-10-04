exports.up = async function up(knex) {
  await knex.raw(`
    INSERT INTO warrior_inventory (
      warrior_id,
      equipment_option_id,
      model_index,
      quantity,
      unit_cost_paid
    )
    SELECT
      warrior.id,
      option.id,
      model.model_index,
      1,
      0
    FROM warriors AS warrior
    JOIN rosters AS roster ON roster.id = warrior.roster_id
    JOIN warrior_types AS warrior_type ON warrior_type.id = warrior.warrior_type_id
    JOIN warrior_equipment_lists AS permission
      ON permission.warband_id = roster.warband_id
      AND permission.warrior_type_id = warrior.warrior_type_id
    JOIN equipment_options AS option
      ON option.warband_id = permission.warband_id
      AND option.list_key = permission.list_key
    CROSS JOIN LATERAL generate_series(
      0,
      CASE WHEN warrior.role = 'Henchman' THEN GREATEST(COALESCE(warrior.group_size, 1) - 1, 0) ELSE 0 END
    ) AS model(model_index)
    WHERE option.first_free = TRUE
      AND permission.allowed_categories @> jsonb_build_array(option.category)
      AND (
        option.allowed_warrior_type_names IS NULL
        OR option.allowed_warrior_type_names @> jsonb_build_array(warrior_type.name::text)
      )
      AND NOT EXISTS (
        SELECT 1
        FROM warrior_inventory AS inventory
        WHERE inventory.warrior_id = warrior.id
          AND inventory.equipment_option_id = option.id
          AND inventory.model_index = model.model_index
      )
  `);
};

exports.down = async function down(knex) {
  await knex("warrior_inventory")
    .where({ unit_cost_paid: 0 })
    .whereIn("equipment_option_id", knex("equipment_options").where({ first_free: true }).select("id"))
    .delete();
};