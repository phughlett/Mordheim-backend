const catalog = require("../catalog.json");
const sourceByWarband = new Map(catalog.warbands.map((warband) => [warband.name, warband.sourceReference]));

exports.up = async function up(knex) {
  const warbands = await knex("warbands").select("id", "name");
  for (const warband of warbands) {
    const sourceReference = sourceByWarband.get(warband.name);
    if (sourceReference) {
      await knex("warbands").where({ id: warband.id }).update({ source_reference: sourceReference, is_available: true });
      continue;
    }

    await knex("rosters").where({ warband_id: warband.id }).update({
      warband_id: null,
      warband: "",
      member_order_customized: false,
      updated_at: new Date(),
    });
    await knex("warbands").where({ id: warband.id }).update({ is_available: false });
  }
};

exports.down = async function down(knex) {
  for (const warbandName of sourceByWarband.keys()) {
    await knex("warbands").where({ name: warbandName }).update({ source_reference: "Mordheim_Sheetv2.3.xlsx" });
  }
};
