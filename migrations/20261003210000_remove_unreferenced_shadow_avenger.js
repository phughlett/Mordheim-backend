exports.up = async function up(knex) {
  await knex.transaction(async (transaction) => {
    const type = await transaction("warrior_types")
      .where({ name: "Shadow Avenger", category: "Hero" })
      .first("id", "catalog_key", "stats", "starting_experience", "large", "source_reference");
    if (!type) return;

    const assignedWarrior = await transaction("warriors")
      .where({ warrior_type_id: type.id })
      .first("id");
    if (assignedWarrior) {
      throw new Error("Cannot remove Shadow Avenger while saved warriors use that type.");
    }

    await transaction("warband_warrior_types").where({ warrior_type_id: type.id }).delete();
    await transaction("warrior_types").where({ id: type.id }).delete();
  });
};

exports.down = async function down(knex) {
  const sourceReference = "Mordheim_Sheetv2.3.xlsx:Starting_Values!row 143";
  const [type] = await knex("warrior_types").insert({
    catalog_key: `${sourceReference}::Hero::Shadow Avenger`,
    name: "Shadow Avenger",
    category: "Hero",
    stats: { M: "5", WS: "5", BS: "4", S: "3", T: "4", W: "1", I: "6", A: "1", Ld: "8" },
    starting_experience: 0,
    large: false,
    source_reference: sourceReference,
  }).returning(["id"]);
  const warband = await knex("warbands").where({ name: "Shadow Warrior", is_available: true }).first("id");
  if (warband) {
    await knex("warband_warrior_types").insert({
      warband_id: warband.id,
      warrior_type_id: type.id,
      availability: "allowed",
      source_reference: sourceReference,
      rule_text: "The roster catalog associates this warrior type with this warband.",
    });
  }
};
