const startingEquipmentByHiredSword = {
  "Pit Fighter": ["3Campaigns.pdf p.105 — Pit Fighter", "Morning star, spiked gauntlet, and helmet."],
  "Halfling Scout (HS)": ["3Campaigns.pdf p.106 — Halfling Scout", "Bow, dagger, and cooking pot (counts as a helmet)."],
  "Warlock (HS)": ["3Campaigns.pdf p.107 — Warlock", "Staff."],
  Freelancer: ["3Campaigns.pdf p.108 — Freelancer", "Heavy armour, shield, lance, sword, and warhorse."],
  "Elf Ranger": ["3Campaigns.pdf p.108 — Elf Ranger", "Elf bow, sword, and Elven cloak."],
  "Beast Hunter": ["MordEMP2.pdf — Beast Hunter", "Two axes, throwing axe, light armour, and skull rack."],
  Highwayman: ["MordEMP2.pdf — Highwayman", "Brace of pistols, rapier, cloak (acts as a buckler), dagger, and horse."],
  Roadwarden: ["MordEMP2.pdf — Roadwarden", "Crossbow, horseman's hammer, dagger, heavy armour, three torches, and horse."],
  "Wolf Priest of Ulric": ["Wolf Priest of Ulric.docx — Weapons/Armour", "Wolf cloak (included); use only the source-permitted blunt weapons and dagger."],
};

exports.up = async function up(knex) {
  for (const [name, [sourceReference, equipment]] of Object.entries(startingEquipmentByHiredSword)) {
    const type = await knex("warrior_types").where({ name, category: "Hired Sword" }).first("id");
    if (!type) throw new Error(`Hired Sword equipment profile is missing: ${name}`);
    await knex("warrior_types").where({ id: type.id }).update({
      starting_equipment: equipment,
      source_reference: sourceReference,
    });

    await knex("warriors")
      .where({ role: "Hired Sword", warrior_type_id: type.id })
      .whereRaw("trim(equipment) = ''")
      .update({ equipment, updated_at: new Date() });
  }
};

exports.down = async function down(knex) {
  for (const name of Object.keys(startingEquipmentByHiredSword)) {
    await knex("warrior_types").where({ name, category: "Hired Sword" }).update({ starting_equipment: null });
  }
};
