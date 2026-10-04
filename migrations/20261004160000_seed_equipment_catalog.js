const catalog = require("../equipment-catalog.json");

function isAssignmentTarget(type, assignment) {
  const matchesRole = assignment.roles?.includes(type.category) ?? false;
  const matchesName = assignment.warriorTypeNames?.includes(type.warriorTypeName) ?? false;
  return (matchesRole || matchesName) && !assignment.excludeWarriorTypes?.includes(type.warriorTypeName);
}

exports.up = async function up(knex) {
  const warbands = await knex("warbands").select("id", "name");
  const warbandIds = new Map(warbands.map((warband) => [warband.name, warband.id]));
  const equipmentLists = catalog.lists.map((list) => {
    const warbandId = warbandIds.get(list.warbandName);
    if (!warbandId) throw new Error(`Equipment list references unknown warband: ${list.warbandName}`);
    return {
      warband_id: warbandId,
      list_key: list.key,
      name: list.name,
      source_reference: list.sourceReference,
    };
  });
  await knex("equipment_lists").insert(equipmentLists);

  const equipmentOptions = [];
  for (const list of catalog.lists) {
    const warbandId = warbandIds.get(list.warbandName);
    for (const item of list.items) {
      equipmentOptions.push({
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
  await knex("equipment_options").insert(equipmentOptions);

  const availableWarriorTypes = await knex("warband_warrior_types as eligibility")
    .join("warrior_types as warrior_type", "warrior_type.id", "eligibility.warrior_type_id")
    .join("warbands", "warbands.id", "eligibility.warband_id")
    .whereIn("eligibility.availability", ["allowed", "conditional"])
    .select({
      warbandId: "warbands.id",
      warbandName: "warbands.name",
      warriorTypeId: "warrior_type.id",
      warriorTypeName: "warrior_type.name",
      category: "warrior_type.category",
    });
  const assignments = [];
  const seenAssignments = new Set();

  for (const assignment of catalog.assignments) {
    const warbandId = warbandIds.get(assignment.warbandName);
    if (!warbandId) throw new Error(`Equipment assignment references unknown warband: ${assignment.warbandName}`);
    if (!catalog.lists.some((list) => list.warbandName === assignment.warbandName && list.key === assignment.listKey)) {
      throw new Error(`Equipment assignment references unknown list: ${assignment.warbandName}/${assignment.listKey}`);
    }

    const available = availableWarriorTypes.filter((type) => type.warbandName === assignment.warbandName);
    for (const warriorTypeName of assignment.warriorTypeNames ?? []) {
      if (!available.some((type) => type.warriorTypeName === warriorTypeName)) {
        throw new Error(`Equipment assignment references unavailable warrior: ${assignment.warbandName}/${warriorTypeName}`);
      }
    }
    const selectedTypes = available.filter((type) => isAssignmentTarget(type, assignment));
    for (const type of selectedTypes) {
      const key = `${warbandId}/${type.warriorTypeId}/${assignment.listKey}`;
      if (seenAssignments.has(key)) throw new Error(`Duplicate equipment list assignment: ${assignment.warbandName}/${type.warriorTypeName}/${assignment.listKey}`);
      seenAssignments.add(key);
      assignments.push({
        warband_id: warbandId,
        warrior_type_id: type.warriorTypeId,
        list_key: assignment.listKey,
        allow_individual_group_gear: Boolean(assignment.allowIndividualGroupGear),
        allowed_categories: JSON.stringify(assignment.allowedCategories ?? ["weapon", "armour", "shield", "set"]),
        source_reference: assignment.sourceReference,
        rule_text: assignment.ruleText,
      });
    }
  }

  await knex("warrior_equipment_lists").insert(assignments);
};

exports.down = async function down(knex) {
  const warbandIds = await knex("warbands")
    .whereIn("name", [...new Set(catalog.lists.map((list) => list.warbandName))])
    .pluck("id");
  const [{ count }] = await knex("warrior_inventory as inventory")
    .join("equipment_options as option", "option.id", "inventory.equipment_option_id")
    .whereIn("option.warband_id", warbandIds)
    .count("inventory.id as count");
  if (Number(count) > 0) throw new Error("Cannot roll back equipment catalog while purchased inventory exists.");
  await knex("equipment_lists").whereIn("warband_id", warbandIds).delete();
};