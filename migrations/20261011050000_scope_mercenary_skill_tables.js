const source = require("../warband-source/mercenary-sects.json");

async function syncMercenarySkillTables(knex) {
  for (const sect of source.sects) {
    const band = await knex("warbands").where({ name: sect.name }).first("id");
    if (!band) throw new Error(`Missing Mercenary sect: ${sect.name}`);
    if (sect.name === "Middenheim Mercenaries") {
      await knex("equipment_options").where({ warband_id: band.id, name: "Wolfcloak" }).update({
        rule_text: "Middenheim Heroes only; no availability test at warband creation. Gives +1 armour save against shooting. Later acquisition requires a successful D6 Strength test after paying 10 gc; resolve the hunt test manually.",
      });
    }
    if (sect.name !== "Middenheim Mercenaries") {
      const middenheimTypes = await knex("warrior_types")
        .whereIn("name", ["Wolf Priest of Ulric", "Wolf Companion"]).pluck("id");
      await knex("warband_warrior_types").where({ warband_id: band.id })
        .whereIn("warrior_type_id", middenheimTypes).update({ availability: "prohibited" });
    }
    const heroes = await knex("warband_warrior_types as access")
      .join("warrior_types as type", "type.id", "access.warrior_type_id")
      .where("access.warband_id", band.id).where("type.category", "Hero")
      .select("type.id", "type.name");
    const tables = {
      "Mercenary Captain": source.captainSkills,
      "Champions (Mercenaries & Amazons)": sect.championSkills,
      Youngblood: sect.youngbloodSkills,
    };
    for (const hero of heroes) {
      if (!tables[hero.name]) throw new Error(`Missing ${sect.name} skill table for ${hero.name}`);
      const key = { warband_id: band.id, warrior_type_id: hero.id };
      await knex("warrior_type_skill_categories").where(key).delete();
      await knex("warrior_type_skill_categories").insert(tables[hero.name].map((category) => ({
        ...key, category,
      })));
      if (sect.name === "Middenheim Mercenaries") {
        const permissions = await knex("warrior_equipment_lists").where(key);
        for (const permission of permissions) {
          await knex("warrior_equipment_lists").where({ ...key, list_key: permission.list_key }).update({
            allowed_categories: JSON.stringify([...new Set([...permission.allowed_categories, "misc"])]),
          });
        }
      }
    }
  }
}

exports.up = syncMercenarySkillTables;
exports.syncMercenarySkillTables = syncMercenarySkillTables;

exports.down = async function down() {
  throw new Error("Restore a database backup to undo province-specific skill permissions.");
};
