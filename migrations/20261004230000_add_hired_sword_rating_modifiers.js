const ratingModifiers = [
  ["Beast Hunter", 18, 1, "MordEMP2.pdf — Hired Swords: +18 rating, plus 1 per Experience."],
  ["Big Game Hunter", 16, 1, "Lustria4.pdf — Hired Swords: +16 rating, plus 1 per Experience."],
  ["Chameleon Skink", 16, 1, "Lustria3.pdf — Hired Swords: +16 rating, plus 1 per Experience."],
  ["Chameleon Skink Pathfinder", 25, 1, "Lustria3.pdf — Hired Swords: +25 rating, plus 1 per Experience."],
  ["Dark Elf Assassin", 25, 1, "Lustria3.pdf — Hired Swords: +25 rating, plus 1 per Experience."],
  ["Drenok", 70, 0, "Lustria6.pdf — Hired Swords: +70 rating."],
  ["Dwarf Troll Slayer (HS)", 12, 1, "3Campaigns.pdf p.109 — Hired Swords: +12 rating, plus 1 per Experience."],
  ["Elf Ranger", 12, 1, "3Campaigns.pdf p.108 — Hired Swords: +12 rating, plus 1 per Experience."],
  ["Freelancer", 21, 1, "3Campaigns.pdf p.108 — Hired Swords: +21 rating, plus 1 per Experience."],
  ["Halfling Scout (HS)", 5, 1, "3Campaigns.pdf p.106 — Hired Swords: +5 rating, plus 1 per Experience."],
  ["Highwayman", 20, 1, "MordEMP2.pdf — Hired Swords: +20 rating, plus 1 per Experience."],
  ["Imperial Assassin", 22, 1, "Showmethemoney.pdf — Hired Swords: +22 rating, plus 1 per Experience."],
  ["Norse Shaman", 25, 1, "Lustria3.pdf — Hired Swords: +25 rating, plus 1 per Experience."],
  ["Ogre Bodyguard", 25, 1, "3Campaigns.pdf p.106 — Hired Swords: +25 rating, plus 1 per Experience."],
  ["Pit Fighter", 22, 1, "3Campaigns.pdf p.105 — Hired Swords: +22 rating, plus 1 per Experience."],
  ["Roadwarden", 22, 1, "MordEMP2.pdf — Hired Swords: +22 rating, plus 1 per Experience."],
  ["Shadow Warrior (Hired Sword)", 12, 1, "Lustria4.pdf — Hired Swords: +12 rating, plus 1 per Experience."],
  ["Tilean Marksman", 16, 1, "Showmethemoney.pdf — Hired Swords: +16 rating, plus 1 per Experience."],
  ["Warlock (HS)", 16, 1, "3Campaigns.pdf p.107 — Hired Swords: +16 rating, plus 1 per Experience."],
  ["Freelancer's Warhorse", 5, 0, "2Warbands.pdf — a warhorse adds 5 rating."],
  ["Highwayman's Horse", 3, 0, "2Warbands.pdf — a horse adds 3 rating."],
  ["Roadwarden's Horse", 3, 0, "2Warbands.pdf — a horse adds 3 rating."],
];

exports.up = async function up(knex) {
  await knex.schema.alterTable("warrior_types", (table) => {
    table.integer("rating_base_override").nullable();
    table.integer("rating_experience_multiplier").notNullable().defaultTo(1);
    table.text("rating_rule").nullable();
  });
  await knex.raw("ALTER TABLE warrior_types ADD CONSTRAINT warrior_types_rating_base_check CHECK (rating_base_override IS NULL OR rating_base_override >= 0)");
  await knex.raw("ALTER TABLE warrior_types ADD CONSTRAINT warrior_types_rating_experience_check CHECK (rating_experience_multiplier >= 0)");

  for (const [name, ratingBase, experienceMultiplier, ratingRule] of ratingModifiers) {
    const updated = await knex("warrior_types").where({ name, category: "Hired Sword" }).update({
      rating_base_override: ratingBase,
      rating_experience_multiplier: experienceMultiplier,
      rating_rule: ratingRule,
    });
    if (!updated) throw new Error(`Rating modifier references unknown Hired Sword: ${name}`);
  }
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("warrior_types", (table) => {
    table.dropColumn("rating_rule");
    table.dropColumn("rating_experience_multiplier");
    table.dropColumn("rating_base_override");
  });
};