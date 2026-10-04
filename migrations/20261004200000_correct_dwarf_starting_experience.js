const startingExperience = [
  ["Dwarf Noble", 20],
  ["Dwarf Engineer", 10],
  ["Dwarf Troll Slayers", 8],
];

exports.up = async function up(knex) {
  for (const [name, experience] of startingExperience) {
    await knex("warrior_types").where({ name, category: "Hero" }).update({ starting_experience: experience });
  }
};

exports.down = async function down(knex) {
  for (const [name] of startingExperience) {
    await knex("warrior_types").where({ name, category: "Hero" }).update({ starting_experience: 0 });
  }
};