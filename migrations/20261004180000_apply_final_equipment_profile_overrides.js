const { buildAssignments } = require("./20261004170000_rebuild_equipment_list_assignments");
const catalog = require("../equipment-catalog.json");

async function syncEquipmentCatalog(knex) {
  const warbands = await knex("warbands").select("id", "name");
  const warbandIds = new Map(warbands.map((warband) => [warband.name, warband.id]));
  await knex("equipment_lists").insert(catalog.lists.map((list) => ({
    warband_id: warbandIds.get(list.warbandName),
    list_key: list.key,
    name: list.name,
    source_reference: list.sourceReference,
  }))).onConflict(["warband_id", "list_key"]).ignore();

  const existing = await knex("equipment_options").select("warband_id", "list_key", "name");
  const existingKeys = new Set(existing.map((option) => `${option.warband_id}/${option.list_key}/${option.name}`));
  const newOptions = [];
  for (const list of catalog.lists) {
    const warbandId = warbandIds.get(list.warbandName);
    for (const item of list.items) {
      const key = `${warbandId}/${list.key}/${item.name}`;
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      newOptions.push({
        warband_id: warbandId,
        list_key: list.key,
        name: item.name,
        category: item.category,
        unit_cost: item.unitCost,
        first_free: Boolean(item.firstFree),
        source_reference: list.sourceReference,
        allowed_warrior_type_names: item.allowedWarriorTypeNames ? JSON.stringify(item.allowedWarriorTypeNames) : null,
        rule_text: item.ruleText ?? null,
      });
    }
  }
  if (newOptions.length) await knex("equipment_options").insert(newOptions);
}

exports.up = async function up(knex) {
  await syncEquipmentCatalog(knex);
  const assignments = await buildAssignments(knex);
  await knex("warrior_equipment_lists").delete();
  await knex("warrior_equipment_lists").insert(assignments);
};

exports.down = async function down(knex) {
  const assignments = await buildAssignments(knex);
  await knex("warrior_equipment_lists").delete();
  await knex("warrior_equipment_lists").insert(assignments);
};
