const warbandCaps = [
  ["Dwarf Treasure Hunters", 12, "DwarfTreasurehunters.pdf — Choice of Warriors", "Dwarf Treasure Hunter warbands may include up to 12 warriors."],
  ["Shadow Warrior", 12, "ShadowWarriors.pdf — Choice of Warriors", "Shadow Warrior warbands may include up to 12 warriors."],
  ["Skaven", 20, "2Warbands.pdf — Choice of Warriors", "Skaven warbands may include up to 20 warriors."],
  ["Orc", 20, "damobrules.pdf — Choice of Warriors", "Orc warbands may include up to 20 warriors."],
  ["Night Goblins", 20, "Night_Goblins_v3.21.pdf — Choice of Warriors", "Night Goblin warbands may include up to 20 warriors."],
];

exports.up = async function up(knex) {
  await knex.schema.alterTable("warbands", (table) => {
    table.integer("max_heroes").notNullable().defaultTo(6);
    table.integer("max_members").notNullable().defaultTo(15);
    table.text("limits_source_reference").notNullable().defaultTo("3Campaigns.pdf — Campaigns: Heroes and Henchmen");
    table.text("limits_rule").notNullable().defaultTo("Maximum 6 Heroes and 15 total warriors unless the warband or an eligible capacity modifier states otherwise.");
  });

  await knex.schema.alterTable("warrior_types", (table) => {
    table.integer("member_limit_bonus").notNullable().defaultTo(0);
  });

  await knex.schema.createTable("capacity_modifiers", (table) => {
    table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
    table.string("modifier_key").notNullable().unique();
    table.string("name").notNullable();
    table.integer("member_limit_bonus").notNullable();
    table.jsonb("excluded_warbands").notNullable().defaultTo(knex.raw("'[]'::jsonb"));
    table.text("source_reference").notNullable();
    table.text("rule_text").notNullable();
    table.timestamps(true, true);
  });

  await knex.schema.createTable("roster_capacity_modifiers", (table) => {
    table.uuid("roster_id").notNullable().references("id").inTable("rosters").onDelete("CASCADE");
    table.uuid("capacity_modifier_id").notNullable().references("id").inTable("capacity_modifiers").onDelete("CASCADE");
    table.primary(["roster_id", "capacity_modifier_id"]);
  });

  await knex("warrior_types").where({ name: "Halfling Scout (HS)", category: "Hired Sword" }).update({ member_limit_bonus: 1 });

  for (const [name, maxMembers, source, rule] of warbandCaps) {
    await knex("warbands").where({ name }).update({
      max_members: maxMembers,
      limits_source_reference: source,
      limits_rule: rule,
    });
  }

  await knex("capacity_modifiers").insert({
    modifier_key: "halfling-cookbook",
    name: "Halfling Cookbook",
    member_limit_bonus: 1,
    excluded_warbands: JSON.stringify(["Undead", "Strigoi Undead", "Blooddragon", "Host of the Dead", "Lahmia", "Nehekhara Tomb Guards", "Tomb Guardians", "Necromancer", "Carnival of Chaos"]),
    source_reference: "1Rules.pdf p.37 — Miscellaneous Equipment: Halfling Cookbook",
    rule_text: "Increase the maximum number of warriors by 1. Undead and Carnival of Chaos warbands cannot use it.",
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists("roster_capacity_modifiers");
  await knex.schema.dropTableIfExists("capacity_modifiers");
  await knex.schema.alterTable("warrior_types", (table) => table.dropColumn("member_limit_bonus"));
  await knex.schema.alterTable("warbands", (table) => {
    table.dropColumn("limits_rule");
    table.dropColumn("limits_source_reference");
    table.dropColumn("max_members");
    table.dropColumn("max_heroes");
  });
};