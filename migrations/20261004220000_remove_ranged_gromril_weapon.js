exports.up = async function up(knex) {
  const dwarfWarband = await knex("warbands").where({ name: "Dwarf Treasure Hunters" }).first("id");
  if (!dwarfWarband) return;
  const option = await knex("equipment_options")
    .where({ warband_id: dwarfWarband.id, list_key: "dwarf-warrior", name: "Gromril pistol" })
    .first("id");
  if (!option) return;

  const refunds = await knex("warrior_inventory as inventory")
    .join("warriors as warrior", "warrior.id", "inventory.warrior_id")
    .where({ equipment_option_id: option.id })
    .groupBy("warrior.roster_id")
    .select("warrior.roster_id")
    .sum({ refund_amount: knex.raw("inventory.quantity * inventory.unit_cost_paid") });
  for (const refund of refunds) {
    await knex("rosters").where({ id: refund.roster_id }).update({
      treasury: knex.raw("treasury + ?", [Number(refund.refund_amount)]),
      updated_at: new Date(),
    });
  }
  await knex("warrior_inventory").where({ equipment_option_id: option.id }).delete();
  await knex("equipment_options").where({ id: option.id }).delete();
};

exports.down = async function down(knex) {
  const dwarfWarband = await knex("warbands").where({ name: "Dwarf Treasure Hunters" }).first("id");
  const list = await knex("equipment_lists").where({ warband_id: dwarfWarband?.id, list_key: "dwarf-warrior" }).first();
  if (!list) return;
  await knex("equipment_options").insert({
    warband_id: dwarfWarband.id,
    list_key: "dwarf-warrior",
    name: "Gromril pistol",
    category: "weapon",
    unit_cost: 45,
    first_free: false,
    source_reference: list.source_reference,
    rule_text: null,
  });
};