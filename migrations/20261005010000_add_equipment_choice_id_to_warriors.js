// Persists which equipment_choices entry (from warrior_types.equipment_choices) a Hired Sword was hired
// with, so addFreeStartingEquipment can look up the matching hired_sword_starting_gear rows at hire time
// (and on any later repair/backfill) without relying on free-text equipment.
exports.up = async function up(knex) {
  await knex.schema.alterTable("warriors", (table) => {
    table.string("equipment_choice_id").nullable();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("warriors", (table) => {
    table.dropColumn("equipment_choice_id");
  });
};
