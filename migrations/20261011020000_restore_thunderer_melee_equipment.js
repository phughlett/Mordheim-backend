const catalog = require("../equipment-catalog.json");

exports.up = async function up(knex) {
  const warband = await knex("warbands").where({ name: "Dwarf Treasure Hunters" }).first("id");
  if (!warband) throw new Error("Dwarf Treasure Hunters warband is missing.");
  const list = catalog.lists.find((entry) => entry.key === "dwarf-thunderer");
  for (const name of ["Dagger", "Mace", "Hammer", "Axe", "Sword"]) {
    const item = list.items.find((entry) => entry.name === name);
    const profile = await knex("equipment_options")
      .where({ warband_id: warband.id, list_key: "dwarf-warrior", name })
      .first("weapon_profile_id");
    if (!profile?.weapon_profile_id) throw new Error(`Missing Dwarf weapon profile for ${name}.`);
    const existing = await knex("equipment_options")
      .where({ warband_id: warband.id, list_key: list.key, name }).first("id");
    const values = {
      category: item.category, unit_cost: item.unitCost, first_free: Boolean(item.firstFree),
      source_reference: list.sourceReference, weapon_profile_id: profile.weapon_profile_id,
    };
    if (existing) await knex("equipment_options").where({ id: existing.id }).update(values);
    else await knex("equipment_options").insert({
      warband_id: warband.id, list_key: list.key, name, ...values,
    });
  }
};

exports.down = async function down() {
  throw new Error("Restore a backup to undo Thunderer equipment corrections; inventory may reference the restored options.");
};
