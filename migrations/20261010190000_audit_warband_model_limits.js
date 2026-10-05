const capacities = require("../warband-capacity.json");

exports.up = async function up(knex) {
  for (const { name, maxMembers, source, exception } of capacities) {
    await knex("warbands").where({ name }).update({
      max_members: maxMembers,
      limits_source_reference: source,
      limits_rule: `${name} warbands have a base maximum of ${maxMembers} warriors.${exception ? ` ${exception}` : ""}`,
    });
  }
};

exports.down = async function down(knex) {
  await knex("warbands").whereIn("name", capacities.map(({ name }) => name)).update({
    max_members: 15,
    limits_source_reference: "3Campaigns.pdf — Campaigns: Heroes and Henchmen",
    limits_rule: "Maximum 6 Heroes and 15 total warriors unless the warband or an eligible capacity modifier states otherwise.",
  });
  const previousOverrides = [
    ["Dwarf Treasure Hunters", 12, "DwarfTreasurehunters.pdf"],
    ["Shadow Warrior", 12, "ShadowWarriors.pdf"],
    ["Skaven", 20, "2Warbands.pdf"],
    ["Orc", 20, "damobrules.pdf"],
    ["Night Goblins", 20, "Night_Goblins_v3.21.pdf"],
  ];
  for (const [name, maxMembers, source] of previousOverrides) {
    const ruleName = { "Dwarf Treasure Hunters": "Dwarf Treasure Hunter", "Shadow Warrior": "Shadow Warrior", "Night Goblins": "Night Goblin" }[name] || name;
    await knex("warbands").where({ name }).update({
      max_members: maxMembers,
      limits_source_reference: `${source} — Choice of Warriors`,
      limits_rule: `${ruleName} warbands may include up to ${maxMembers} warriors.`,
    });
  }
};
