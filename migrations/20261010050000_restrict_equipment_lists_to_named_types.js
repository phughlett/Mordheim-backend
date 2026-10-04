const catalog = require("../equipment-catalog.json");

exports.up = async function up(knex) {
  const named = new Map();
  for (const assignment of catalog.assignments) {
    for (const name of assignment.warriorTypeNames ?? []) {
      const key = `${assignment.warbandName}/${name}`;
      if (!named.has(key)) named.set(key, new Set());
      named.get(key).add(assignment.listKey);
    }
  }
  const rows = await knex("warrior_equipment_lists as permission")
    .join("warbands", "warbands.id", "permission.warband_id")
    .join("warrior_types as type", "type.id", "permission.warrior_type_id")
    .select("permission.warband_id", "permission.warrior_type_id", "permission.list_key", "warbands.name as warbandName", "type.name as typeName");
  const stale = rows
    .filter((row) => named.has(`${row.warbandName}/${row.typeName}`) && !named.get(`${row.warbandName}/${row.typeName}`).has(row.list_key))
  ;
  for (const row of stale) {
    await knex("warrior_equipment_lists").where({ warband_id: row.warband_id, warrior_type_id: row.warrior_type_id, list_key: row.list_key }).delete();
  }
};

exports.down = async function down() {};
