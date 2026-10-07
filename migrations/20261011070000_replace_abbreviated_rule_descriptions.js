const skillsCatalog = require("../skills-catalog.json");
const spellsCatalog = require("../spells-catalog.json");

exports.up = async function up(knex) {
  const warbandIdByName = new Map(
    (await knex("warbands").select("id", "name")).map((row) => [row.name, row.id]),
  );

  for (const skill of skillsCatalog) {
    const query = knex("skills").where("name", skill.name);
    if (skill.warband) {
      const warbandId = warbandIdByName.get(skill.warband);
      if (!warbandId) throw new Error(`Unknown warband for skill "${skill.name}": ${skill.warband}`);
      query.where("warband_id", warbandId);
    } else {
      query.whereNull("warband_id");
    }
    if (skill.specialListName) {
      query.where("special_list_name", skill.specialListName);
    } else {
      query.whereNull("special_list_name");
    }

    const updated = await query.update({ description: skill.description, updated_at: knex.fn.now() });
    if (updated !== 1) throw new Error(`Expected one database row for skill "${skill.name}", found ${updated}`);
  }

  const disciplineIdByName = new Map(
    (await knex("spell_disciplines").select("id", "name")).map((row) => [row.name, row.id]),
  );
  for (const discipline of spellsCatalog) {
    const disciplineId = disciplineIdByName.get(discipline.name);
    if (!disciplineId) throw new Error(`Unknown spell discipline "${discipline.name}"`);
    for (const spell of discipline.spells) {
      const updated = await knex("spells")
        .where({ spell_discipline_id: disciplineId, name: spell.name })
        .update({ effect_summary: spell.effectSummary, updated_at: knex.fn.now() });
      if (updated !== 1) throw new Error(`Expected one database row for spell "${discipline.name} / ${spell.name}", found ${updated}`);
    }
  }
};

exports.down = async function down() {};
