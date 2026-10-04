const retiredWarbandName = "Dwarf Slayers";

exports.up = async function up(knex) {
  await knex.schema.alterTable("warbands", (table) => {
    table.boolean("is_available").notNullable().defaultTo(true);
  });

  const warband = await knex("warbands").where({ name: retiredWarbandName }).first("id");
  if (!warband) return;

  await knex("rosters").where({ warband_id: warband.id }).update({
    warband_id: null,
    warband: "",
    member_order_customized: false,
    updated_at: new Date(),
  });
  await knex("warbands").where({ id: warband.id }).update({ is_available: false });
};

exports.down = async function down(knex) {
  await knex("warbands").where({ name: retiredWarbandName }).update({ is_available: true });
  await knex.schema.alterTable("warbands", (table) => {
    table.dropColumn("is_available");
  });
};
