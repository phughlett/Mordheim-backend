// Keep only Heroes, Henchmen and Hired Swords with a referenced hire cost.
// Mounts and cart parts are kept because they are priced as part of their owner's entry.
const keepWithoutCost = ["Freelancer's Warhorse", "Highwayman's Horse", "Roadwarden's Horse", "Plague Cart Guardian (CoC)", "Plague Cart Horse (CoC)", "Plague Cart Wheel (CoC)"];

exports.up = async function up(knex) {
  await knex("warrior_types").whereNull("hire_cost").whereNotIn("name", keepWithoutCost).del();
};

exports.down = async function down() {};
