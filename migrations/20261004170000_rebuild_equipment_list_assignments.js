const catalog = require("../equipment-catalog.json");

function isAssignmentTarget(type, assignment) {
  const matchesRole = assignment.roles?.includes(type.category) ?? false;
  const matchesName = assignment.warriorTypeNames?.includes(type.warriorTypeName) ?? false;
  return (matchesRole || matchesName) && !assignment.excludeWarriorTypes?.includes(type.warriorTypeName);
}

async function buildAssignments(knex) {
  const warbands = await knex("warbands").select("id", "name");
  const warbandIds = new Map(warbands.map((warband) => [warband.name, warband.id]));
  const availableTypes = await knex("warband_warrior_types as eligibility")
    .join("warrior_types as warrior_type", "warrior_type.id", "eligibility.warrior_type_id")
    .join("warbands", "warbands.id", "eligibility.warband_id")
    .whereIn("eligibility.availability", ["allowed", "conditional"])
    .select({
      warbandName: "warbands.name",
      warriorTypeId: "warrior_type.id",
      warriorTypeName: "warrior_type.name",
      category: "warrior_type.category",
    });
  const assignments = [];
  const seen = new Set();
  const namedTargets = new Set();
  for (const assignment of catalog.assignments) {
    for (const name of assignment.warriorTypeNames ?? []) namedTargets.add(`${assignment.warbandName}/${name}`);
  }

  for (const assignment of catalog.assignments) {
    const warbandId = warbandIds.get(assignment.warbandName);
    const available = availableTypes.filter((type) => type.warbandName === assignment.warbandName);
    for (const name of assignment.warriorTypeNames ?? []) {
      if (!available.some((type) => type.warriorTypeName === name)) {
        throw new Error(`Equipment assignment references unavailable warrior: ${assignment.warbandName}/${name}`);
      }
    }
    const targets = available.filter((candidate) => isAssignmentTarget(candidate, assignment)
      && (assignment.warriorTypeNames?.includes(candidate.warriorTypeName) || !namedTargets.has(`${assignment.warbandName}/${candidate.warriorTypeName}`)));
    for (const type of targets) {
      const key = `${warbandId}/${type.warriorTypeId}/${assignment.listKey}`;
      if (seen.has(key)) throw new Error(`Duplicate equipment list assignment: ${assignment.warbandName}/${type.warriorTypeName}/${assignment.listKey}`);
      seen.add(key);
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
  return assignments;
}

exports.buildAssignments = buildAssignments;

exports.up = async function up(knex) {
  const assignments = await buildAssignments(knex);
  await knex("warrior_equipment_lists").delete();
  await knex("warrior_equipment_lists").insert(assignments);
};

exports.down = async function down(knex) {
  const warbands = await knex("warbands").select("id", "name");
  const warbandIds = new Map(warbands.map((warband) => [warband.name, warband.id]));
  const types = await knex("warband_warrior_types as eligibility")
    .join("warrior_types as warrior_type", "warrior_type.id", "eligibility.warrior_type_id")
    .join("warbands", "warbands.id", "eligibility.warband_id")
    .whereIn("eligibility.availability", ["allowed", "conditional"])
    .select({ warbandId: "warbands.id", warriorTypeId: "warrior_type.id", warbandName: "warbands.name", category: "warrior_type.category" });
  const broadAssignments = [];
  for (const assignment of catalog.assignments.filter((item) => item.roles)) {
    for (const type of types.filter((item) => item.warbandName === assignment.warbandName && assignment.roles.includes(item.category))) {
      broadAssignments.push({
        warband_id: warbandIds.get(assignment.warbandName),
        warrior_type_id: type.warriorTypeId,
        list_key: assignment.listKey,
        allow_individual_group_gear: false,
        allowed_categories: JSON.stringify(["weapon", "armour", "shield", "set"]),
        source_reference: assignment.sourceReference,
        rule_text: assignment.ruleText,
      });
    }
  }
  await knex("warrior_equipment_lists").delete();
  await knex("warrior_equipment_lists").insert(broadAssignments);
};