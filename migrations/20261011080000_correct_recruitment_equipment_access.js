const { buildAssignments } = require("./20261004170000_rebuild_equipment_list_assignments");

const correctedTypes = [
  ["Skaven", "Night Runners"],
  ["Cult of the Possessed", "The Possessed"],
  ["Norse", "Jarl"],
  ["Orc", "Orc Shaman"],
  ["Kislevite", "Esaul"],
  ["Kislevite", "Youths"],
];

exports.up = async function up(knex) {
  const assignments = await buildAssignments(knex);
  for (const [warbandName, typeName] of correctedTypes) {
    const type = await knex("warband_warrior_types as access")
      .join("warbands as band", "band.id", "access.warband_id")
      .join("warrior_types as type", "type.id", "access.warrior_type_id")
      .where({ "band.name": warbandName, "type.name": typeName })
      .first({ warbandId: "band.id", typeId: "type.id" });
    if (!type) throw new Error(`Missing equipment correction target: ${warbandName}/${typeName}`);
    const match = { warband_id: type.warbandId, warrior_type_id: type.typeId };
    const corrected = assignments.filter((row) => row.warband_id === type.warbandId && row.warrior_type_id === type.typeId);
    if (corrected.length !== 1) throw new Error(`Expected one corrected equipment list: ${warbandName}/${typeName}`);
    await knex("warrior_equipment_lists").where(match).delete();
    await knex("warrior_equipment_lists").insert(corrected);
  }

  const norse = await knex("warbands").where({ name: "Norse" }).first("id");
  if (!norse) throw new Error("Missing Norse warband for equipment-list correction.");
  for (const [from, to, names] of [
    ["norse-henchman", "norse-hunter", ["Bow", "Javelins"]],
    ["norse-hunter", "norse-henchman", ["Throwing axes", "Light armour"]],
  ]) {
    await knex("equipment_options").where({ warband_id: norse.id, list_key: from })
      .whereIn("name", names).update({ list_key: to });
  }
};

exports.down = async function down() {
  throw new Error("Restore a database backup to undo source-backed equipment-access corrections.");
};
