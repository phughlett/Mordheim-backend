// 20261005000000_create_hired_sword_equipment_catalog.js stamped every "hired-sword-gear" equipment_options
// row with an internal migration-filenames note as its source_reference. That string was meant as an
// authoring note, not a player-facing citation, but it leaks straight into the equipment inventory panel's
// "OWNED" list (e.g. "Great Axe of the Icefang ... 20261004240000/20261004250000 Hired Sword starting gear
// migrations — consolidated equipment catalog"). Replace it with a citation that matches the existing
// convention used by every other equipment_options row (e.g. "2Warbands.pdf — Mercenary equipment lists").
const LIST_KEY = "hired-sword-gear";
const OLD_SOURCE = "20261004240000/20261004250000 Hired Sword starting gear migrations — consolidated equipment catalog";
const NEW_SOURCE = "3Campaigns.pdf — Hired Swords (plus Lustria/MordEMP2/Showmethemoney supplements for warband-specific Hired Swords)";

exports.up = async function up(knex) {
  await knex("equipment_options")
    .where({ list_key: LIST_KEY, source_reference: OLD_SOURCE })
    .update({ source_reference: NEW_SOURCE });
  await knex("equipment_lists")
    .where({ list_key: LIST_KEY, source_reference: OLD_SOURCE })
    .update({ source_reference: NEW_SOURCE });
};

exports.down = async function down(knex) {
  await knex("equipment_options")
    .where({ list_key: LIST_KEY, source_reference: NEW_SOURCE })
    .update({ source_reference: OLD_SOURCE });
  await knex("equipment_lists")
    .where({ list_key: LIST_KEY, source_reference: NEW_SOURCE })
    .update({ source_reference: OLD_SOURCE });
};
