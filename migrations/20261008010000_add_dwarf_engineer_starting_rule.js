const engineerStartingRule = {
  name: "Expert Weaponsmith",
  category: "Special",
  description: "All Dwarf missile weapons in the warband have their range increased by 3 inches for Pistols and 6 inches for Crossbows and Handguns while the Dwarf Engineer remains with the warband.",
  special_list_name: "Starting abilities",
  is_starting: true,
  is_learnable: false,
  source_reference: "DwarfTreasurehunters.pdf — Dwarf Engineer",
};

exports.up = async function up(knex) {
  const engineerType = await knex("warrior_types")
    .where({ name: "Dwarf Engineer", category: "Hero" })
    .first("id");
  if (!engineerType) throw new Error('Warrior type "Dwarf Engineer" was not found');

  const [skill] = await knex("skills")
    .insert({ ...engineerStartingRule, warrior_type_id: engineerType.id })
    .returning("id");

  await knex.raw(`
    INSERT INTO warrior_skills (warrior_id, skill_id, is_starting)
    SELECT warrior.id, ?, TRUE
    FROM warriors AS warrior
    JOIN rosters AS roster ON roster.id = warrior.roster_id
    JOIN warbands AS warband ON warband.id = roster.warband_id
    WHERE warrior.warrior_type_id = ?
      AND warband.name = ?
  `, [skill.id, engineerType.id, "Dwarf Treasure Hunters"]);
};

exports.down = async function down(knex) {
  const engineerType = await knex("warrior_types")
    .where({ name: "Dwarf Engineer", category: "Hero" })
    .first("id");
  if (!engineerType) return;

  const skill = await knex("skills")
    .where({ warrior_type_id: engineerType.id, name: engineerStartingRule.name })
    .first("id");
  if (!skill) return;

  await knex("warrior_skills").where({ skill_id: skill.id }).delete();
  await knex("skills").where({ id: skill.id }).delete();
};
