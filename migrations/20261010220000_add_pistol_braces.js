const braceNames = {
  Pistol: "Brace of Pistols",
  "Duelling pistol": "Brace of Duelling Pistols",
  "Duelling Pistol": "Brace of Duelling Pistols",
  "Warplock pistol": "Brace of Warplock Pistols",
};
const braceRule = "A brace contains two pistols and counts as one missile weapon toward the two-missile-weapon carrying limit.";

exports.up = async function up(knex) {
  const pistols = await knex("equipment_options").whereIn("name", Object.keys(braceNames));
  for (const pistol of pistols) {
    const name = braceNames[pistol.name];
    const existing = await knex("equipment_options").where({
      warband_id: pistol.warband_id, list_key: pistol.list_key, name,
    }).first("id");
    if (existing) continue;
    const { id, ...option } = pistol;
    await knex("equipment_options").insert({
      ...option, name, unit_cost: pistol.unit_cost * 2, first_free: false,
      allowed_warrior_type_names: pistol.allowed_warrior_type_names === null
        ? null : JSON.stringify(pistol.allowed_warrior_type_names),
      source_reference: `${pistol.source_reference}; 2Warbands.pdf — Weapons and armour, brace of pistols`,
      rule_text: [pistol.rule_text, braceRule].filter(Boolean).join(" "),
    });
  }
};

exports.down = async function down(knex) {
  const options = knex("equipment_options").whereIn("name", Object.values(braceNames))
    .where("rule_text", "like", `%${braceRule}%`);
  const ids = await options.clone().pluck("id");
  const owned = await knex("warrior_inventory").whereIn("equipment_option_id", ids).first("id");
  if (owned) throw new Error("Cannot roll back pistol braces while purchased inventory exists.");
  await options.delete();
};
