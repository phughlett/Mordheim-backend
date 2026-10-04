const hiredSwordProfiles = [
  {
    name: "Big Game Hunter",
    source: "Lustria4.pdf — Big Game Hunter",
    stats: { M: "4", WS: "3", BS: "4", S: "3", T: "3", W: "1", I: "4", A: "1", Ld: "7" },
    equipment: "Sword, dagger, net, light armour, and hunting rifle.",
  },
  {
    name: "Chameleon Skink Pathfinder",
    source: "Lustria3.pdf — Chameleon Skink Pathfinder",
    stats: { M: "4", WS: "3", BS: "4", S: "3", T: "3", W: "1", I: "4", A: "1", Ld: "8" },
    equipment: "Sword, dagger, longbow, rope and hook, and healing herbs.",
  },
  {
    name: "Drenok",
    source: "Lustria6.pdf — Drenok",
    stats: { M: "4", WS: "6", BS: "3", S: "4", T: "4", W: "2", I: "4", A: "2", Ld: "8" },
    equipment: "Great Axe of the Icefang and Sabertooth Tiger Hide.",
  },
  {
    name: "Imperial Assassin",
    source: "Showmethemoney.pdf — Imperial Assassin",
    stats: { M: "4", WS: "4", BS: "4", S: "3", T: "3", W: "1", I: "5", A: "2", Ld: "8" },
    equipment: "Sword, dagger, throwing daggers, and crossbow pistol.",
  },
  {
    name: "Tilean Marksman",
    source: "Showmethemoney.pdf — Tilean Marksman",
    stats: { M: "4", WS: "3", BS: "4", S: "3", T: "3", W: "1", I: "3", A: "1", Ld: "7" },
    equipment: "Light armour, sword, dagger, and crossbow.",
  },
  {
    name: "Shadow Warrior (Hired Sword)",
    source: "Lustria4.pdf — Shadow Warrior",
    stats: { M: "5", WS: "4", BS: "4", S: "3", T: "3", W: "1", I: "6", A: "1", Ld: "8" },
    equipment: "Sword, longbow, dagger, shield, and light armour.",
  },
  {
    name: "Dark Elf Assassin",
    source: "Lustria3.pdf — Dark Elf Assassin",
    stats: { M: "5", WS: "5", BS: "5", S: "4", T: "4", W: "1", I: "7", A: "1", Ld: "8" },
    equipment: "Dark Elf Blade, dagger, repeating crossbow, Dark Venom, light armour, and Dark Cloak.",
  },
  {
    name: "Chameleon Skink",
    source: "Lustria3.pdf — Chameleon Skink",
    stats: { M: "6", WS: "4", BS: "4", S: "4", T: "2", W: "1", I: "5", A: "1", Ld: "7" },
    equipment: "Dagger, blowpipe with poison darts, and buckler.",
  },
  {
    name: "Norse Shaman",
    source: "Lustria3.pdf — Norse Shaman",
    stats: { M: "4", WS: "3", BS: "2", S: "3", T: "3", W: "1", I: "1", A: "1", Ld: "8" },
    equipmentChoices: [
      { id: "rune-staff-sword", label: "Rune staff and sword", equipment: "Rune staff and sword." },
      { id: "rune-staff-axe", label: "Rune staff and axe", equipment: "Rune staff and axe." },
    ],
  },
  {
    name: "Ogre Bodyguard",
    source: "3Campaigns.pdf p.106 — Ogre Bodyguard",
    equipmentChoices: [
      { id: "two-swords", label: "Two swords", equipment: "Two swords and light armour." },
      { id: "two-axes", label: "Two axes", equipment: "Two axes and light armour." },
      { id: "two-clubs", label: "Two clubs", equipment: "Two clubs and light armour." },
      { id: "sword-axe", label: "Sword and axe", equipment: "Sword, axe, and light armour." },
      { id: "sword-club", label: "Sword and club", equipment: "Sword, club, and light armour." },
      { id: "axe-club", label: "Axe and club", equipment: "Axe, club, and light armour." },
      { id: "double-handed", label: "Double-handed weapon", equipment: "Double-handed weapon and light armour." },
    ],
  },
  {
    name: "Dwarf Troll Slayer (HS)",
    source: "3Campaigns.pdf p.109 — Dwarf Troll Slayer",
    equipmentChoices: [
      { id: "two-axes", label: "Two axes", equipment: "Two axes." },
      { id: "double-handed-axe", label: "Double-handed axe", equipment: "Double-handed axe." },
    ],
  },
  { name: "Pit Fighter", source: "3Campaigns.pdf p.105 — Pit Fighter", equipment: "Morning star, spiked gauntlet, and helmet." },
  { name: "Halfling Scout (HS)", source: "3Campaigns.pdf p.106 — Halfling Scout", equipment: "Bow, dagger, and cooking pot (counts as a helmet)." },
  { name: "Warlock (HS)", source: "3Campaigns.pdf p.107 — Warlock", equipment: "Staff." },
  { name: "Freelancer", source: "3Campaigns.pdf p.108 — Freelancer", equipment: "Heavy armour, shield, lance, sword, and warhorse." },
  { name: "Elf Ranger", source: "3Campaigns.pdf p.108 — Elf Ranger", equipment: "Elf bow, sword, and Elven cloak." },
  { name: "Beast Hunter", source: "MordEMP2.pdf — Beast Hunter", equipment: "Two axes, throwing axe, light armour, and skull rack." },
  { name: "Highwayman", source: "MordEMP2.pdf — Highwayman", equipment: "Brace of pistols, rapier, cloak (acts as a buckler), dagger, and horse." },
  { name: "Roadwarden", source: "MordEMP2.pdf — Roadwarden", equipment: "Crossbow, horseman's hammer, dagger, heavy armour, three torches, and horse." },
  { name: "Wolf Priest of Ulric", source: "Wolf Priest of Ulric.docx — Weapons/Armour", equipment: "Wolf cloak (included); use only the source-permitted blunt weapons and dagger." },
];

