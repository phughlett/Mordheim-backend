exports.up = async function up(knex) {
  await knex.raw(`
    INSERT INTO warband_warrior_types (
      warband_id,
      warrior_type_id,
      availability,
      source_reference,
      rule_text,
      condition_text
    )
    SELECT warbands.id, warrior_types.id, 'unverified', NULL, NULL, NULL
    FROM warbands
    CROSS JOIN warrior_types
    WHERE warrior_types.catalog_key IN (
      'Wolf Priest of Ulric.docx::Hired Sword::Wolf Priest of Ulric',
      'Wolf Priest of Ulric.docx::Henchman::Wolf Companion'
    )
    ON CONFLICT (warband_id, warrior_type_id) DO NOTHING
  `);
};

exports.down = async function down(knex) {
  await knex.raw(`
    DELETE FROM warband_warrior_types
    USING warrior_types
    WHERE warband_warrior_types.warrior_type_id = warrior_types.id
      AND warrior_types.catalog_key IN (
        'Wolf Priest of Ulric.docx::Hired Sword::Wolf Priest of Ulric',
        'Wolf Priest of Ulric.docx::Henchman::Wolf Companion'
      )
      AND warband_warrior_types.availability = 'unverified'
      AND warband_warrior_types.source_reference IS NULL
  `);
};