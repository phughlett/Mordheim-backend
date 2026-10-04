const restrictedTypes = {
  "Cave Squigs": "Cave Squigs are animals and do not gain experience. (Night_Goblins_v3.21.pdf; damobrules.pdf)",
  Fanatics: "Fanatics cannot gain experience. (Night_Goblins_v3.21.pdf)",
  Nurglings: "Nurglings never gain experience. (MordEMP2.pdf)",
  "Plague Bearers": "Plague Bearers never gain experience. (MordEMP2.pdf)",
  "Rat Ogre": "Rat Ogres do not gain experience. (2Warbands.pdf)",
  "Raging Peasants": "Peasants never gain experience. (14 Battle Monks.pdf)",
  Swabbies: "Swabbies never gain experience. (PirateWarband.pdf)",
  Troll: "Trolls do not gain experience. (damobrules.pdf)",
  Warhounds: "Warhounds never gain experience. (Mordheim Universal Player Aid (with house rules).pdf)",
  "Warhounds of Chaos": "Warhounds are animals and never gain experience. (10 Marauders of Chaos.pdf)",
  "Wolf Companion": "Wolf Companions are animals and do not gain experience. (Wolf Priest of Ulric.docx)",
  Zombies: "Zombies never gain experience. (2Warbands.pdf; Mordheim Universal Player Aid (with house rules).pdf)",
};

exports.up = async function up(knex) {
  await knex.schema.alterTable("warrior_types", (table) => {
    table.boolean("can_gain_experience").notNullable().defaultTo(true);
    table.text("experience_rule").nullable();
  });

  for (const [name, experienceRule] of Object.entries(restrictedTypes)) {
    await knex("warrior_types").where({ name, category: "Henchman" }).update({
      can_gain_experience: false,
      experience_rule: experienceRule,
    });
  }
};

exports.down = async function down(knex) {
  await knex.schema.alterTable("warrior_types", (table) => {
    table.dropColumn("experience_rule");
    table.dropColumn("can_gain_experience");
  });
};