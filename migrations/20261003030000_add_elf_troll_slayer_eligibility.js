const elfWarbands = ["High Elves", "Dark Elves", "Druchii", "Shadow Warrior", "Wood Elves"];

exports.up = async function up(knex) {
  await knex("warband_warrior_types")
    .whereIn("warband_id", knex("warbands").select("id").whereIn("name", elfWarbands))
    .whereIn("warrior_type_id", knex("warrior_types").select("id").where({ name: "Dwarf Troll Slayer (HS)", category: "Hired Sword" }))
    .update({
      availability: "conditional",
      source_reference: "3Campaigns.pdf p.109 — Hired Swords: Dwarf Troll Slayer",
      rule_text: "Elf warbands may hire this warrior for increased upkeep.",
      condition_text: "Pay 20 gc after each battle instead of 10 gc.",
    });
};

exports.down = async function down(knex) {
  await knex("warband_warrior_types")
    .whereIn("warband_id", knex("warbands").select("id").whereIn("name", elfWarbands))
    .whereIn("warrior_type_id", knex("warrior_types").select("id").where({ name: "Dwarf Troll Slayer (HS)", category: "Hired Sword" }))
    .update({
      availability: "prohibited",
      source_reference: "3Campaigns.pdf p.109 — Hired Swords: Dwarf Troll Slayer",
      rule_text: "The limited warband permissions are listed as Mercenary and Witch Hunter warbands.",
      condition_text: null,
    });
};