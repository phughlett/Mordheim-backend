const restrictedTypes = {
  "Dire Wolves": "Dire Wolves do not gain experience. (2Warbands.pdf)",
  "Giant Rats": "Giant Rats are animals and do not gain experience. (2Warbands.pdf)",
  Kroxigor: "Kroxigor do not gain experience. (lizardmen.pdf)",
};

exports.up = async function up(knex) {
  for (const [name, experienceRule] of Object.entries(restrictedTypes)) {
    await knex("warrior_types").where({ name, category: "Henchman" }).update({
      can_gain_experience: false,
      experience_rule: experienceRule,
    });
  }
};

exports.down = async function down(knex) {
  await knex("warrior_types")
    .where({ category: "Henchman" })
    .whereIn("name", Object.keys(restrictedTypes))
    .update({ can_gain_experience: true, experience_rule: null });
};