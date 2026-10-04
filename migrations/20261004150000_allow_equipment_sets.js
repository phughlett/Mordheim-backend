exports.up = async function up(knex) {
  await knex.raw("ALTER TABLE equipment_options DROP CONSTRAINT equipment_options_category_check");
  await knex.raw("ALTER TABLE equipment_options ADD CONSTRAINT equipment_options_category_check CHECK (category IN ('weapon', 'armour', 'shield', 'set'))");
};

exports.down = async function down(knex) {
  await knex("equipment_options").where({ category: "set" }).del();
  await knex.raw("ALTER TABLE equipment_options DROP CONSTRAINT equipment_options_category_check");
  await knex.raw("ALTER TABLE equipment_options ADD CONSTRAINT equipment_options_category_check CHECK (category IN ('weapon', 'armour', 'shield'))");
};