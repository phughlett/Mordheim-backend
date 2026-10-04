exports.up = async function up(knex) {
  await knex("warrior_types").where({ name: "Warhounds", category: "Henchman" }).update({
    experience_rule: "Warhounds never gain experience. (Mordheim Universal Player Aid (with house rules).pdf)",
  });
  await knex("warrior_types").where({ name: "Zombies", category: "Henchman" }).update({
    experience_rule: "Zombies never gain experience. (2Warbands.pdf; Mordheim Universal Player Aid (with house rules).pdf)",
  });
};

exports.down = async function down(knex) {
  await knex("warrior_types").where({ name: "Warhounds", category: "Henchman" }).update({
    experience_rule: "Warhounds never gain experience. (Mordheim Universal Player Aid (with house rules).pdf)",
  });
  await knex("warrior_types").where({ name: "Zombies", category: "Henchman" }).update({
    experience_rule: "Zombies never gain experience. (2Warbands.pdf; Mordheim Universal Player Aid (with house rules).pdf)",
  });
};
