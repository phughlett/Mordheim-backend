// Phase 3: seed the skills catalog, the special-skill lists, and the per-(warband, Hero
// type) skill-category eligibility, sourced from 3Campaigns.pdf (standard skill lists + the
// "Lad's Got Talent" rule) and each warband's own fact sheet (warband-specific "Special"
// skill lists and which categories each of its Hero types may draw from).
const skillsCatalog = require("../skills-catalog.json");
const eligibility = require("../skill-category-eligibility.json");

exports.up = async function up(knex) {
  const warbandIdByName = new Map(
    (await knex("warbands").select("id", "name")).map((row) => [row.name, row.id]),
  );

  const skillRows = skillsCatalog.map((skill) => ({
    name: skill.name,
    category: skill.category,
    description: skill.description,
    warband_id: skill.warband ? warbandIdByName.get(skill.warband) : null,
    special_list_name: skill.specialListName,
    applies_to_warrior_type_names: skill.appliesTo ? JSON.stringify(skill.appliesTo) : null,
    source_reference: skill.sourceReference,
  }));
  for (const skill of skillRows) {
    if (skill.warband_id === undefined) throw new Error(`Unknown warband for skill "${skill.name}"`);
  }
  await knex("skills").insert(skillRows);

  const warriorTypeIdByWarbandAndName = new Map(
    (await knex("warband_warrior_types as wwt")
      .join("warbands as w", "w.id", "wwt.warband_id")
      .join("warrior_types as wt", "wt.id", "wwt.warrior_type_id")
      .select({ warband: "w.name", heroType: "wt.name", warbandId: "wwt.warband_id", warriorTypeId: "wwt.warrior_type_id" }))
      .map((row) => [`${row.warband}|||${row.heroType}`, { warbandId: row.warbandId, warriorTypeId: row.warriorTypeId }]),
  );

  const eligibilityRows = eligibility.map((entry) => {
    const key = `${entry.warband}|||${entry.heroType}`;
    const ids = warriorTypeIdByWarbandAndName.get(key);
    if (!ids) throw new Error(`No warband_warrior_types row found for ${key}`);
    return {
      warband_id: ids.warbandId,
      warrior_type_id: ids.warriorTypeId,
      category: entry.category,
      special_list_name: entry.specialListName,
    };
  });
  await knex("warrior_type_skill_categories").insert(eligibilityRows);
};

exports.down = async function down(knex) {
  await knex("warrior_type_skill_categories").del();
  await knex("skills").del();
};
