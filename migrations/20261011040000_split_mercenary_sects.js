const { mercenarySects, warbandTitles } = require("../src/services/warband-identity.service");

function copy(row, omit = []) {
  return Object.fromEntries(Object.entries(row).filter(([key]) => !omit.includes(key)).map(([key, value]) =>
    [key, value !== null && typeof value === "object" && !(value instanceof Date) ? JSON.stringify(value) : value]));
}

exports.up = async function up(knex) {
  await knex.schema.alterTable("warbands", (table) => {
    table.boolean("is_selectable").notNullable().defaultTo(true);
  });
  const parent = await knex("warbands").where({ name: "Mercenaries" }).first();
  if (!parent) throw new Error("Mercenary source catalog is missing.");
  const relations = await knex("warband_warrior_types").where({ warband_id: parent.id });
  const lists = await knex("equipment_lists").where({ warband_id: parent.id });
  const options = await knex("equipment_options").where({ warband_id: parent.id });
  for (const name of mercenarySects) {
    const faction = name.split(" ")[0];
    const rule = parent.special_rules.find((rule) => rule.name === faction);
    if (!rule) throw new Error(`Mercenary faction source rule missing: ${faction}`);
    const [band] = await knex("warbands").insert({
      ...copy(parent, ["id", "created_at", "updated_at"]),
      name, display_name: name, is_selectable: true, leader_type_name: "Mercenary Captain",
      special_rules: JSON.stringify([rule]),
    }).returning("id");
    for (const list of lists) await knex("equipment_lists").insert({ ...copy(list), warband_id: band.id });
    for (const option of options) {
      if (option.name === "Wolfcloak" && faction !== "Middenheim") continue;
      await knex("equipment_options").insert({
        ...copy(option, ["id", "created_at", "updated_at"]), warband_id: band.id,
      });
    }
    for (const relation of relations) {
      const original = await knex("warrior_types").where({ id: relation.warrior_type_id }).first();
      let typeId = original.id;
      if (original.category !== "Hired Sword") {
        const stats = { ...original.stats };
        if (faction === "Reikland" && original.name === "Marksmen (All Others)") stats.BS = "4";
        if (faction === "Middenheim" && ["Mercenary Captain", "Champions (Mercenaries & Amazons)"].includes(original.name)) stats.S = "4";
        const [type] = await knex("warrior_types").insert({
          ...copy(original, ["id", "created_at", "updated_at"]),
          catalog_key: `mercenary-sect/${faction}/${original.category}/${original.name}`,
          stats: JSON.stringify(stats),
        }).returning("id");
        typeId = type.id;
      }
      await knex("warband_warrior_types").insert({
        ...copy(relation), warband_id: band.id, warrior_type_id: typeId,
      });
      for (const table of ["warrior_equipment_lists", "warrior_type_skill_categories", "warrior_type_spell_disciplines"]) {
        const rows = await knex(table).where({ warband_id: parent.id, warrior_type_id: original.id });
        for (const row of rows) await knex(table).insert({
          ...copy(row, ["id", "created_at", "updated_at"]), warband_id: band.id, warrior_type_id: typeId,
        });
      }
    }
    for (const skill of await knex("skills").where({ warband_id: parent.id })) {
      await knex("skills").insert({ ...copy(skill, ["id", "created_at", "updated_at"]), warband_id: band.id });
    }
  }
  await knex("warbands").where({ id: parent.id }).update({ is_selectable: false });
  for (const [name, title] of Object.entries(warbandTitles)) {
    await knex("warbands").where({ name }).update({ display_name: title });
  }
};

exports.down = async function down() {
  throw new Error("Restore a database backup to undo the faction split without deleting roster references.");
};