exports.up = async function up(knex) {
  await knex.schema.alterTable("warrior_types", (table) => {
    table.text("starting_equipment").nullable();
    table.jsonb("equipment_choices").notNullable().defaultTo(knex.raw("'[]'::jsonb"));
  });

  for (const profile of hiredSwordProfiles) {
    const updated = await knex("warrior_types")
      .where({ name: profile.name, category: "Hired Sword" })
      .update({
        ...(profile.stats ? { stats: JSON.stringify(profile.stats) } : {}),
        starting_equipment: profile.equipment ?? null,
        equipment_choices: JSON.stringify(profile.equipmentChoices ?? []),
      });
    if (!updated) throw new Error(`Hired Sword profile is missing from the catalog: ${profile.name}`);
  }

  await knex.raw(`
    UPDATE warriors AS warrior
    SET stats = warrior_type.stats,
        updated_at = now()
    FROM warrior_types AS warrior_type
    WHERE warrior.warrior_type_id = warrior_type.id
      AND warrior.role = 'Hired Sword'
      AND warrior_type.category = 'Hired Sword'
      AND warrior.stats = '{}'::jsonb
  `);
  await knex.raw(`
    UPDATE warriors AS warrior
    SET equipment = warrior_type.starting_equipment,
        updated_at = now()
    FROM warrior_types AS warrior_type
    WHERE warrior.warrior_type_id = warrior_type.id
      AND warrior.role = 'Hired Sword'
      AND warrior_type.category = 'Hired Sword'
      AND warrior_type.starting_equipment IS NOT NULL
      AND trim(warrior.equipment) = ''
  `);
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("warrior_types", (table) => {
    table.dropColumn("equipment_choices");
    table.dropColumn("starting_equipment");
  });
};